const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const { EventEmitter } = require('node:events');
const tuning = require('../src/lib/characterTuning');
const { getResolvedAttackDescriptor } = require('../src/server/core/gameRoom/attackDescriptorResolver');

const exportsForTest = {};
const source = fs.readFileSync(require.resolve('../src/characters/huntress/attack.js'), 'utf8');
const code = babel.transformSync(source + '\nexport { resolveStart, spawnArrowTrail };', {
  babelrc: false, configFile: false,
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code;
vm.runInNewContext(code, {
  exports: exportsForTest,
  require: name => name.includes('characterTuning') ? tuning :
    name.includes('renderLayers') ? { RENDER_LAYERS: { ATTACKS: 20 } } : {},
  Phaser: { Physics: { Arcade: { Image: class {} } } },
});
const { HuntressArrow, resolveStart, spawnArrowTrail } = exportsForTest;
const config = tuning.getResolvedCharacterAttackConfig('huntress', 'arrowSpread');
const target = (left, right, top = 110, bottom = 170) => ({
  username: 'enemy', sprite: { active: true, body: { enable: true, left, right, top, bottom } },
});
function arrow(entries = []) {
  return Object.assign(Object.create(HuntressArrow.prototype), {
    active: true, x: 100, y: 124, vx: 560, vy: 0, createdAt: 0,
    cfg: { gravity: config.gravity, maxLifetimeMs: 3000, playerCollisionRadius: 16 },
    targetEntries: entries, mapObjectsRef: [], scene: { time: { now: 0 } },
    setPosition(x, y) { this.x = x; this.y = y; },
    setRotation(rotation) { this.rotation = rotation; },
    tryDamageVault() { return false; },
    embedIntoTarget(entry) { this.hit = entry; this.embedded = true; },
    embedAt() { this.wallHit = true; this.embedded = true; },
  });
}

test('network and local launch points agree, below center and close to the body', () => {
  const owner = { x: 100, y: 100, displayWidth: 150, displayHeight: 150 };
  for (const angle of [0, Math.PI, -Math.PI / 2]) {
    const local = resolveStart({}, owner, angle);
    const network = resolveStart({ origin: { x: 100, y: 100 } }, owner, angle);
    assert.deepEqual(local, network);
  }
  const start = resolveStart({}, owner, 0);
  assert.equal(start.y, 124);
  assert.equal(start.x, 118);
  assert.equal(resolveStart({ start: { x: 7, y: 8 } }, owner, 0).y, 8);
  for (const type of ['huntress-arrow-release', 'huntress-burning-arrow']) {
    const runtime = getResolvedAttackDescriptor(type).runtime;
    assert.equal(runtime.verticalOffsetHeightFactor, config.verticalOffset);
    assert.equal(runtime.forwardOffsetWidthFactor, config.forwardOffset);
    assert.ok(runtime.gravity > 0);
  }
});

test('sweep hits point-blank enemies and enemies crossed entirely in one frame', () => {
  for (const [entry, dt] of [[target(95, 120), 16], [target(150, 170), 180]]) {
    const projectile = arrow([entry]);
    projectile.updateArrow(0, dt);
    assert.equal(projectile.hit, entry);
  }
  const entry = target(40, 60);
  const projectile = arrow([entry]);
  projectile.vx = -560;
  projectile.updateArrow(0, 180);
  assert.equal(projectile.hit, entry);
});

test('the first obstruction wins, and disabled targets are ignored', () => {
  const entry = target(150, 170);
  const projectile = arrow([entry]);
  projectile.mapObjectsRef = [{ body: { left: 115, right: 120, top: 0, bottom: 300 } }];
  projectile.updateArrow(0, 180);
  assert.equal(projectile.wallHit, true);
  assert.equal(projectile.hit, undefined);
  entry.sprite.body.enable = false;
  assert.equal(arrow([entry]).findSweptTargetCollisionPoint(100, 124, 220, 124), null);
});

test('arrows gain downward velocity and speed each falling frame', () => {
  const projectile = arrow();
  projectile.updateArrow(0, 16);
  const speed = Math.hypot(projectile.vx, projectile.vy);
  const vy = projectile.vy;
  projectile.updateArrow(0, 16);
  assert.ok(projectile.vy > vy);
  assert.ok(Math.hypot(projectile.vx, projectile.vy) > speed);
});

test('normal arrows emit a short fading trail and detach on cleanup', () => {
  let emitted = 0, tween;
  const scene = {
    time: { now: 100 }, events: new EventEmitter(),
    add: { line() { emitted++; return {
      setOrigin() {}, setRotation() {}, setDepth() {}, destroy() { this.destroyed = true; },
    }; } },
    tweens: { add(options) { tween = options; } },
  };
  const stop = spawnArrowTrail(scene, { active: true, x: 100, y: 100, rotation: 0 }, false);
  scene.events.emit('update');
  scene.events.emit('update');
  assert.equal(emitted, 1);
  assert.equal(tween.alpha, 0);
  assert.equal(tween.duration, 150);
  tween.onComplete();
  assert.equal(tween.targets.destroyed, true);
  stop();
  assert.equal(scene.events.listenerCount('update'), 0);
});
