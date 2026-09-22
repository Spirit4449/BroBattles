import test from "node:test";
import assert from "node:assert/strict";
import {
  GAME_CHAT_FOCUS_MS,
  GAME_CHAT_UNFOCUSED_MS,
  gameChatVisibilityPhase,
} from "../src/chat/gameChatVisibility.mjs";

test("battle chat darkens after two seconds, then disappears three seconds later", () => {
  const state = { open: true, suppressed: false, lastActivityAt: 1000 };
  assert.equal(GAME_CHAT_FOCUS_MS, 2000);
  assert.equal(GAME_CHAT_UNFOCUSED_MS, 3000);
  assert.equal(gameChatVisibilityPhase({ ...state, now: 2999 }), "active");
  assert.equal(gameChatVisibilityPhase({ ...state, now: 3000 }), "unfocused");
  assert.equal(gameChatVisibilityPhase({ ...state, now: 5999 }), "unfocused");
  assert.equal(gameChatVisibilityPhase({ ...state, now: 6000 }), "hidden");
});

test("opening or interacting restarts the visibility window", () => {
  assert.equal(
    gameChatVisibilityPhase({
      open: true,
      suppressed: false,
      lastActivityAt: 5900,
      now: 6000,
    }),
    "active",
  );
  assert.equal(
    gameChatVisibilityPhase({
      open: false,
      suppressed: false,
      lastActivityAt: 5900,
      now: 6000,
    }),
    "hidden",
  );
  assert.equal(
    gameChatVisibilityPhase({
      open: true,
      suppressed: true,
      lastActivityAt: 5900,
      now: 6000,
    }),
    "hidden",
  );
});
