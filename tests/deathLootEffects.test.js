const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const babel = require("@babel/core");

const exportsObject = {};
const { code } = babel.transformSync(
  fs.readFileSync(require.resolve("../src/powerups/deathLootEffects.js"), "utf8"),
  { babelrc: false, configFile: false,
    presets: [["@babel/preset-env", { targets: { node: "current" } }]] },
);
vm.runInNewContext(code, { exports: exportsObject, require: () => ({ RENDER_LAYERS: {} }) });
const { handleDeathLootContact } = exportsObject;

function loot(vy = -120) {
  const body = {
    blocked: { down: true }, touching: { down: true },
    velocity: { x: 150, y: vy }, moves: true, allowGravity: true,
    setAllowGravity(value) { this.allowGravity = value; },
  };
  return { sprite: { x: 300, y: 400, body,
    setVelocity(x, y) { body.velocity = { x, y }; } } };
}

test("first floor contact preserves the bounce and loses sideways momentum", () => {
  const visual = loot();
  let impacts = 0;
  handleDeathLootContact(visual, 100, () => impacts++);
  assert.equal(visual.settled, undefined);
  assert.equal(visual.sprite.body.velocity.y, -120);
  assert.equal(visual.sprite.body.velocity.x, 93);
  assert.equal(visual.sprite.body.allowGravity, true);
  // Adjacent platform colliders must not count the same impact twice.
  handleDeathLootContact(visual, 100, () => impacts++);
  assert.equal(impacts, 1);
  assert.equal(visual.bounces, 1);
});

test("diminishing bounces settle at a stable pickup position", () => {
  const visual = loot();
  handleDeathLootContact(visual, 100);
  visual.sprite.body.velocity.y = -50;
  handleDeathLootContact(visual, 400);
  assert.equal(visual.settled, undefined);
  visual.sprite.body.velocity.y = -21;
  handleDeathLootContact(visual, 550);
  assert.equal(visual.settled, true);
  assert.equal(visual.settledX, 300);
  assert.equal(visual.settledY, 400);
  assert.equal(visual.sprite.body.velocity.y, 0);
  assert.equal(visual.sprite.body.moves, false);
  assert.equal(visual.sprite.body.allowGravity, false);
});

test("walls and collected loot do not trigger landing, gentle floor contacts settle", () => {
  const visual = loot(-20);
  visual.sprite.body.blocked.down = false;
  visual.sprite.body.touching.down = false;
  handleDeathLootContact(visual, 100);
  assert.equal(visual.bounces, undefined);
  visual.sprite.body.touching.down = true;
  visual.despawning = true;
  handleDeathLootContact(visual, 200);
  assert.equal(visual.bounces, undefined);
  visual.despawning = false;
  handleDeathLootContact(visual, 300);
  assert.equal(visual.settled, true);
});
