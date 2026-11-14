const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

describe("Party return route", () => {
  const { registerPartyRoutes } = require('../src/server/routes/modules/partyRoutes');
  const { emitRoster } = require('../src/server/services/party/party');

  function fixture({ existing = true, missing = false, full = false, privateParty = false, statusFails = false, rosterFails = false } = {}) {
    const calls = [], emissions = [], routes = new Map();
    const party = { party_id: 42, mode: 1, map: 1, is_public: privateParty ? 0 : 1, allow_member_selection: 0 };
    let status = 'ingame';
    const conn = {
      beginTransaction: async () => calls.push('begin'),
      commit: async () => calls.push('commit'), rollback: async () => calls.push('rollback'),
      release: () => calls.push('release'),
      async query(sql) {
        const q = sql.replace(/\s+/g, ' ').trim();
        calls.push(q);
        if (q.startsWith('SELECT * FROM parties')) return [missing ? [] : [party]];
        if (q.startsWith('SELECT team FROM party_members')) return [existing ? [{ team: 'team1' }] : []];
        if (q.startsWith('UPDATE party_members SET last_seen')) return [{ affectedRows: 1 }];
        if (q.includes('FROM party_join_requests')) return [[]];
        if (q.startsWith('SELECT COUNT(*)')) return [[{ cnt: full ? 99 : 1 }]];
        if (q.startsWith('SELECT team, COUNT(*)')) return [[{ team: 'team1', c: 1 }]];
        if (q.startsWith('DELETE FROM party_members') || q.startsWith('INSERT INTO party_members')) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected query: ${q}`);
      },
    };
    const db = {
      pool: { getConnection: async () => conn },
      async setUserStatus(name, next) {
        calls.push('online');
        assert.equal(calls.at(-2), 'release', 'release transaction before more pooled queries');
        assert.equal(name, 'Player');
        if (statusFails) throw new Error('presence unavailable');
        status = next;
      },
      async fetchPartyMembersDetailed() {
        calls.push('roster');
        if (rosterFails) throw new Error('roster unavailable');
        return [
          { name: 'Owner', team: 'team2', slot_index: 1, char_class: 'ninja', status: 'online' },
          { name: 'Player', team: 'team1', slot_index: 0, char_class: 'ninja', status, selected_skin_id_by_char: { ninja: 'ninja-arena-sovereign' } },
        ];
      },
      async fetchSelectedCardsByNames() { calls.push('cards'); return { Player: 'card' }; },
      async runQuery(sql) {
        calls.push('owner');
        assert.match(sql, /SELECT name/);
        return [{ name: 'Owner' }];
      },
    };
    const io = { to: room => ({ emit: (event, data) => emissions.push({ room, event, data }) }) };
    const app = { post: (path, handler) => routes.set(path, handler), locals: { socketApi: {
      moveUserSocketToParty: async () => calls.push('move'),
      cancelPartyQueue: async () => calls.push('cancelQueue'),
    } } };
    registerPartyRoutes({ app, io, db, requireCurrentUser: async () => ({ name: 'Player', user_id: 1 }) });
    const res = { code: 200, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; } };
    return { calls, emissions, db, io, party, res, run: () => routes.get('/partydata')({ body: { partyId: 42 }, app }, res) };
  }

  test('return reads one fresh roster, releases its pool slot, and reuses ownership for emission', async () => {
    const f = fixture();
    await f.run();
    assert.equal(f.res.code, 200);
    for (const key of ['roster', 'online', 'cards', 'release']) assert.equal(f.calls.filter(call => call === key).length, 1, key);
    assert.equal(f.calls.includes('owner'), false);
    assert.equal(f.calls.includes('cancelQueue'), false);
    assert.ok(f.calls.indexOf('online') < f.calls.indexOf('roster'));
    assert.ok(f.calls.indexOf('commit') < f.calls.indexOf('release'));
    assert.ok(f.calls.indexOf('move') < f.calls.indexOf('cards'));
    assert.equal(f.res.payload.ownerName, 'Owner', 'ownership follows join order, not seats');
    assert.equal(f.res.payload.members[1].status, 'online');
    assert.equal(f.res.payload.allowMemberSelection, false);
    const roster = f.emissions.find(e => e.event === 'party:members').data;
    assert.equal(roster.ownerName, f.res.payload.ownerName);
    assert.equal(roster.members[1].selected_card_id, 'card');
    assert.equal(roster.members[1].status, 'online');
    assert.deepEqual(f.emissions.map(e => e.event), ['party:members', 'mode-change', 'map-change']);
  });

  test('new joins still update membership and cancel matchmaking before broadcasting', async () => {
    const f = fixture({ existing: false });
    await f.run();
    assert.equal(f.res.code, 200);
    assert.ok(f.calls.some(q => q.startsWith('INSERT INTO party_members')));
    assert.ok(f.calls.indexOf('cancelQueue') < f.calls.indexOf('cards'));
    assert.equal(f.calls.filter(q => q === 'roster').length, 1);
  });

  for (const [options, code] of [[{ missing: true }, 404], [{ existing: false, full: true }, 409], [{ existing: false, privateParty: true }, 403]]) {
    test(`rejected party return (${code}) does not mark online or move the socket`, async () => {
      const f = fixture(options);
      await f.run();
      assert.equal(f.res.code, code);
      assert.equal(f.calls.includes('online'), false);
      assert.equal(f.calls.includes('move'), false);
      assert.equal(f.calls.includes('rollback'), true);
      assert.equal(f.calls.filter(q => q === 'release').length, 1);
      assert.equal(f.emissions.length, 0);
    });
  }

  test('presence write failure still reads authoritative roster and returns the lobby', async () => {
    const f = fixture({ statusFails: true });
    await f.run();
    assert.equal(f.res.code, 200);
    assert.equal(f.res.payload.members[1].status, 'ingame');
    assert.equal(f.calls.filter(q => q === 'roster').length, 1);
  });

  test('other roster callers retain owner lookup; explicit no-owner snapshot avoids one', async () => {
    const f = fixture();
    await emitRoster(f.io, 42, f.party, [], f.db);
    assert.equal(f.calls.filter(q => q === 'owner').length, 1);
    await emitRoster(f.io, 42, f.party, [], f.db, { ownerName: null });
    assert.equal(f.calls.filter(q => q === 'owner').length, 1);
    assert.equal(f.emissions.at(-1).data.ownerName, null);
  });

  test('failed fresh roster read does not broadcast stale data or leak the transaction connection', async () => {
    const f = fixture({ rosterFails: true });
    await f.run();
    assert.equal(f.res.code, 500);
    assert.equal(f.calls.filter(q => q === 'release').length, 1);
    assert.equal(f.calls.includes('move'), false);
    assert.equal(f.emissions.length, 0);
  });

  test('party HTTP, roster and mode updates share the equipped skin after joining', async () => {
    for (const existing of [false, true]) {
      const f = fixture({ existing });
      await f.run();
      const members = f.res.payload.members;
      assert.equal(members[1].selected_skin_id, 'ninja-arena-sovereign');
      assert.equal(members[1].selected_skin_asset_url, '/assets/ninja/skins/ninja-arena-sovereign/body.webp');
      for (const event of ['party:members', 'mode-change']) {
        assert.deepEqual(f.emissions.find(e => e.event === event).data.members, members);
      }
    }
  });
});

describe("Fresh account status", () => {
  function fixture({ fail = [], blocked = false, user = { user_id: 1, name: 'Player', char_levels: '{"ninja":2}' } } = {}) {
    const started = [], releases = [], warnings = [];
    const values = {
      icons: { selectedProfileIconId: 'icon', ownedIconIds: ['icon'] },
      skins: { selectedSkinIdByCharacter: { ninja: 'skin' }, ownedSkinIds: ['skin'] },
      card: 'card', cards: ['card'], preference: { mapId: 2 },
      party: [{ party_id: 42 }], match: [{ match_id: 91 }],
      streak: 3,
    };
    const load = async key => {
      started.push(key);
      if (blocked) await new Promise(resolve => releases.push(resolve));
      if (fail.includes(key)) throw new Error(key);
      return values[key];
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/server/services/match/statusPayloadService'), 'utf8'), {
      module, console: { warn: (...args) => warnings.push(args), error() {} },
      require: name => {
        if (name.endsWith('/moderation/accountBan')) return require('../src/shared/moderation/accountBan');
        if (name === './battleLog') return { getCurrentWinStreak: () => load('streak') };
        if (name.endsWith('/profileIconOwnership')) return { syncProfileIconOwnershipForUser: () => load('icons') };
        if (name.endsWith('/skinOwnership')) return { syncSkinOwnershipForUser: () => load('skins') };
        if (name.endsWith('/characterStats.js')) return require('../src/shared/characters/characterStats.js');
        if (name === '../maps/mapRepository') return { mapRepository: { listMetadata: () => [{ unlocked: true, id: 1, label: 'Map' }] } };
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
    assert.deepEqual(f.started, ['icons', 'skins', 'card', 'cards', 'preference', 'party', 'match', 'streak']);
    f.release();
    const payload = JSON.parse(JSON.stringify(await pending));
    assert.equal(payload.party_id, 42);
    assert.equal(payload.live_match_id, 91);
    assert.equal(payload.userData.selected_card_id, 'card');
    assert.equal(payload.userData.winStreak, 3);
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
    const f = fixture({ fail: ['icons', 'skins', 'card', 'cards', 'preference', 'match', 'streak'] });
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
    assert.equal(result.userData.winStreak, 0);
    assert.equal(f.warnings.length, 2);
    await assert.rejects(fixture({ fail: ['party'] }).build(), /party/);
  });

  test('banned status never starts customization or routing work', async () => {
    const f = fixture({ user: { user_id: 1, is_banned: 1, ban_reason: 'Banned' } });
    assert.equal((await f.build()).banned, true);
    assert.deepEqual(f.started, []);
  });

  test('temporary restrictions use the banned payload before expiry and normal status afterwards', async () => {
    const user = { user_id: 1, is_banned: 1, ban_reason: 'Cooldown', ban_expires_at: new Date(Date.now() + 60000) };
    const f = fixture({ user });
    const restricted = await f.build();
    assert.equal(restricted.banned, true);
    assert.equal(restricted.message, 'Cooldown');
    assert.equal(restricted.banExpiresAt, user.ban_expires_at);
    assert.deepEqual(f.started, []);
    user.ban_expires_at = new Date(Date.now() - 1);
    assert.equal((await f.build()).banned, undefined);
    assert.ok(f.started.includes('party'));
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
});
