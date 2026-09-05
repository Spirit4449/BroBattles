const test = require("node:test");
const assert = require("node:assert/strict");

const catalog = require("../src/shared/gameModes.catalog.json");
const { createGameModeRuntime } = require("../src/server/core/gameModes");
const {
  BOT_OBJECTIVE_SCHEMA_VERSION,
  resolveBotObjective,
} = require("../src/server/core/bots/objectives");

function roomFor(mode) {
  const room = {
    matchData: {
      modeId: mode.id,
      modeVariantId: mode.defaultVariantId || null,
      map: mode.id === "bank-bust" ? 4 : 1,
      players: [],
    },
    players: new Map(),
    modeState: null,
  };
  room.gameMode = createGameModeRuntime(room);
  room.modeState = room.gameMode.createRoomState();
  return room;
}

test("every game mode advertises bot support and an objective directive", () => {
  for (const mode of catalog.modes) {
    assert.equal(mode.capabilities.aiBots, true, `${mode.id} supports bots`);
    assert.ok(mode.botObjective?.kind, `${mode.id} has an objective kind`);
    assert.ok(mode.botObjective?.label, `${mode.id} has an objective label`);

    const room = roomFor(mode);
    const objective = resolveBotObjective(room, {
      participantId: "bot:test",
      isBot: true,
      team: "team1",
    });
    assert.equal(objective.schemaVersion, BOT_OBJECTIVE_SCHEMA_VERSION);
    assert.equal(objective.modeId, mode.id);
    assert.equal(objective.kind, mode.botObjective.kind);
    assert.equal(objective.behavior, "standard-combat");
  }
});

test("Bank Bust exposes a team-specific vault target without activating objective AI", () => {
  const mode = catalog.modes.find((entry) => entry.id === "bank-bust");
  const objective = resolveBotObjective(roomFor(mode), {
    participantId: "bot:test",
    isBot: true,
    team: "team1",
  });

  assert.equal(objective.kind, "destroy-vault");
  assert.equal(objective.targetTeam, "team2");
  assert.deepEqual(objective.target, {
    id: "team2-vault",
    type: "vault",
    team: "team2",
    x: objective.goal.x,
    y: objective.goal.y,
  });
  assert.equal(objective.interaction, "damage");
  assert.equal(objective.behavior, "standard-combat");
});
