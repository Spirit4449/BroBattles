import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { createFriendService } = createRequire(import.meta.url)('../src/server/services/social/friendService.js');

const now = Date.parse('2026-10-09T16:00:00Z');

test('friend overview returns persisted activity for every friend, including missing history', async () => {
  const db = { runQuery: async sql => {
    if (sql.includes('SELECT friend_code')) return [{ friend_code: 'ABCD-EFGH' }];
    if (sql.includes('FROM friendships f')) return [
      { user_id: 2, name: 'Active', last_seen_at: new Date(now) },
      { user_id: 3, name: 'Away', last_seen_at: new Date(now - 86_400_000) },
      { user_id: 4, name: 'Unknown', last_seen_at: null },
    ];
    return [];
  } };
  const service = createFriendService({ db });
  service.attachPresence({ getStatus: name => name === 'Active' ? 'online' : 'offline' });
  const result = await service.getOverview({ user_id: 1, name: 'Me', expires_at: null });
  assert.deepEqual(result.friends.map(({ name, status, lastSeenAt }) => ({ name, status, lastSeenAt })), [
    { name: 'Active', status: 'online', lastSeenAt: new Date(now) },
    { name: 'Away', status: 'offline', lastSeenAt: new Date(now - 86_400_000) },
    { name: 'Unknown', status: 'offline', lastSeenAt: null },
  ]);
});

test('presence updates send the saved timestamp to all friends', async () => {
  const events = [];
  const lastSeenAt = new Date(now);
  const service = createFriendService({
    db: { runQuery: async () => [
      { user_id: 2, friend_id: 1, last_seen_at: lastSeenAt },
      { user_id: 2, friend_id: 3, last_seen_at: lastSeenAt },
    ] },
    io: { to: room => ({ emit: (event, payload) => events.push({ room, event, payload }) }) },
  });
  await service.handleStatusChange('Away', 'offline');
  assert.deepEqual(events, [1, 3].map(id => ({ room: `user:${id}`, event: 'friends:presence',
    payload: { userId: 2, name: 'Away', status: 'offline', lastSeenAt, lastSeenHidden: false } })));
});

test('friend overview reports recent games played with each friend', async () => {
  const db = { runQuery: async sql => {
    if (sql.includes('SELECT friend_code')) return [{ friend_code: 'ABCD-EFGH' }];
    if (sql.includes('COUNT(DISTINCT mp1.match_id) AS games')) return [{ friend_id: 2, games: 3 }];
    if (sql.includes('FROM friendships f\n')) return [
      { user_id: 2, name: 'Teammate', last_seen_at: null },
      { user_id: 3, name: 'Stranger', last_seen_at: null },
    ];
    return [];
  } };
  const service = createFriendService({ db });
  const { friends } = await service.getOverview({ user_id: 1, name: 'Me', expires_at: null });
  assert.deepEqual(friends.map(({ name, gamesTogether }) => ({ name, gamesTogether })), [
    { name: 'Teammate', gamesTogether: 3 },
    { name: 'Stranger', gamesTogether: 0 },
  ]);
});
