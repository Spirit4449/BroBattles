const test = require("node:test");
const assert = require("node:assert/strict");
const { createPartyStateService } = require("../src/server/services/partyStateService");

function fixture(socketId = "owner-socket") {
  const emissions = [];
  const request = {
    request_id: 10, party_id: 7, requester_user_id: 3,
    requester_name: "Requester", status: "pending", request_count: 1,
    requested_at: new Date(),
  };
  const conn = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql) {
      if (sql.includes("SELECT * FROM parties")) return [[{ party_id: 7, is_public: 0 }]];
      if (sql.includes("SELECT 1 FROM party_members")) return [[]];
      if (sql.includes("FOR UPDATE")) return [[]];
      if (sql.includes("INSERT INTO party_join_requests")) return [{ affectedRows: 1 }];
      if (sql.includes("FROM party_join_requests")) return [[request]];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const db = {
    pool: { getConnection: async () => conn },
    async runQuery(sql, params) {
      assert.deepEqual(params, [7]);
      if (sql.includes("SELECT socket_id FROM users")) {
        assert.match(sql, /ORDER BY joined_at ASC, name ASC/);
        return socketId ? [{ socket_id: socketId }] : [];
      }
      if (sql.includes("FROM party_members")) return [{ name: "Owner" }];
      if (sql.includes("UPDATE party_join_requests")) return { affectedRows: 0 };
      if (sql.includes("FROM party_join_requests")) return [request];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const io = { to: (target) => ({ emit: (event, payload) => emissions.push({ target, event, payload }) }) };
  return { state: createPartyStateService({ db, io }), emissions };
}

test("new join requests are delivered only to the owner's socket", async () => {
  const { state, emissions } = fixture();
  const result = await state.submitJoinRequest({ partyId: 7, requesterUserId: 3, requesterName: "Requester" });
  assert.equal(result.ok, true);
  assert.equal(emissions.length, 1);
  assert.equal(emissions[0].target, "owner-socket");
  assert.equal(emissions[0].event, "party:join-request");
  assert.equal(emissions[0].payload.requesterName, "Requester");
});

test("an offline owner does not cause requests to be broadcast to members", async () => {
  const { state, emissions } = fixture(null);
  const result = await state.submitJoinRequest({ partyId: 7, requesterUserId: 3, requesterName: "Requester" });
  assert.equal(result.ok, true);
  assert.deepEqual(emissions, []);
});

for (const actorName of ["Owner", "Member", "Outsider"]) {
  test(`pending request visibility for ${actorName}`, async () => {
    const { state } = fixture();
    const result = await state.getPendingJoinRequests({ partyId: 7, actorName });
    if (actorName === "Owner") {
      assert.equal(result.ok, true);
      assert.equal(result.payload.requests[0].requesterName, "Requester");
    } else {
      assert.equal(result.statusCode, 403);
      assert.equal(result.payload.requests, undefined);
    }
  });
}
