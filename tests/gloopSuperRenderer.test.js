const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const babel = require('@babel/core');
const code = babel.transformSync(fs.readFileSync('src/characters/gloop/special.js', 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code;
const animationApi = {};
vm.runInNewContext(babel.transformSync(fs.readFileSync('src/characters/gloop/handAnimation.js', 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code, { exports: animationApi });
function setup(animated = false) {
  const api = {}, objects = [], sounds = [];
  function object(x = 0, y = 0) {
    const o = new EventEmitter();
    Object.assign(o, { x, y, active: true, paths: [], lines: [],
      setOrigin() { return this; },
      setFrame(frame) { this.frame = frame; return this; },
      setVisible(visible) { this.visible = visible; return this; },
      setRotation(rotation) { this.rotation = rotation; return this; },
      lineTo(x, y) { this.lines.push({ x, y }); return this; },
      setPosition(x, y) { this.x = x; this.y = y; return this; },
      setScale(x, y) { this.scaleX = x; this.scaleY = y; return this; },
      setTexture(key) { this.texture = key; return this; },
      moveTo(x, y) { this.paths.push({ x, y }); return this; },
      clear() { this.paths = []; this.lines = []; return this; },
      destroy() { this.active = false; this.emit('destroy'); },
    });
    for (const method of ['setDepth', 'fillStyle', 'beginPath', 'closePath', 'fillPath', 'lineStyle', 'strokePath', 'lineBetween', 'fillEllipse', 'fillRect']) o[method] = () => o;
    objects.push(o); return o;
  }
  const scene = { events: new EventEmitter(), textures: { exists: () => true },
    add: { sprite: object, graphics: object }, sound: { play: key => sounds.push(key) } };
  const owner = object(100, 200); owner.displayWidth = 80; owner.displayHeight = 100;
  vm.runInNewContext(code, { exports: api, require: name => name.includes('handAnimation') ? { ...animationApi, prepareHandAnimation: () => animated } : name.includes('characterTuning')
    ? { getResolvedCharacterSpecialConfig: () => ({ visualScale: 0.28 }) }
    : name.includes('gloopHookGeometry') ? require('../src/shared/gloopHookGeometry.js')
    : name.includes('renderLayers') ? { RENDER_LAYERS: { ATTACKS: 20 } } : { playSpriteAnimation() {} } });
  const launch = () => api.playHookAction(scene, owner, { id: 'hook1', start: { x: 120, y: 180 }, angle: 0, range: 500, speed: 1000 }, true);
  const frame = (ms = 50) => scene.events.emit('update', 0, ms);
  return { api, scene, owner, objects, sounds, launch, frame };
}
test('hand follows constant-speed attack while wrist follows moving caster', () => {
  const f = setup(); f.launch(); f.frame();
  assert.equal(f.objects[1].x, 170);
  f.owner.x += 80; f.frame();
  assert.equal(f.objects[1].x, 220);
  assert.ok(Math.abs(f.objects[2].paths.at(-1).x - 188.4) < 0.001);
});

test('missed hand dissipates at maximum range instead of returning', () => {
  const f = setup(); f.launch();
  for (let i = 0; i < 10; i++) f.frame(50);
  const hand = f.objects[1];
  assert.equal(hand.x, 620);
  assert.equal(hand.visible, false);
  for (let i = 0; i < 4; i++) f.frame(50);
  assert.equal(hand.x, 620);
});

test('live hook socket uses the visible physics body rather than transparent frame center', () => {
  const f = setup();
  f.owner.body = { width: 36, height: 44, center: { x: 102, y: 248 } };
  f.api.playHookAction(f.scene, f.owner, { id: 'body-hook', angle: 0,
    range: 500, speed: 1000 }, true);
  const hand = f.objects[1];
  assert.ok(Math.abs(hand.x - 114.6) < 0.001);
  assert.equal(hand.y, 248);
});
test('catch closes at contact, uses pull duration and rejects stale/duplicate packets', () => {
  const f = setup(); f.launch(); f.frame();
  const catchData = { id: 'hook1', start: { x: 300, y: 180 }, end: { x: 150, y: 180 }, pullDurationMs: 200 };
  f.api.playHookCatchAction(f.scene, f.owner, { ...catchData, id: 'old' });
  assert.equal(f.objects[1].x, 170);
  f.api.playHookCatchAction(f.scene, f.owner, catchData);
  assert.equal(f.objects[1].texture, 'gloop-hand-closed');
  assert.equal(f.objects[1].x, 300);
  f.api.playHookCatchAction(f.scene, f.owner, catchData);
  assert.equal(f.sounds.filter(s => s === 'gloop-pull').length, 1);
  for (let i = 0; i < 4; i++) f.frame();
  assert.equal(f.objects[1].x, 150);
  for (let i = 0; i < 12; i++) f.frame();
  assert.equal(f.scene.events.listenerCount('update'), 0);
});
test('duplicate launch, recast, owner destruction and shutdown clean up visuals', () => {
  const f = setup(); f.launch(); f.launch();
  assert.equal(f.scene.events.listenerCount('update'), 1);
  assert.equal(f.sounds.length, 1);
  f.api.playHookAction(f.scene, f.owner, { id: 'hook2', angle: 0 });
  assert.equal(f.objects[1].active, false);
  assert.equal(f.scene.events.listenerCount('update'), 1);
  f.owner.destroy();
  assert.equal(f.scene.events.listenerCount('update'), 0);
  assert.equal(f.scene.events.listenerCount('shutdown'), 0);
  const g = setup(); g.launch(); g.scene.events.emit('shutdown');
  assert.ok(g.objects.slice(1).every(o => !o.active));
});

test('caught hand stays attached to the rendered victim as the pull destination moves', () => {
  const f = setup(); f.launch();
  const victim = { active: true, username: 'victim', x: 300, y: 180 };
  f.scene.children = { list: [victim] };
  f.api.playHookCatchAction(f.scene, f.owner, { id: 'hook1', target: 'victim',
    start: { x: 300, y: 180 }, end: { x: 150, y: 180 }, pullDurationMs: 200 });
  victim.x = 230; victim.y = 165; f.frame();
  assert.equal(f.objects[1].x, 230); assert.equal(f.objects[1].y, 165);
  victim.x = 185; f.frame(); assert.equal(f.objects[1].x, 185);
});

test('authored grip frames unfurl, close progressively and release without a texture jump', () => {
  const f = setup(true); f.launch();
  const hand = f.objects[1]; assert.equal(hand.frame, 7);
  for (let i = 0; i < 3; i++) f.frame(50);
  assert.equal(hand.frame, 0);
  f.api.playHookCatchAction(f.scene, f.owner, { id: 'hook1',
    start: { x: 300, y: 180 }, end: { x: 150, y: 180 }, pullDurationMs: 640 });
  f.frame(32); assert.equal(hand.frame, 2);
  f.frame(32); assert.equal(hand.frame, 4);
  f.frame(48); assert.equal(hand.frame, 7);
  for (let i = 0; i < 6; i++) f.frame(80);
  assert.ok(hand.frame < 7);
});
test('ribbon overlaps the wrist and widens to its sprite silhouette', () => {
  const f = setup(true); f.owner.y = 192; f.launch();
  for (let i = 0; i < 5; i++) f.frame(50);
  const hand = f.objects[1], arm = f.objects[2];
  const tip = arm.lines[31];
  const wristBack = hand.x - 128 * 0.42 * hand.scaleX;
  assert.ok(tip.x > wristBack && tip.x < hand.x);
  assert.ok(Math.abs(tip.y - hand.y) > 10);
});
