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
    setTexture(key, frame) { this.textureKey = key; this.textureFrame = frame; return this; }, setFlipX() { return this; },
    setCrop(x,y,w,h) { this.crop = {x,y,w,h}; return this; },
    setTint() { return this; }, clearTint() { return this; },
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
      assert.ok(Math.abs(next.angle - previous.angle) < (/^(idle|running)/.test(frame) ? 1.2 : 0.6), `${frame}: abrupt rotation`);
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

test('sweep has one held weapon, two depth-separated trails and one sound, then releases all transient resources', () => {
  const h = harness();
  const weapon = weaponModule.ensureThorgWeapon(h.scene, h.body);
  assert.equal(weaponModule.ensureThorgWeapon(h.scene, h.body), weapon);
  weaponModule.startThorgSweep(h.scene, h.body);
  for (let elapsed = 0; elapsed < sweep.THORG_SWEEP.windupMs + sweep.THORG_SWEEP.strikeMs + 150; elapsed += 16) h.tick(16);
  assert.equal(h.images.length, 3);
  assert.equal(h.graphics.length, 2);
  assert.ok(h.graphics[0].lineCount > 0);
  assert.equal(h.graphics[0].destroyCount, 1);
  assert.equal(h.graphics[1].destroyCount, 1);
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
  assert.equal(h.graphics[1].destroyCount, 1);
  assert.equal(h.sounds[0].destroyCount, 1);
  assert.equal(h.sounds[1].playCount, 1);
  assert.equal(h.scene.events.listenerCount('update'), 1);
  assert.equal(h.scene.events.listenerCount('postupdate'), 1);
  h.tick(750);
  assert.equal(h.graphics[2].destroyCount, 1);
  assert.equal(h.graphics[3].destroyCount, 1);
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
  assert.equal(h.graphics[1].destroyCount, 1);
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
    for (let i = 0; i < Math.ceil((sweep.THORG_SWEEP.windupMs + sweep.THORG_SWEEP.strikeMs + 150) / 10); i++) {
      h.body.x += 0.5; h.tick(10);
      const weapon = h.images[0];
      assert.ok([weapon.x, weapon.y, weapon.rotation].every(Number.isFinite));
      assert.equal(weapon.displayWidth, 26 * scale);
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

test('idle has no hand overlays while running fingers still clean up', () => {
  const h = harness();
  weaponModule.ensureThorgWeapon(h.scene, h.body);
  const [weapon, fingers, support] = h.images;
  assert.equal(fingers.visible, false);
  assert.equal(support.visible, false);
  h.body.frame.name = 'running00';
  h.tick(100);
  assert.ok(fingers.visible);
  assert.equal(support.visible, false);
  weaponModule.startThorgSweep(h.scene, h.body);
  h.tick(16);
  assert.equal(fingers.visible, false);
  h.body.destroy();
  assert.equal(fingers.destroyCount, 1);
  assert.equal(support.destroyCount, 1);
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

test('idle-to-run locks the fist immediately and settles rotation within 72 ms', () => {
  const body = { frame: { name: 'idle00' } };
  motion.thorgGripPose(body);
  body.frame.name = 'running00';
  const first = motion.thorgGripPose(body, 16);
  assert.equal(first.x, (anchors.running00[0] - 64) * 0.7);
  assert.equal(first.y, (anchors.running00[1] - 64) * 0.7);
  motion.thorgGripPose(body, 56);
  assert.ok(Math.abs(body._thorgGripPose.angle - anchors.running00[2]) < 0.11);
});

test('rear arc and mace go behind the body while front trail stays in front', () => {
  for (const direction of [-1, 1]) for (const scale of [1, sweep.THORG_SWEEP.rageScale]) {
    const h = harness();
    h.body._thorgVisualScale = scale;
    const weapon = weaponModule.startThorgSweep(h.scene, h.body, { direction });
    const [front, rear] = h.graphics;
    const plane = h.body.y - 37.8 * (scale - 1) + 13 * scale;
    front.lineBetween = (_x1, y1, _x2, y2) => {
      assert.ok(y1 >= plane - 0.001 && y2 >= plane - 0.001);
      front.lineCount = (front.lineCount || 0) + 1;
    };
    rear.lineBetween = (_x1, y1, _x2, y2) => {
      assert.ok(y1 <= plane + 0.001 && y2 <= plane + 0.001);
      rear.lineCount = (rear.lineCount || 0) + 1;
    };
    for (let t = 0; t < sweep.THORG_SWEEP.windupMs + sweep.THORG_SWEEP.strikeMs * 0.65; t += 8) h.tick(8);
    assert.ok(front.lineCount > 0 && rear.lineCount > 0);
    assert.ok(front.depth > h.body.depth && rear.depth < h.body.depth);
    assert.ok(weapon.depth < h.body.depth);
    h.body.destroy();
  }
});

test('weapon remains rigid at its source aspect ratio throughout both sweep directions', () => {
  for (const direction of [-1, 1]) for (const scale of [1, sweep.THORG_SWEEP.rageScale]) {
    const h = harness(); h.body._thorgVisualScale = scale;
    const weapon = weaponModule.startThorgSweep(h.scene, h.body, { direction });
    for (let elapsed = 0; elapsed < 700; elapsed += 8) {
      h.tick(8);
      assert.ok(Math.abs(weapon.displayWidth / weapon.displayHeight - 36 / 101) < 0.0001);
      assert.equal(weapon.displayWidth, 26 * scale);
    }
    h.body.destroy();
  }
});

test('base weapon completes a one-second roll, loops, and pauses while hidden by dying', () => {
  const h = harness();
  const weapon = weaponModule.ensureThorgWeapon(h.scene, h.body);
  assert.equal(weapon.textureKey, 'thorg-weapon-spin');
  assert.equal(weapon.textureFrame, 0);
  h.tick(124); assert.equal(weapon.textureFrame, 0);
  h.tick(1); assert.equal(weapon.textureFrame, 1);
  h.tick(875); assert.equal(weapon.textureFrame, 0);
  h.body.frame.name = 'dying00'; h.tick(500);
  assert.equal(weapon.visible, false);
  assert.equal(weapon.textureFrame, 0);
  h.body.destroy();
});

test('attack grip shifts inward and upward from the rigid waist orbit in both facings', () => {
  for (const direction of [-1, 1]) for (const scale of [1, sweep.THORG_SWEEP.rageScale]) {
    for (const progress of [0, 0.25, 0.35, 0.5, 0.65, 0.75, 1]) {
      const h = harness(); h.body._thorgVisualScale = scale;
      const weapon = weaponModule.startThorgSweep(h.scene, h.body, { direction });
      h.tick(sweep.THORG_SWEEP.windupMs + sweep.THORG_SWEEP.strikeMs * progress);
      const head = sweep.sampleThorgSweep({ x: h.body.x, y: h.body.y, direction, scale }, progress);
      const offset = weapon.displayHeight / 71 * 39.5;
      assert.ok(Math.abs((h.body.x + (weapon.x - h.body.x) / 0.9) + Math.cos(weapon.rotation + Math.PI / 2) * offset - head.x) < 0.001);
      assert.ok(Math.abs(weapon.y + 3 * scale + Math.sin(weapon.rotation + Math.PI / 2) * offset - head.y) < 0.001);
      h.body.destroy();
    }
  }
});

test('attack pose follows sweep phase and releases the animation clock on cleanup', () => {
  const h = harness();
  h.body.setFrame = name => { h.body.frame.name = name; };
  let paused = false;
  h.body.anims.pause = () => { paused = true; };
  h.body.anims.resume = () => { paused = false; };
  weaponModule.startThorgSweep(h.scene, h.body);
  h.tick(sweep.THORG_SWEEP.windupMs + sweep.THORG_SWEEP.strikeMs * 0.35);
  assert.equal(h.body.frame.name, 'throw01');
  assert.equal(paused, true);
  h.tick(sweep.THORG_SWEEP.strikeMs * 0.3);
  assert.equal(h.body.frame.name, 'throw03');
  h.tick(500);
  assert.equal(paused, false);
});
