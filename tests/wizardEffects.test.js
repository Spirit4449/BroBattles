const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const code = require('@babel/core').transformSync(
  fs.readFileSync('src/client/game/characters/wizard/effects.js', 'utf8'),
  { babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]] },
).code;
const { POWERUP_CATALOG } = require('../src/shared/powerups');
const stubs = {
  '../../../../shared/characters/characterTuning.js': require('../src/shared/characters/characterTuning.js'),
  '../shared/rig': require('../src/client/game/characters/shared/rig.js'),
  '../shared/attachToPlayer': require('../src/client/game/characters/shared/attachToPlayer.js'),
  '../../powerups/powerupConfig': {
    POWERUP_COLORS: Object.fromEntries(Object.entries(POWERUP_CATALOG).map(([key, entry]) => [key, entry.color])),
  },
};
function setup() {
  const api = {}, objects = [], tweens = [];
  vm.runInNewContext(code, { exports: api, require: id => stubs[id] || {} });
  function object() {
    const item = { calls: [], active: true, destroy() { this.active = false; } };
    for (const key of ['setDepth', 'setBlendMode', 'setDisplaySize', 'setOrigin', 'setAlpha', 'fillStyle', 'fillRect', 'clear', 'lineStyle', 'lineBetween', 'fillCircle', 'strokeCircle']) item[key] = (...args) => { item.calls.push({ key, args }); return item; };
    objects.push(item);
    return item;
  }
  const scene = { events: new EventEmitter(), textures: { exists: () => false },
    add: { graphics: object, text: object }, tweens: { add(config) {
      const tween = { ...config, stopped: false, stop() { this.stopped = true; } };
      tweens.push(tween); return tween;
    } } };
  const sprites = Object.fromEntries(['wizard', 'ally'].map(name => [name,
    Object.assign(new EventEmitter(), { active: true, visible: true, body: { enable: true }, x: 100, y: 100 })]));
  api.playWizardArcaneSurge(scene, { caster: 'wizard', recipients: [
    { username: 'wizard', type: 'rage' }, { username: 'ally', type: 'shield' },
  ] }, name => sprites[name]);
  return { scene, sprites, objects, tweens };
}
test('surge excludes self and follows the living teammate', () => {
  const { sprites, objects, tweens } = setup();
  assert.equal(tweens.length, 1);
  tweens[0].targets.elapsed = 400;
  sprites.ally.x = 350;
  tweens[0].onUpdate();
  assert.equal(objects[1].x, 350);
});
for (const who of ['ally', 'wizard']) test(`beam clears when ${who} dies but corpse stays active`, () => {
  const { scene, sprites, objects, tweens } = setup();
  sprites[who].body.enable = false;
  scene.events.emit('update');
  assert.ok(objects.every(item => !item.active));
  assert.equal(tweens[0].stopped, true);
  assert.equal(scene.events.listenerCount('update'), 0);
  assert.equal(scene.events.listenerCount('shutdown'), 0);
  assert.equal(sprites.ally.listenerCount('destroy'), 0);
});
test('completion and shutdown dispose beam objects and listeners', () => {
  for (const finish of [s => s.tweens[0].onComplete(), s => s.scene.events.emit('shutdown'), s => s.sprites.ally.emit('destroy')]) {
    const state = setup(); finish(state);
    assert.ok(state.objects.every(item => !item.active));
    assert.equal(state.scene.events.listenerCount('update'), 0);
    assert.equal(state.sprites.wizard.listenerCount('destroy'), 0);
  }
});

test('beam hits the physics center, bursts there, and clears from source to target', () => {
  const { sprites, objects, tweens } = setup();
  sprites.ally.body.center = { x: 500, y: 180 };
  const frame = ms => {
    objects[0].calls.length = 0;
    tweens[0].targets.elapsed = ms;
    tweens[0].onUpdate();
    return objects[0].calls;
  };
  const hit = frame(300);
  assert.equal(objects[1].x, 500);
  assert.equal(objects[1].y, 180);
  assert.ok(hit.some(c => c.key === 'strokeCircle' && c.args[0] === 500 && c.args[1] === 180));
  const clearing = frame(540).filter(c => c.key === 'lineBetween');
  assert.ok(clearing.length > 0);
  assert.ok(clearing.every(c => c.args[0] >= 300), 'cleared half near wizard is no longer drawn');
  assert.equal(frame(800).filter(c => c.key === 'lineBetween').length, 0);
  assert.equal(tweens[0].duration, 1000);
});

const rig = require('../src/client/game/characters/shared/rig.js');
const castCode = require('@babel/core').transformSync(
  fs.readFileSync('src/client/game/characters/wizard/superCast.js', 'utf8'),
  { babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]] },
).code;
function castSetup(sprite = {}) {
  const api = {}, layers = [];
  vm.runInNewContext(castCode, { exports: api, require: id => stubs[id] || {} });
  const scene = { events: new EventEmitter(), add: { graphics() {
    const g = { rects: [], active: true, depth: 0, setDepth(d) { this.depth = d; return this; }, setBlendMode(m) { this.blend = m; return this; },
      fillStyle(color, alpha) { this.style = { color, alpha }; }, clear() { this.rects = []; },
      fillRect(x, y, w, h) { this.rects.push({ x, y, w, h, ...this.style }); }, destroy() { this.active = false; } };
    layers.push(g); return g;
  } } };
  const wizard = Object.assign(new EventEmitter(), { active: true, x: 200, y: 300, depth: 20,
    _bbCharacter: 'wizard', frame: { name: 'special00', realWidth: 231, realHeight: 190 }, scaleX: 1, scaleY: 1,
    displayWidth: 231, displayHeight: 190, originX: 0.5, originY: 0.5, body: { enable: true } }, sprite);
  const handle = api.playWizardSuperCast(scene, wizard);
  const at = ms => { for (let t = at.last || 0; t < ms; t += 16) scene.events.emit('postupdate', 0, Math.min(16, ms - t)); at.last = ms; return layers; };
  return { api, scene, wizard, layers, handle, at };
}
test('super cast follows the special frames: tip charge, ground ring, then surge', () => {
  const { api, layers, at, wizard } = castSetup();
  const [glow, back, front] = layers;
  assert.ok(back.depth < wizard.depth && front.depth > wizard.depth, 'rune circle behind, sparks in front');
  assert.ok(glow.depth < wizard.depth && glow.blend === 'ADD', 'additive light sits behind him');
  const { plantMs, blastMs, endMs } = api.SUPER_TIMELINE;
  const tip = rig.rigPoint(wizard, 'staffTip');
  at(plantMs * 0.8);
  assert.ok(front.rects.some(r => Math.abs(r.x - tip.x) < 4 && Math.abs(r.y - tip.y) < 4), 'staff tip glows while raised');
  assert.equal(back.rects.length, 0);
  at(plantMs + 60);
  assert.ok(back.rects.length > 0, 'planting the staff sends a ring along the ground');
  const head = rig.rigPoint(wizard, 'orb');
  const lit = () => glow.rects.filter(r => r.y <= head.y && r.y + r.h > head.y && r.x <= head.x && r.x + r.w > head.x);
  at(blastMs + 60);
  const burst = lit().reduce((n, r) => n + r.alpha, 0);
  at(blastMs + 400);
  assert.ok(lit().length >= 3, 'stepped glow bands around the orb');
  assert.ok(burst > lit().reduce((n, r) => n + r.alpha, 0), 'the glow flares as the orb bursts, then settles');
  assert.ok(front.rects.length > 20 && back.rects.length > 20);
  assert.ok([...glow.rects, ...front.rects, ...back.rects].every(r => r.x % 2 === 0 && r.y % 2 === 0 && r.w % 2 === 0), 'drawn on the 2 px pixel grid');
  assert.ok(new Set(front.rects.map(r => r.alpha)).size <= 3, 'fades in whole steps');
  at(endMs + 20);
  assert.ok(layers.every(l => !l.active));
});
test('super cast mirrors with the wizard, replaces a running cast and cleans up', () => {
  const right = castSetup(), left = castSetup({ flipX: true });
  const tipR = rig.rigPoint(right.wizard, 'staffTip'), tipL = rig.rigPoint(left.wizard, 'staffTip');
  assert.equal(tipR.x - right.wizard.x, -(tipL.x - left.wizard.x));
  const { api, scene, wizard, layers } = right;
  api.playWizardSuperCast(scene, wizard);
  assert.ok(layers.slice(0, 3).every(l => !l.active) && layers[3].active, 'a recast replaces the old effect');
  wizard.body.enable = false;
  scene.events.emit('postupdate', 0, 16);
  assert.ok(layers.every(l => !l.active), 'death clears it');
  for (const name of ['update', 'postupdate', 'shutdown', 'presentation:reset']) assert.equal(scene.events.listenerCount(name), 0);
  assert.equal(wizard.listenerCount('destroy'), 0);
});
test('super cast leaves with the special pose instead of outliving it', () => {
  const { api, layers, at, wizard } = castSetup({ frame: { name: 'special00' } });
  at(api.SUPER_TIMELINE.blastMs + 300);
  wizard.frame = { name: 'special05' };
  at(api.SUPER_TIMELINE.blastMs + 400);
  assert.ok(layers.every(l => l.active), 'still running while he holds the blast frame');
  wizard.frame = { name: 'idle00' };
  at(api.SUPER_TIMELINE.blastMs + 400 + api.SUPER_TIMELINE.exitMs + 32);
  assert.ok(layers.every(l => !l.active), 'gone shortly after he returns to idle');
});
test('super cast joins a pose that is already showing instead of starting over', () => {
  const { api, scene, wizard } = castSetup();
  const { plantMs, endMs } = api.SUPER_TIMELINE;
  const before = scene.events.listenerCount('postupdate');
  assert.equal(api.playWizardSuperCast(scene, wizard, { elapsedMs: endMs }), null, 'a finished pose gets no effect');
  assert.equal(scene.events.listenerCount('postupdate'), before);
  const layers = [];
  const add = scene.add.graphics;
  scene.add.graphics = () => { const g = add(); layers.push(g); return g; };
  api.playWizardSuperCast(scene, wizard, { elapsedMs: plantMs + 60 });
  const [, back] = layers;
  assert.ok(back.rects.length > 0, 'the ground ring is already out on the first frame');
});
