import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { friendPresenceLabel, friendPresenceTitle } from '../src/client/friends/friendPresence.mjs';
const { createFriendService } = createRequire(import.meta.url)('../src/server/services/social/friendService.js');

const now = Date.parse('2026-10-09T16:00:00Z');
const offline = age => ({ status: 'offline', lastSeenAt: new Date(now - age).toISOString() });

test('friend labels cover live activity, elapsed time, and missing history', () => {
  assert.equal(friendPresenceLabel({ status: 'online' }, now), 'Online');
  assert.equal(friendPresenceLabel({ status: 'In Battle' }, now), 'In Battle');
  assert.equal(friendPresenceLabel({ status: 'End Screen' }, now), 'Finishing match');
  assert.equal(friendPresenceLabel(offline(59_999), now), 'Last seen just now');
  assert.equal(friendPresenceLabel(offline(60_000), now), 'Last seen 1m ago');
  assert.equal(friendPresenceLabel(offline(3_600_000), now), 'Last seen 1h ago');
  assert.equal(friendPresenceLabel(offline(86_400_000 * 3), now), 'Last seen 3d ago');
  assert.equal(friendPresenceLabel(offline(-60_000), now), 'Last seen just now');
  for (const lastSeenAt of [null, undefined, '', 'invalid']) {
    assert.equal(friendPresenceLabel({ status: 'offline', lastSeenAt }, now), 'Last seen unknown');
  }
});

test('exact last-seen tooltip uses the local date and is only shown offline', () => {
  const friend = offline(120_000);
  assert.equal(friendPresenceTitle(friend), `Last seen ${new Date(friend.lastSeenAt).toLocaleString()}`);
  assert.equal(friendPresenceTitle({ ...friend, status: 'online' }), '');
  assert.equal(friendPresenceTitle({ status: 'offline' }), '');
});

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
    payload: { userId: 2, name: 'Away', status: 'offline', lastSeenAt } })));
});
