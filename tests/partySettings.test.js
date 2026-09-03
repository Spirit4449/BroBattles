const test = require("node:test");
const assert = require("node:assert/strict");
const { createPartyStateService } = require("../src/server/services/partyStateService");
const { createPartyRouteService } = require("../src/server/services/partyRouteService");
const { registerPartyEvents } = require("../src/server/core/socketEvents/partyEvents");

function fixture(allow = 1) {
  const party = { party_id: 7, mode: 1, map: 1, is_public: 0, public_name: null, allow_member_selection: allow };
  const members = [{ name: "Owner" }, { name: "Member" }];
  const writes = [];
  const emissions = [];
  const db = {
    fetchPartyMembersDetailed: async () => members,
    async runQuery(sql, params) {
      const query = sql.replace(/\s+/g, " ").trim();
      if (query.startsWith("SELECT 1 FROM party_members")) {
        const name = typeof params[0] === "string" ? params[0] : params[1];
        return members.some((member) => member.name === name) ? [{ 1: 1 }] : [];
      }
      if (query.startsWith("SELECT name FROM party_members")) return [members[0]];
      if (query.startsWith("SELECT * FROM parties")) return [{ ...party }];
      if (query.startsWith("UPDATE parties SET is_public")) {
        writes.push(query);
        party.is_public = params[0];
        party.public_name = params[1];
        if (query.includes("allow_member_selection = ?")) party.allow_member_selection = params[2];
        return { affectedRows: 1 };
      }
      if (query.startsWith("UPDATE parties SET mode")) {
        writes.push(query);
        return { affectedRows: 1 };
      }
      throw new Error(`Unexpected query: ${query}`);
    },
  };
  const io = { to: () => ({ emit: (event, data) => emissions.push({ event, data }) }) };
  const state = createPartyStateService({ db, io });
  return { party, writes, emissions, db, io, state, view: createPartyRouteService({ db }) };
}

const selection = { modeId: "duels", modeVariantId: "duels-2v2", mapId: 1 };

test("owner can save permissions, read them back, and broadcast them to members", async () => {
  const f = fixture();
  const result = await f.state.setPartyVisibility({ partyId: 7, actorName: "Owner", isPublic: false, publicName: "", allowMemberSelection: false });
  assert.equal(result.ok, true);
  assert.equal(result.settings.allowMemberSelection, false);
  const read = await f.view.getPartySettingsView({ partyId: 7, username: "Owner" });
  assert.equal(read.payload.allowMemberSelection, false);
  assert.equal(read.payload.memberSelectionSupported, true);
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

test("old schemas retain selection access and report the missing setting", async () => {
  const f = fixture();
  delete f.party.allow_member_selection;
  const read = await f.view.getPartySettingsView({ partyId: 7, username: "Owner" });
  assert.equal(read.payload.memberSelectionSupported, false);
  assert.equal(read.payload.allowMemberSelection, true);
  await f.state.setPartySelection({ partyId: 7, actorName: "Member", selection });
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
