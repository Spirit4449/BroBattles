import test from "node:test";
import assert from "node:assert/strict";
import {
  END_BATTLE_MESSAGES,
  getEndBattleMessage,
  normalizeResultTone,
} from "../src/hud/gameOverMessages.js";
import {
  END_BATTLE_MESSAGES as EXPORTED_MESSAGES,
  getEndBattleMessage as exportedGetEndBattleMessage,
  createGameOverScreenController,
} from "../src/hud/gameOverScreenController.js";

test("END_BATTLE_MESSAGES defines pools for victory, defeat, and draw", () => {
  assert.ok(Array.isArray(END_BATTLE_MESSAGES.victory), "victory messages should be an array");
  assert.ok(Array.isArray(END_BATTLE_MESSAGES.defeat), "defeat messages should be an array");
  assert.ok(Array.isArray(END_BATTLE_MESSAGES.draw), "draw messages should be an array");

  assert.ok(END_BATTLE_MESSAGES.victory.length >= 10, "should have at least 10 victory messages");
  assert.ok(END_BATTLE_MESSAGES.defeat.length >= 10, "should have at least 10 defeat messages");
  assert.ok(END_BATTLE_MESSAGES.draw.length >= 3, "should have at least 3 draw messages");

  for (const [category, messages] of Object.entries(END_BATTLE_MESSAGES)) {
    for (const msg of messages) {
      assert.equal(typeof msg, "string", `message in ${category} must be string`);
      assert.ok(msg.trim().length > 0, `message in ${category} must not be empty`);
    }
  }
});

test("END_BATTLE_MESSAGES preserves legacy messages alongside new variety", () => {
  assert.ok(
    END_BATTLE_MESSAGES.victory.includes("Your squad owned the arena"),
    "legacy victory message must be present",
  );
  assert.ok(
    END_BATTLE_MESSAGES.defeat.includes("Gear up for the rematch"),
    "legacy defeat message must be present",
  );
  assert.ok(
    END_BATTLE_MESSAGES.draw.includes("Nobody backed down"),
    "legacy draw message must be present",
  );

  assert.ok(
    END_BATTLE_MESSAGES.victory.includes("Absolute domination!"),
    "new victory message should be present",
  );
  assert.ok(
    END_BATTLE_MESSAGES.defeat.includes("Close battle — bounce back stronger!"),
    "new defeat message should be present",
  );
});

test("normalizeResultTone correctly handles tone prefixes and casing", () => {
  assert.equal(normalizeResultTone("is-victory"), "victory");
  assert.equal(normalizeResultTone("victory"), "victory");
  assert.equal(normalizeResultTone("WIN"), "victory");

  assert.equal(normalizeResultTone("is-defeat"), "defeat");
  assert.equal(normalizeResultTone("defeat"), "defeat");
  assert.equal(normalizeResultTone("LOSS"), "defeat");

  assert.equal(normalizeResultTone("is-draw"), "draw");
  assert.equal(normalizeResultTone("draw"), "draw");
  assert.equal(normalizeResultTone(null), "draw");
  assert.equal(normalizeResultTone("unknown"), "draw");
});

test("getEndBattleMessage selects messages within bounds using RNG", () => {
  // First message
  const firstVic = getEndBattleMessage("is-victory", () => 0);
  assert.equal(firstVic, END_BATTLE_MESSAGES.victory[0]);

  // Last message
  const lastVic = getEndBattleMessage("is-victory", () => 0.999999);
  assert.equal(
    lastVic,
    END_BATTLE_MESSAGES.victory[END_BATTLE_MESSAGES.victory.length - 1],
  );

  // Defeat messages
  const firstDef = getEndBattleMessage("is-defeat", () => 0);
  assert.equal(firstDef, END_BATTLE_MESSAGES.defeat[0]);

  const lastDef = getEndBattleMessage("is-defeat", () => 0.999999);
  assert.equal(
    lastDef,
    END_BATTLE_MESSAGES.defeat[END_BATTLE_MESSAGES.defeat.length - 1],
  );

  // Draw messages
  const drawMsg = getEndBattleMessage("is-draw", () => 0.5);
  assert.ok(END_BATTLE_MESSAGES.draw.includes(drawMsg));
});

test("gameOverScreenController re-exports message helpers and accepts getMessage override", () => {
  assert.equal(EXPORTED_MESSAGES, END_BATTLE_MESSAGES);
  assert.equal(exportedGetEndBattleMessage, getEndBattleMessage);

  const customMessage = "Custom end test message";
  const controller = createGameOverScreenController({
    getGameData: () => ({ yourTeam: "team1" }),
    getUsername: () => "TestUser",
    rewardStorageKey: "test_key",
    getMessage: () => customMessage,
  });

  assert.equal(typeof controller.showGameOverScreen, "function");
});

