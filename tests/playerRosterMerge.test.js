const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const babel = require("@babel/core");

const compiled = babel.transformSync(
  fs.readFileSync(require.resolve("../src/match/playerRosterMerge.js"), "utf8"),
  {
    babelrc: false,
    configFile: false,
    presets: [["@babel/preset-env", { targets: { node: "current" } }]],
  },
);
const api = {};
vm.runInNewContext(compiled.code, { exports: api });

test("unavailable socket stats do not erase roster stats", () => {
  const rosterPlayer = {
    name: "Opponent",
    team: "team2",
    char_class: "huntress",
    level: 6,
    stats: { health: 6500, damage: 1400, specialDamage: 2200 },
  };
  const merged = api.mergeInitialRosterPlayer(rosterPlayer, {
    name: "Opponent",
    team: "team2",
    char_class: "huntress",
    connected: false,
    // The old room payload fabricated level 1 for a player not yet connected.
    level: 1,
    stats: { health: null, damage: null, specialDamage: null },
  });

  assert.equal(merged.level, 6);
  assert.deepEqual(
    JSON.parse(JSON.stringify(merged.stats)),
    rosterPlayer.stats,
  );
});

test("connected player live stats still override stale roster stats", () => {
  const merged = api.mergeInitialRosterPlayer(
    {
      name: "Player",
      team: "team1",
      char_class: "ninja",
      level: 2,
      stats: { health: 5000, damage: 1000, specialDamage: 1800 },
    },
    {
      name: "Player",
      level: 3,
      stats: { health: 6000, damage: 1200, specialDamage: 2200 },
    },
  );

  assert.equal(merged.level, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(merged.stats)), {
    health: 6000,
    damage: 1200,
    specialDamage: 2200,
  });
});
