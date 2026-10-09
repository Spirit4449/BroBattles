const test = require('node:test');
const assert = require('node:assert/strict');
const { createFriendService } = require('../src/server/services/social/friendService.js');
const { DEFAULT_PRIVACY, normalizePrivacy, privacyFromRow, sanitizePrivacyUpdate } = require('../src/shared/social/privacy.cjs');

const ME = { user_id: 1, name: 'Me', expires_at: null };
const TARGET = { user_id: 2, name: 'Target', expires_at: null, is_banned: 0 };

// Routes queries by SQL fragment; `privacy` maps user id -> stored row.
function createDb({ privacy = {}, gamesTogether = 0, friends = true, reversePending = false } = {}) {
  const calls = [];
  const privacyRows = (params) => params.map(Number).filter((id) => privacy[id]).map((id) => ({ user_id: id, ...privacy[id] }));
  const runQuery = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('FROM user_privacy_settings WHERE user_id IN')) return privacyRows(params);
    if (sql.includes('FROM user_privacy_settings WHERE user_id = ?')) return privacyRows(params.slice(0, 1));
    if (sql.includes('LEFT JOIN user_privacy_settings p ON p.user_id = u.user_id\n        WHERE u.user_id = ?')) {
      return [{ name: 'Target', ...(privacy[Number(params[0])] || {}) }];
    }
    if (sql.includes('FROM friendships WHERE user_id = ? AND friend_id = ?')) return friends ? [{ 1: 1 }] : [];
    if (sql.includes('SELECT COUNT(*) AS c FROM friendships')) return [{ c: 0 }];
    if (sql.includes('FROM users WHERE user_id = ?')) return [TARGET];
    if (sql.includes('COUNT(DISTINCT mp1.match_id)')) return [{ games: gamesTogether }];
    if (sql.includes('FOR UPDATE')) return reversePending ? [{ request_id: 9, from_user_id: 2, to_user_id: 1 }] : [];
    if (sql.includes('SUM(status')) return [{ declines: 0, recent_declines: 0, recent_requests: 0 }];
    if (sql.startsWith('INSERT INTO friend_requests')) return { insertId: 7 };
    if (sql.startsWith('INSERT INTO friend_messages')) return { insertId: 11 };
    if (sql.includes('FROM friend_messages WHERE message_id = ?')) {
      return [{ message_id: 11, sender_id: 1, recipient_id: 2, body: 'hi', created_at: new Date(), read_at: null }];
    }
    if (sql.includes('FROM friend_messages\n        WHERE user_a')) {
      return [{ message_id: 5, sender_id: 1, recipient_id: 2, body: 'hi', created_at: new Date(), read_at: new Date() }];
    }
    if (sql.includes('MAX(message_id) AS upTo')) return [{ upTo: 5 }];
    if (sql.startsWith('UPDATE friend_messages SET read_at')) return { affectedRows: 1 };
    if (sql.includes('SELECT friend_id FROM friendships')) return [{ friend_id: 2 }, { friend_id: 3 }];
    return [];
  };
  const db = {
    runQuery,
    withTransaction: (fn) => fn(null, runQuery),
    getPartyIdByName: async (name) => (name === 'Me' ? 50 : null),
  };
  return { db, calls };
}

function createIo() {
  const events = [];
  return { events, io: { to: (room) => ({ emit: (event, payload) => events.push({ room, event, payload }) }) } };
}

test('privacy values are sanitized and missing rows fall back to defaults', () => {
  assert.deepEqual(privacyFromRow(undefined), DEFAULT_PRIVACY);
  assert.deepEqual(privacyFromRow({ friend_requests: null, read_receipts: 0, messages: 'none' }), {
    ...DEFAULT_PRIVACY, readReceipts: false, messages: 'none',
  });
  assert.deepEqual(sanitizePrivacyUpdate({ friendRequests: 'recent', lastSeen: 'everyone', readReceipts: 'no', bogus: 1 }), {
    friendRequests: 'recent',
  });
  assert.deepEqual(normalizePrivacy(null), DEFAULT_PRIVACY);
});

test('friend requests respect the recipient setting', async () => {
  const blocked = createFriendService(createDb({ privacy: { 2: { friend_requests: 'none' } }, friends: false }));
  await assert.rejects(blocked.sendRequest(ME, { userId: 2 }), { statusCode: 403, message: /isn't accepting friend requests/ });

  const strangers = createFriendService(createDb({ privacy: { 2: { friend_requests: 'recent' } }, gamesTogether: 1, friends: false }));
  await assert.rejects(strangers.sendRequest(ME, { userId: 2 }), { statusCode: 403 });

  const recent = createFriendService(createDb({ privacy: { 2: { friend_requests: 'recent' } }, gamesTogether: 5, friends: false }));
  assert.equal((await recent.sendRequest(ME, { userId: 2 })).status, 'pending');

  // Asking back accepts their request, which they chose to send.
  const reverse = createFriendService(createDb({ privacy: { 2: { friend_requests: 'none' } }, reversePending: true, friends: false }));
  assert.equal((await reverse.sendRequest(ME, { userId: 2 })).status, 'accepted');
});

test('messages and party invites are refused when the friend turned them off', async () => {
  const { db, calls } = createDb({ privacy: { 2: { messages: 'none', party_invites: 'none' } } });
  const service = createFriendService({ db });
  service.attachPresence({ getStatus: () => 'online' });
  await assert.rejects(service.sendMessage(ME, 2, 'hello'), { statusCode: 403, message: /isn't accepting messages/ });
  assert.ok(!calls.some(({ sql }) => sql.startsWith('INSERT INTO friend_messages')));
  await assert.rejects(service.sendPartyInvite(ME, 2), { statusCode: 403, message: /isn't accepting party invites/ });
  assert.equal(await service.canShowTyping(1, 2), false);
});

test('read receipts are hidden in both directions when either player turns them off', async () => {
  for (const privacy of [{ 1: { read_receipts: 0 } }, { 2: { read_receipts: 0 } }]) {
    const { io, events } = createIo();
    const service = createFriendService({ ...createDb({ privacy }), io });
    const { messages } = await service.getConversation(ME, 2);
    assert.equal(messages[0].readAt, null);
    await service.markRead(ME, 2);
    assert.deepEqual(events.map(({ room }) => room), ['user:1']);
    // Typing indicators are not part of the receipts setting.
    assert.equal(await service.canShowTyping(1, 2), true);
  }
  const { io, events } = createIo();
  const service = createFriendService({ ...createDb(), io });
  assert.notEqual((await service.getConversation(ME, 2)).messages[0].readAt, null);
  await service.markRead(ME, 2);
  assert.deepEqual(events.map(({ room }) => room).sort(), ['user:1', 'user:2']);
  assert.equal(await service.canShowTyping(1, 2), true);
});

test('hidden last seen is withheld from friend lists and presence pushes', async () => {
  const lastSeen = new Date();
  const db = { runQuery: async (sql) => {
    if (sql.includes('SELECT friend_code')) return [{ friend_code: 'ABCD-EFGH' }];
    if (sql.includes('FROM friendships f')) return [
      { user_id: 2, name: 'Hidden', last_seen_at: lastSeen, last_seen: 'none', messages: 'none', party_invites: 'friends' },
      { user_id: 3, name: 'Shown', last_seen_at: lastSeen, last_seen: null },
    ];
    if (sql.includes('JOIN friendships f ON f.user_id = u.user_id')) return [{ user_id: 2, friend_id: 1, last_seen_at: lastSeen, last_seen: 'none' }];
    return [];
  } };
  const { io, events } = createIo();
  const service = createFriendService({ db, io });
  const { friends } = await service.getOverview(ME);
  assert.deepEqual(friends.map(({ name, lastSeenAt, lastSeenHidden, acceptsMessages, acceptsPartyInvites }) => ({ name, lastSeenAt, lastSeenHidden, acceptsMessages, acceptsPartyInvites })), [
    { name: 'Hidden', lastSeenAt: null, lastSeenHidden: true, acceptsMessages: false, acceptsPartyInvites: true },
    { name: 'Shown', lastSeenAt: lastSeen, lastSeenHidden: false, acceptsMessages: true, acceptsPartyInvites: true },
  ]);
  await service.handleStatusChange('Hidden', 'offline');
  assert.deepEqual(events[0].payload, { userId: 2, name: 'Hidden', status: 'offline', lastSeenAt: null, lastSeenHidden: true });
});

test('saving privacy stores only valid fields and refreshes friends when they can tell', async () => {
  const { db, calls } = createDb({ privacy: { 1: { messages: 'none' } } });
  const { io, events } = createIo();
  const service = createFriendService({ db, io });
  await assert.rejects(service.updatePrivacy(ME, { messages: 'everyone' }), { statusCode: 400 });
  await assert.rejects(service.updatePrivacy({ user_id: 9, expires_at: new Date() }, { messages: 'none' }), { statusCode: 403 });

  const { privacy } = await service.updatePrivacy(ME, { messages: 'none', bogus: 'x' });
  const insert = calls.find(({ sql }) => sql.startsWith('INSERT INTO user_privacy_settings'));
  assert.match(insert.sql, /\(user_id, messages\)/);
  assert.deepEqual(insert.params, [1, 'none']);
  assert.equal(privacy.messages, 'none');
  assert.deepEqual(events.map(({ room, event }) => `${room} ${event}`), ['user:1 friends:privacy', 'user:2 friends:changed', 'user:3 friends:changed']);

  events.length = 0;
  await service.updatePrivacy(ME, { showInSuggestions: false });
  assert.deepEqual(events.map(({ event }) => event), ['friends:privacy']);
});
