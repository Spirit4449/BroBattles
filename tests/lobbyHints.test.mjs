import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseLobbyHint,
  chooseTimedLobbyHint,
  formatHintCountdown,
  getRecentModeStreak,
} from "../src/lobby/lobbyHintController.mjs";

const hint = (id, options = {}) => ({
  id,
  anchor: `#${id}`,
  cooldownBattles: 4,
  ...options,
});

test("mode streak counts only consecutive battles in the same game mode", () => {
  assert.deepEqual(
    getRecentModeStreak([
      { modeId: "duels" },
      { modeId: "duels" },
      { modeId: "bank-bust" },
      { modeId: "duels" },
    ]),
    { modeId: "duels", count: 2 },
  );
  assert.deepEqual(getRecentModeStreak([]), { modeId: null, count: 0 });
});

test("sale countdowns stay compact and readable", () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(formatHintCountdown(now + 3_661_000, now), "1h 1m");
  assert.equal(formatHintCountdown(now + 90_061_000, now), "1d 1h");
  assert.equal(formatHintCountdown(now + 61_000, now), "1m 1s");
});

test("sale hint markup uses a clock instead of technical countdown copy", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/lobby/lobbyHintController.mjs", import.meta.url), "utf8"),
  );
  assert.match(source, /class="pixel-clock-icon"/);
  assert.doesNotMatch(source, /ENDS IN/);
});

test("tooltip dismissal keeps an exit phase while cancellation stays immediate", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/lobby/lobbyHintController.mjs", import.meta.url), "utf8"),
  );
  assert.match(source, /classList\.add\("is-leaving"\)/);
  assert.match(source, /window\.setTimeout\(remove, 240\)/);
  assert.match(source, /dismiss\(true\)/);
});

test("finished tooltip animations release clipping so pixel borders remain visible", async () => {
  const styles = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../src/styles/index.css", import.meta.url), "utf8"),
  );
  assert.match(styles, /\.lobby-hint\.is-visible\s*\{[\s\S]*?clip-path:\s*none/);
  assert.match(styles, /100%\s*\{\s*opacity:\s*1;\s*clip-path:\s*none/);
});

test("only one lobby hint can be selected for a battle checkpoint", () => {
  const hints = [
    hint("party", { priority: 20 }),
    hint("sales", { priority: 10 }),
  ];
  assert.equal(
    chooseLobbyHint(
      hints,
      { battleCount: 0 },
      { lastBattle: null, hints: {} },
    ).id,
    "party",
  );
  assert.equal(
    chooseLobbyHint(hints, { battleCount: 0 }, { lastBattle: 0, hints: {} }),
    null,
  );
});

test("cooldowns rotate eligible hints and keep conditional hints out", () => {
  const hints = [
    hint("party", { priority: 20, when: ({ hasParty }) => hasParty }),
    hint("sales", { priority: 10 }),
  ];
  const state = {
    lastBattle: 3,
    hints: {
      party: { lastBattle: 2 },
      sales: { lastBattle: 0 },
    },
  };

  assert.equal(
    chooseLobbyHint(hints, { battleCount: 4, hasParty: false }, state).id,
    "sales",
  );
  assert.equal(
    chooseLobbyHint(
      hints,
      { battleCount: 3, hasParty: true },
      { ...state, lastBattle: 2 },
    ),
    null,
  );
});

test("a global battle gap keeps different hints from nagging players", () => {
  const hints = [hint("party"), hint("sales")];
  const state = { lastBattle: 6, hints: { party: { lastBattle: 6 } } };

  assert.equal(
    chooseLobbyHint(hints, { battleCount: 8, hintGapBattles: 3 }, state),
    null,
  );
  assert.equal(
    chooseLobbyHint(hints, { battleCount: 9, hintGapBattles: 3 }, state).id,
    "sales",
  );
});

test("timed party hints rotate rosters without waiting for battles", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const suggestions = [
    hint("party", {
      instanceKey: "8:A|B",
      cooldownMs: 45_000,
      repeatMs: 180_000,
      priority: 90,
    }),
    hint("party", {
      instanceKey: "9:C|D",
      cooldownMs: 45_000,
      repeatMs: 180_000,
      priority: 80,
    }),
  ];
  const state = {
    lastShownAt: now - 60_000,
    hints: {
      party: {
        shownAt: now - 60_000,
        recentKeys: { "8:A|B": now - 60_000 },
      },
    },
  };

  assert.equal(
    chooseTimedLobbyHint(suggestions, { minGapMs: 45_000 }, state, now)
      .instanceKey,
    "9:C|D",
  );
  assert.equal(
    chooseTimedLobbyHint(
      suggestions,
      { minGapMs: 90_000 },
      state,
      now,
    ),
    null,
  );
});
