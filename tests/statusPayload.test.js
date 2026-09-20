const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture({ fail = [], blocked = false, user = { user_id: 1, name: 'Player', char_levels: '{"ninja":2}' } } = {}) {
  const started = [], releases = [], warnings = [];
  const values = {
    icons: { selectedProfileIconId: 'icon', ownedIconIds: ['icon'] },
    skins: { selectedSkinIdByCharacter: { ninja: 'skin' }, ownedSkinIds: ['skin'] },
    card: 'card', cards: ['card'], preference: { mapId: 2 },
    party: [{ party_id: 42 }], match: [{ match_id: 91 }],
  };
  const load = async key => {
    started.push(key);
    if (blocked) await new Promise(resolve => releases.push(resolve));
    if (fail.includes(key)) throw new Error(key);
    return values[key];
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/server/services/statusPayloadService'), 'utf8'), {
    module, console: { warn: (...args) => warnings.push(args), error() {} },
    require: name => {
      if (name.endsWith('/profileIconOwnership')) return { syncProfileIconOwnershipForUser: () => load('icons') };
      if (name.endsWith('/skinOwnership')) return { syncSkinOwnershipForUser: () => load('skins') };
      if (name === './mapRepository') return { mapRepository: { list: () => [{ document: { id: 1, label: 'Map', metadata: { unlocked: true } } }] } };
      throw new Error(name);
    },
  });
  const db = {
    getUserSelectedCardId: () => load('card'), getUserOwnedCardIds: () => load('cards'),
    getUserPreferredSelection: () => load('preference'),
    runQuery: sql => load(sql.includes('party_members') ? 'party' : 'match'),
  };
  return {
    started, warnings, values, user, release: () => releases.forEach(fn => fn()),
    build: () => module.exports.buildStatusPayload({ db, getOrCreateCurrentUser: async () => [user, 'new'], isGuest: () => true, isAdminUser: () => false }),
  };
}

test('status starts all independent branches before any completes and preserves fresh payload', async () => {
  const f = fixture({ blocked: true });
  const pending = f.build();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.started, ['icons', 'skins', 'card', 'cards', 'preference', 'party', 'match']);
  f.release();
  const payload = JSON.parse(JSON.stringify(await pending));
  assert.equal(payload.party_id, 42);
  assert.equal(payload.live_match_id, 91);
  assert.equal(payload.userData.selected_card_id, 'card');
  assert.deepEqual(payload.userData.owned_card_ids, ['card']);
  assert.equal(payload.userData.selected_profile_icon_id, 'icon');
  assert.deepEqual(payload.userData.owned_profile_icon_ids, ['icon']);
  assert.deepEqual(payload.userData.selected_skin_id_by_char, { ninja: 'skin' });
  assert.deepEqual(payload.userData.owned_skin_ids, ['skin']);
  assert.deepEqual(payload.userData.preferred_selection, { mapId: 2 });
  assert.deepEqual(payload.userData.char_levels, { ninja: 2 });
  assert.equal(f.user.char_levels, '{"ninja":2}', 'does not mutate auth snapshot');
  assert.equal(payload.guest, true);
  assert.equal(payload.newlyCreated, true);
  assert.equal(payload.mapCatalog[0].label, 'Map');
});

test('optional status failures retain defaults without suppressing authoritative membership', async () => {
  const f = fixture({ fail: ['icons', 'skins', 'card', 'cards', 'preference', 'match'] });
  const result = JSON.parse(JSON.stringify(await f.build()));
  assert.equal(result.party_id, 42);
  assert.equal(result.live_match_id, null);
  assert.equal(result.userData.selected_card_id, null);
  assert.deepEqual(result.userData.owned_card_ids, []);
  assert.equal(result.userData.selected_profile_icon_id, null);
  assert.deepEqual(result.userData.owned_profile_icon_ids, []);
  assert.deepEqual(result.userData.selected_skin_id_by_char, {});
  assert.deepEqual(result.userData.owned_skin_ids, []);
  assert.equal(result.userData.preferred_selection, null);
  assert.equal(f.warnings.length, 1);
  await assert.rejects(fixture({ fail: ['party'] }).build(), /party/);
});

test('banned status never starts customization or routing work', async () => {
  const f = fixture({ user: { user_id: 1, is_banned: 1, ban_reason: 'Banned' } });
  assert.equal((await f.build()).banned, true);
  assert.deepEqual(f.started, []);
});

test('status does not reuse previous membership or ownership responses', async () => {
  const f = fixture();
  assert.equal((await f.build()).party_id, 42);
  f.values.party = [];
  f.values.card = 'new-card';
  const result = await f.build();
  assert.equal(result.party_id, null);
  assert.equal(result.userData.selected_card_id, 'new-card');
  assert.equal(f.started.filter(key => key === 'party').length, 2);
});

test('missing user id skips account-specific work', async () => {
  const f = fixture({ user: { name: 'Unknown' } });
  const result = await f.build();
  assert.deepEqual(f.started, ['party']);
  assert.equal(result.live_match_id, null);
  assert.equal(result.userData.selected_card_id, null);
});
