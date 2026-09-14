const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createPartyRouteService,
} = require("../src/server/services/partyRouteService");

test("public parties are ranked by average trophy distance", async () => {
  const rows = [
    {
      party_id: 1,
      public_name: "Far",
      party_status: "idle",
      party_battle_count: 0,
      mode_id: "duels",
      mode_variant_id: "duels-2v2",
      name: "A",
      status: "online",
      trophies: 50,
      is_owner: 1,
    },
    {
      party_id: 2,
      public_name: "Close",
      party_status: "idle",
      party_battle_count: 3,
      mode_id: "duels",
      mode_variant_id: "duels-2v2",
      name: "B",
      status: "online",
      trophies: 480,
      is_owner: 1,
    },
    {
      party_id: 2,
      public_name: "Close",
      party_status: "idle",
      party_battle_count: 3,
      mode_id: "duels",
      mode_variant_id: "duels-2v2",
      name: "C",
      status: "online",
      trophies: 520,
      is_owner: 0,
    },
  ];
  const db = { runQuery: async () => rows };
  const result = await createPartyRouteService({ db }).discoverPublicParties({
    requesterName: "Viewer",
    requesterTrophies: 550,
  });

  assert.equal(result.payload.parties[0].publicName, "Close");
  assert.equal(result.payload.parties[0].skillRating, 500);
  assert.equal(result.payload.parties[0].skillGap, 50);
  assert.equal(result.payload.parties[0].membersCount, 2);
  assert.equal(result.payload.parties[0].capacity, 4);
  assert.equal(result.payload.parties[0].activeMembers, 2);
  assert.equal(result.payload.parties[0].suggestionEligible, true);
  assert.equal(result.payload.parties[0].members[0].trophies, 480);
  assert.equal(result.payload.parties[1].publicName, "Far");
  assert.equal(result.payload.parties[1].suggestionEligible, false);
});

test("an active solo host with battle history can be suggested for 1v1", async () => {
  const db = {
    runQuery: async () => [
      {
        party_id: 3,
        public_name: "Need One",
        party_status: "idle",
        party_battle_count: 2,
        mode_id: "duels",
        mode_variant_id: "duels-1v1",
        name: "Host",
        status: "online",
        trophies: 700,
        is_owner: 1,
      },
    ],
  };
  const result = await createPartyRouteService({ db }).discoverPublicParties({
    requesterName: "Viewer",
    requesterTrophies: 680,
  });
  const party = result.payload.parties[0];

  assert.equal(party.membersCount, 1);
  assert.equal(party.capacity, 2);
  assert.equal(party.activeMembers, 1);
  assert.equal(party.suggestionEligible, true);
});
