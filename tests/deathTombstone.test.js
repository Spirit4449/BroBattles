const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const exportsObject = {};
const { code } = babel.transformSync(
  fs.readFileSync(require.resolve('../src/gameScene/deathTombstone.js'), 'utf8'),
  { babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]] },
);
vm.runInNewContext(code, { exports: exportsObject, require: () => ({ RENDER_LAYERS: { GAME_OBJECTS: 10 } }) });
const { findTombstoneGround } = exportsObject;
function platform(left, right, top, extra = {}) {
  return { body: { left, right, top, enable: true, ...extra } };
}

test('anchors near-ground deaths to the closest supporting platform', () => {
  const ground = platform(0, 500, 400);
  const upper = platform(100, 200, 300);
  assert.equal(findTombstoneGround(150, 278, [ground, upper]), upper);
  assert.equal(findTombstoneGround(150, 405, [ground, upper]), ground);
});

test('airborne, off-edge and below-platform deaths leave no tombstone', () => {
  const ground = platform(0, 500, 400);
  assert.equal(findTombstoneGround(150, 200, [ground]), null);
  assert.equal(findTombstoneGround(520, 395, [ground]), null);
  assert.equal(findTombstoneGround(150, 450, [ground]), null);
});

test('ignores disabled, non-solid and too-narrow surfaces', () => {
  const objects = [platform(0, 500, 400, { enable: false }),
    platform(0, 500, 400, { checkCollision: { up: false } }),
    platform(145, 155, 400)];
  assert.equal(findTombstoneGround(150, 390, objects), null);
});
