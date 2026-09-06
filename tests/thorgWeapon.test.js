const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const babel = require('@babel/core');
const anchors = require('../src/characters/thorg/handAnchors.json');
const sweep = require('../src/shared/thorgSweep');

function load(file, dependencies = {}) {
  const exports = {};
  const code = babel.transformSync(fs.readFileSync(require.resolve(file), 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  vm.runInNewContext(code, { exports, require: key => {
    assert.ok(key in dependencies, `Unexpected dependency ${key}`);
    return dependencies[key];
  }});
  return exports;
}
const motion = load('../src/characters/thorg/weaponMotion.js', { './handAnchors.json': anchors });
const flips = load('../src/characters/shared/flipLock.js');
const weaponModule = load('../src/characters/thorg/weapon.js', {
  './weaponMotion': motion,
  '../../shared/thorgSweep': sweep,
  '../shared/flipLock': flips,
  '../shared/animationState': { playSpriteAnimation() {}, markOneShotAnimation() {} },
});

function object() {
  return Object.assign(new EventEmitter(), {
    active: true, visible: true, alpha: 1, x: 300, y: 200, depth: 30,
    rotation: 0, destroyCount: 0,
    setOrigin() { return this; },
    setDisplaySize(width, height) { this.displayWidth = width; this.displayHeight = height; return this; },
    setVisible(value) { this.visible = value; return this; },
    setAlpha(value) { this.alpha = value; return this; },
    setDepth(value) { this.depth = value; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setAngle(value) { this.angle = value; return this; },
    clear() { return this; }, lineStyle() { return this; },
    lineBetween(...points) { assert.ok(points.every(Number.isFinite)); this.lineCount = (this.lineCount || 0) + 1; return this; },
    destroy() { this.destroyCount++; this.active = false; this.emit('destroy'); },
  });
}
function harness() {
  const images = [], graphics = [], sounds = [];
  const scene = {
    events: new EventEmitter(), textures: { exists: () => true },
    cache: { audio: { exists: () => true } },
    add: {
      image() { const image = object(); images.push(image); return image; },
      graphics() { const graphic = object(); graphics.push(graphic); return graphic; },
    },
    sound: {
      add(key) {
        const sound = { key, playCount: 0, stopCount: 0, destroyCount: 0,
          play() { this.playCount++; return true; }, stop() { this.stopCount++; }, destroy() { this.destroyCount++; } };
        sounds.push(sound); return sound;
      },
      play(key) { const sound = this.add(key); sound.play(); return true; },
    },
  };
  const body = Object.assign(object(), {
    texture: { key: 'thorg' }, frame: { name: 'idle00' }, flipX: false,
    body: { velocity: { y: 0 } },
    anims: { currentAnim: { duration: 900 }, timeScale: 1 },
  });
  return { scene, body, images, graphics, sounds, tick(delta) {
    scene.events.emit('update', 0, delta); scene.events.emit('postupdate', 0, delta);
  }};
}

test('all atlas grip tracks and locomotion transitions remain finite and ease without teleporting', () => {
  const body = { frame: { name: 'idle00' }, body: { velocity: { y: 0 } } };
  let previous = { ...motion.thorgGripPose(body) };
  for (const frame of [...Object.keys(anchors), 'missing99']) {
    body.frame.name = frame;
    for (const velocity of [-600, 0, 600]) {
      body.body.velocity.y = velocity;
      const held = { ...motion.thorgGripPose(body, 0) };
      assert.deepEqual(held, previous, `${frame}: no elapsed time must not move grip`);
      const next = { ...motion.thorgGripPose(body, 16) };
      assert.ok(Object.values(next).every(Number.isFinite), frame);
      assert.ok(Math.hypot(next.x - previous.x, next.y - previous.y) < 30, `${frame}: abrupt grip shift`);
      assert.ok(Math.abs(next.angle - previous.angle) < 0.6, `${frame}: abrupt rotation`);
      previous = next;
    }
  }
});

test('looping idle grip interpolation is continuous across frame boundaries', () => {
  for (const logical of ['idle']) {
    const keys = Object.keys(anchors).filter(key => key.startsWith(logical)).sort();
    assert.ok(keys.length > 1);
    for (let index = 0; index < keys.length; index++) {
      const poseAt = (i, fraction) => motion.thorgGripPose({
        frame: { name: keys[i] },
        anims: { isPlaying: true, accumulator: fraction * 100, nextTick: 100,
          currentAnim: { repeat: -1, frames: keys.map(textureFrame => ({ textureFrame })) },
          currentFrame: { index: i + 1 } },
      });
      const end = poseAt(index, 0.99999), start = poseAt((index + 1) % keys.length, 0);
      assert.ok(Math.hypot(end.x-start.x, end.y-start.y) < 1.2, `${logical} ${index}: loop grip jump`);
      assert.ok(Math.abs(end.angle-start.angle) < 0.09, `${logical} ${index}: loop rotation jump`);
    }
  }
});

test('sweep has one held weapon, one trail and one sound, then releases all transient resources', () => {
  const h = harness();
  const weapon = weaponModule.ensureThorgWeapon(h.scene, h.body);
  assert.equal(weaponModule.ensureThorgWeapon(h.scene, h.body), weapon);
  weaponModule.startThorgSweep(h.scene, h.body);
  for (let i = 0; i < 44; i++) h.tick(16);
  assert.equal(h.images.length, 1);
  assert.equal(h.graphics.length, 1);
  assert.ok(h.graphics[0].lineCount > 0);
  assert.equal(h.graphics[0].destroyCount, 1);
  assert.equal(h.sounds.length, 1);
  assert.equal(h.sounds[0].playCount, 1);
  assert.equal(h.sounds[0].destroyCount, 1);
  assert.equal(h.scene.events.listenerCount('update'), 0);
  assert.equal(h.body._thorgSweepActive, false);
  assert.equal(h.body._lockFlip, false);
  assert.equal(h.body.anims.timeScale, 1);
  assert.equal(h.body.angle, 0);
  assert.ok(weapon.active);
});

test('restarting a sweep cleans the previous trail and sound without accumulating callbacks', () => {
  const h = harness();
  weaponModule.startThorgSweep(h.scene, h.body); h.tick(240);
  weaponModule.startThorgSweep(h.scene, h.body);
  assert.equal(h.graphics[0].destroyCount, 1);
  assert.equal(h.sounds[0].destroyCount, 1);
  assert.equal(h.sounds[1].playCount, 1);
  assert.equal(h.scene.events.listenerCount('update'), 1);
  assert.equal(h.scene.events.listenerCount('postupdate'), 1);
  h.tick(750);
  assert.equal(h.graphics[1].destroyCount, 1);
  assert.equal(h.sounds[1].destroyCount, 1);
});

for (const event of ['destroy', 'shutdown']) test(`${event} removes weapon, trail, sound and listeners exactly once`, () => {
  const h = harness();
  weaponModule.startThorgSweep(h.scene, h.body); h.tick(200);
  if (event === 'destroy') h.body.destroy(); else h.scene.events.emit('shutdown');
  h.scene.events.emit('shutdown');
  h.tick(1000);
  assert.equal(h.images[0].destroyCount, 1);
  assert.equal(h.graphics[0].destroyCount, 1);
  assert.equal(h.sounds[0].destroyCount, 1);
  assert.equal(h.body._thorgWeapon, undefined);
  assert.equal(h.scene.events.listenerCount('update'), 0);
  assert.equal(h.scene.events.listenerCount('postupdate'), 0);
  assert.equal(h.body.listenerCount('destroy'), 0);
});

test('both facing directions and rage scales keep finite sweep placement and recover into live grip', () => {
  for (const direction of [-1, 1]) for (const scale of [1, sweep.THORG_SWEEP.rageScale]) {
    const h = harness();
    h.body._thorgVisualScale = scale;
    weaponModule.startThorgSweep(h.scene, h.body, { direction });
    for (let i = 0; i < 70; i++) {
      h.body.x += 0.5; h.tick(10);
      const weapon = h.images[0];
      assert.ok([weapon.x, weapon.y, weapon.rotation].every(Number.isFinite));
      assert.equal(weapon.displayWidth, 30 * scale);
      assert.equal(h.body.flipX, direction < 0);
    }
    const weapon = h.images[0], end = { x: weapon.x, y: weapon.y, rotation: weapon.rotation };
    h.tick(16);
    assert.ok(Math.hypot(weapon.x - end.x, weapon.y - end.y) < 0.01);
    assert.ok(Math.abs(weapon.rotation - end.rotation) < 0.01);
  }
});

test('running grip stays on the displayed fist throughout each reordered frame', () => {
  const keys = ['running01', 'running00', 'running03', 'running04', 'running02', 'running05'];
  const body = { frame: { name: keys[0] }, anims: { isPlaying: true, nextTick: 100,
    currentAnim: { repeat: -1, frames: keys.map(textureFrame => ({ textureFrame })) } } };
  motion.thorgGripPose(body);
  for (let i = 0; i < keys.length; i++) {
    body.frame.name = keys[i]; body.anims.currentFrame = { index: i + 1 };
    for (const fraction of [0, 0.5, 0.99]) {
      body.anims.accumulator = fraction * 100;
      const pose = motion.thorgGripPose(body);
      assert.equal(pose.x, (anchors[keys[i]][0] - 64) * 0.7);
      assert.equal(pose.y, (anchors[keys[i]][1] - 64) * 0.7);
    }
  }
});

test('attack frames do not drift the carry grip or rock the body', () => {
  const h = harness();
  weaponModule.ensureThorgWeapon(h.scene, h.body);
  const carry = { ...h.body._thorgGripPose };
  weaponModule.startThorgSweep(h.scene, h.body);
  for (let i = 0; i < 5; i++) {
    h.body.frame.name = `throw0${i}`;
    h.tick(140);
    assert.deepEqual({ ...h.body._thorgGripPose }, carry);
    assert.equal(h.body.angle || 0, 0);
  }
  h.tick(16);
  assert.deepEqual({ ...h.body._thorgGripPose }, carry);
});
