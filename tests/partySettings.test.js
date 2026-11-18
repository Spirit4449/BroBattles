const { createFakeIo } = require('./helpers/fakeIo');
const { createFakeDb } = require('./helpers/fakeDb');
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPartyStateService } = require("../src/server/services/party/partyStateService");
const { createPartyRouteService } = require("../src/server/services/party/partyRouteService");
const { registerPartyEvents } = require("../src/server/core/socketEvents/partyEvents");

test("party route lookup ignores retained context and similarly named pages", () => {
  const { createLobbyFixture } = require("./helpers/lobbyFixture");
  const fixture = createLobbyFixture();
  const { checkIfInParty, getRoutePartyId, getActivePartyId, replacePartyContext } =
    fixture.load("src/client/lobby/party/partyState.js");
  replacePartyContext(7);
  fixture.window.location.pathname = "/party/12/";
  assert.equal(checkIfInParty(), "12");
  assert.equal(getRoutePartyId(), 12);
  assert.equal(getActivePartyId(), 7);
  fixture.window.location.pathname = "/partynotfound";
  assert.equal(checkIfInParty(), false);
  assert.equal(getRoutePartyId(), null);
});

function fixture(allow = 1) {
  const party = { party_id: 7, mode: 1, map: 1, is_public: 0, public_name: null, allow_member_selection: allow, hide_enemy_bros: 0 };
  const members = [{ name: "Owner", team: "team1", slot_index: 0 }, { name: "Member", team: "team1", slot_index: 1 }];
  const writes = [];
  const emissions = [];
  const db = createFakeDb(async (sql, params) => {
    const query = sql.replace(/\s+/g, " ").trim();
    if (query.startsWith("SELECT 1 FROM party_members")) {
      const name = typeof params[0] === "string" ? params[0] : params[1];
      return members.some((member) => member.name === name) ? [{ 1: 1 }] : [];
    }
    if (query.startsWith("SELECT party_id FROM parties")) return [{ ...party }];
    if (query.startsWith("SELECT name, team, slot_index")) return members.map(m => ({ ...m }));
    if (query.startsWith("UPDATE party_members SET team")) {
      Object.assign(members.find(m => m.name === params[3]), { team: params[0], slot_index: params[1] });
      return { affectedRows: 1 };
    }
    if (query.startsWith("SELECT name FROM party_members")) return [members[0]];
    if (query.startsWith("SELECT * FROM parties")) return [{ ...party }];
    if (query.startsWith("UPDATE parties SET is_public")) {
      writes.push(query);
      party.is_public = params[0];
      party.public_name = params[1];
      if (query.includes("allow_member_selection = ?")) party.allow_member_selection = params[2];
      if (query.includes("hide_enemy_bros = ?")) party.hide_enemy_bros = params[query.includes("allow_member_selection = ?") ? 3 : 2];
      return { affectedRows: 1 };
    }
    if (query.startsWith("UPDATE parties SET mode")) {
      writes.push(query);
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected query: ${query}`);
  });
  db.fetchPartyMembersDetailed = async () => members;
  const io = createFakeIo({ onEmit: (_room, event, data) => emissions.push({ event, data }) });
  const state = createPartyStateService({ db, io });
  return { party, writes, emissions, db, io, state, view: createPartyRouteService({ db }) };
}

// Duel maps are available to either team formation.
const selection = { modeId: "duels", modeVariantId: "duels-2v2",
  mapId: require("../src/shared/maps").mapDefaults.find((map) => map.modeVariantId === "duels").id };

test("owner can save permissions, read them back, and broadcast them to members", async () => {
  const f = fixture();
  const result = await f.state.setPartyVisibility({ partyId: 7, actorName: "Owner", isPublic: false, publicName: "", allowMemberSelection: false });
  assert.equal(result.ok, true);
  assert.equal(result.settings.allowMemberSelection, false);
  const read = await f.view.getPartySettingsView({ partyId: 7, username: "Owner" });
  assert.equal(read.payload.allowMemberSelection, false);
  assert.equal(f.emissions.find(({ event }) => event === "party:members").data.allowMemberSelection, false);
  assert.equal((await f.view.getPartyMembersView({ partyId: 7, username: "Member" })).payload.allowMemberSelection, false);
});

test("members cannot change party settings", async () => {
  const f = fixture(0);
  const result = await f.state.setPartyVisibility({ partyId: 7, actorName: "Member", isPublic: true, publicName: "Test Party", allowMemberSelection: true });
  assert.equal(result.ok, false);
  assert.equal(f.writes.length, 0);
});

for (const allow of [0, 1]) {
  for (const actorName of ["Owner", "Member", "Outsider"]) {
    test(`selection permission: allow=${allow}, actor=${actorName}`, async () => {
      const f = fixture(allow);
      const change = () => f.state.setPartySelection({ partyId: 7, actorName, selection });
      if (actorName === "Outsider" || (allow === 0 && actorName === "Member")) {
        await assert.rejects(change, /Not a member|Only the party owner/);
        assert.equal(f.writes.length, 0);
      } else {
        assert.deepEqual(await change(), selection);
        assert.equal(f.writes.length, 1);
      }
    });
  }
}

test("omitted permission leaves the saved setting unchanged", async () => {
  const f = fixture(0);
  await f.state.setPartyVisibility({ partyId: 7, actorName: "Owner", isPublic: true, publicName: "Test Party" });
  assert.equal(f.party.allow_member_selection, 0);
});

test("new parties use the creator's current lobby selection", async () => {
  const queries = [];
  const db = createFakeDb(async (sql, params) => {
    queries.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    if (sql.includes("INSERT INTO parties")) return { insertId: 42 };
    return { affectedRows: 1 };
  }, { connection: {} });
  const state = createPartyStateService({ db, io: {} });

  const partyId = await state.createPartyForUser("Owner", {
    modeId: "bank-bust",
    modeVariantId: "bank-bust-3v3",
    mapId: 4,
  });

  assert.equal(partyId, 42);
  const insert = queries.find(({ sql }) => sql.startsWith("INSERT INTO parties"));
  assert.deepEqual(insert.params, [
    "idle",
    1,
    4,
    "bank-bust",
    "bank-bust-3v3",
    0,
    null,
  ]);
});

test("party settings propagate storage failures", async () => {
  const f = fixture();
  f.db.runQuery = async () => { throw new Error("unavailable"); };
  await assert.rejects(f.view.getPartySettingsView({ partyId: 7, username: "Owner" }), /unavailable/);
});

for (const event of ["mode-change", "map-change"]) {
  test(`${event} rejects forged actor names and sends no party update`, async () => {
    const f = fixture(0);
    const handlers = {};
    const replies = [];
    const socket = { data: { user: { name: "Member" } }, on: (name, fn) => { handlers[name] = fn; }, emit: (name, data) => replies.push({ name, data }) };
    registerPartyEvents(socket, { db: f.db, io: f.io, partyState: f.state, partyPresence: {} });
    await handlers[event]({ partyId: 7, username: "Owner", selection });
    assert.equal(f.writes.length, 0);
    assert.equal(f.emissions.length, 0);
    assert.equal(replies[0].name, "party:selection-denied");
  });
}

for (const event of ['map-change', 'mode-change']) {
  test(`${event} only emits a notice for a real change, including overlapping requests`, async () => {
    const f = fixture();
    const handlers = {};
    const notices = [];
    const socket = { data: {user: {name:'Owner'}}, on: (event, fn) => handlers[event] = fn, emit() {} };
    const state = {async setPartySelection({selection}) {
      f.party.mode_id = selection.modeId;
      f.party.mode_variant_id = selection.modeVariantId;
      f.party.map = selection.mapId;
      return selection;
    }};
    registerPartyEvents(socket,{db:f.db,io:f.io,partyState:state,partyPresence:{emitPartyNotice:async (_, notice)=>notices.push(notice)}});
    const current = {modeId:'duels',modeVariantId:'duels-1v1',mapId:1};
    await handlers[event]({partyId:7,selection:current});
    assert.equal(notices.length,0);
    const next = event === 'map-change' ? {...current,mapId:2} : {...current,modeVariantId:'duels-2v2'};
    await Promise.all([handlers[event]({partyId:7,selection:next}),handlers[event]({partyId:7,selection:next})]);
    assert.equal(notices.length,1);
    assert.equal(notices[0].actorName,'Owner');
  });
}



test('shrinking same-team party persists valid seats and broadcasts server roster', async () => {
  const f = fixture();
  const handlers = {};
  registerPartyEvents({ data: { user: { name: 'Owner' } }, on: (event, fn) => handlers[event] = fn, emit() {} },
    { db: f.db, io: f.io, partyState: f.state, partyPresence: {} });
  await handlers['mode-change']({ partyId: 7, selection: { ...selection, modeVariantId: 'duels-1v1' }, members: [{ name: 'Stale' }] });
  const roster = f.emissions.find(e => e.event === 'mode-change').data.members;
  assert.deepEqual(roster.map(m => [m.name, m.team, m.slot_index]), [['Owner', 'team1', 0], ['Member', 'team2', 0]]);
  assert.deepEqual(await f.db.fetchPartyMembersDetailed(), roster);
});

test('oversized party is rejected before changing the saved mode or seats', async () => {
  const f = fixture();
  const members = await f.db.fetchPartyMembersDetailed();
  members.push({ name: 'Third', team: 'team2', slot_index: 0 });
  const original = members.map(m => ({ ...m }));
  await assert.rejects(() => f.state.setPartySelection({ partyId: 7, actorName: 'Owner',
    selection: { ...selection, modeVariantId: 'duels-1v1' } }), /Too many players/);
  assert.deepEqual(members, original);
  assert.equal(f.writes.length, 0);
});

for (const hidden of [true, false]) {
  test(`owner saves and broadcasts hidden enemy Bros: ${hidden}`, async () => {
    const f = fixture();
    const result = await f.state.setPartyVisibility({ partyId: 7, actorName: 'Owner', isPublic: false, hideEnemyBros: hidden });
    assert.equal(result.settings.hideEnemyBros, hidden);
    assert.equal((await f.view.getPartySettingsView({ partyId: 7, username: 'Owner' })).payload.hideEnemyBros, hidden);
    assert.equal((await f.view.getPartyMembersView({ partyId: 7, username: 'Member' })).payload.hideEnemyBros, hidden);
    assert.equal(f.emissions.find(e => e.event === 'party:members').data.hideEnemyBros, hidden);
    await f.state.setPartyVisibility({ partyId: 7, actorName: 'Owner', isPublic: false });
    assert.equal(f.party.hide_enemy_bros, Number(hidden));
  });
}
test('hidden Bros is owner-only', async () => {
  const f = fixture();
  const result = await f.state.setPartyVisibility({ partyId: 7, actorName: 'Member', hideEnemyBros: true });
  assert.equal(result.ok, false);
  assert.equal(f.writes.length, 0);

});

test('party discovery renders the search result and keeps settings restricted to the owner', async () => {
  const { createLobbyFixture } = require('./helpers/lobbyFixture');
  const requests = [];
  const f = createLobbyFixture({
    url: 'https://game.test/party/7',
    globals: {
      fetch: async (url, options) => {
        requests.push({ url, options });
        return { ok: true, json: async () => ({ parties: [{ partyId: 7, ownerName: 'Owner', publicName: 'Castle Team', capacity: 4, members: [] }] }) };
      },
    },
  });
  f.load('src/client/lobby/party/partyState.js').replacePartyContext(7, { ownerName: 'Owner' });
  const overlays = f.load('src/client/lobby/party/partyOverlays.js');
  const settings = f.document.getElementById('party-settings-button');
  overlays.syncPartySettingsButtonVisibility('Member');
  assert.equal(settings.classList.contains('hidden'), true);
  overlays.syncPartySettingsButtonVisibility('Owner');
  assert.equal(settings.classList.contains('hidden'), false);
  f.document.getElementById('party-discovery-input').value = 'Castle';
  await overlays.openPartyDiscoveryOverlay();
  const search = requests.find(request => request.url === '/party/discover');
  assert.equal(JSON.parse(search.options.body).query, 'Castle');
  assert.match(f.document.getElementById('party-discovery-list').textContent, /Castle Team/);
});

test('solo selection saves normalized state locally and accepts the server selection', async () => {
  const { createLobbyFixture } = require('./helpers/lobbyFixture');
  const requests = [];
  const accountSelection = { modeId: 'duels', modeVariantId: 'duels-2v2', mapId: 1 };
  const f = createLobbyFixture({ globals: { fetch: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ selection: accountSelection }) };
  } } });
  const selection = f.load('src/client/lobby/party/soloSelection.js');
  await selection.persistSoloSelection({ modeId: 'duels', modeVariantId: 'duels-1v1', mapId: 1 });
  assert.equal(selection.getSoloSelection(selection.SOLO_MODE_VARIANT_STORAGE_KEY), 'duels-1v1');
  assert.equal(selection.getSoloSelection(selection.SOLO_MAP_STORAGE_KEY), '1');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(JSON.parse(requests[0].options.body).selection.modeVariantId, 'duels-1v1');
  assert.equal(selection.getSavedSelectionFromUserData().modeVariantId, accountSelection.modeVariantId);
});

test('join request overlay ignores mismatched responses and cancels pending work when dismissed', async () => {
  const { createLobbyFixture } = require('./helpers/lobbyFixture');
  const f = createLobbyFixture();
  const controller = f.load('src/client/lobby/party/joinRequestController.js').createJoinRequestController({
    socket: f.socket, checkIfInParty: () => null, getActivePartyId: () => null,
  });
  f.document.getElementById('username-text').textContent = 'Owner';
  const overlay = f.document.getElementById('party-join-request-overlay');
  const submit = f.document.getElementById('party-join-request-submit');
  const banner = f.document.getElementById('party-join-request-banner');
  let reloads = 0;
  f.window.location.reload = () => reloads++;
  controller.initialize();
  controller.registerEvents();
  controller.showPartyJoinRequestScreen({ partyId: 7, ownerName: 'Host', requestState: { status: 'pending' } });
  assert.equal(submit.disabled, true);
  f.socket.emit('party:join-request:status', { partyId: 8, requesterName: 'Owner', status: 'accepted' });
  f.socket.emit('party:join-request:status', { partyId: 7, requesterName: 'Someone Else', status: 'accepted' });
  assert.equal(banner.dataset.status, 'pending');
  f.socket.emit('party:join-request:status', { partyId: 7, requesterName: 'Owner', status: 'accepted' });
  assert.equal(banner.dataset.status, 'accepted');
  controller.hidePartyJoinRequestScreen();
  await f.advance(60_000);
  assert.equal(overlay.classList.contains('hidden'), true);
  assert.equal(f.document.body.classList.contains('join-request-overlay-open'), false);
  assert.equal(reloads, 0);
});
