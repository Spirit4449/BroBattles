const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const code = require('@babel/core').transformSync(
  fs.readFileSync('src/client/game/characters/ozzy/effects.js', 'utf8'),
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
  const sprites = Object.fromEntries(['ozzy', 'ally'].map(name => [name,
    Object.assign(new EventEmitter(), { active: true, visible: true, body: { enable: true }, x: 100, y: 100 })]));
  api.playOzzyArcaneSurge(scene, { caster: 'ozzy', recipients: [
    { username: 'ozzy', type: 'rage' }, { username: 'ally', type: 'shield' },
  ] }, name => sprites[name]);
  return { scene, sprites, objects, tweens };
}

test('completion and shutdown dispose beam objects and listeners', () => {
  for (const finish of [s => s.tweens[0].onComplete(), s => s.scene.events.emit('shutdown'), s => s.sprites.ally.emit('destroy')]) {
    const state = setup(); finish(state);
    assert.ok(state.objects.every(item => !item.active));
    assert.equal(state.scene.events.listenerCount('update'), 0);
    assert.equal(state.sprites.ozzy.listenerCount('destroy'), 0);
  }
});

const rig = require('../src/client/game/characters/shared/rig.js');
const castCode = require('@babel/core').transformSync(
  fs.readFileSync('src/client/game/characters/ozzy/superCast.js', 'utf8'),
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
  const ozzy = Object.assign(new EventEmitter(), { active: true, x: 200, y: 300, depth: 20,
    _bbCharacter: 'ozzy', frame: { name: 'special00', realWidth: 231, realHeight: 190 }, scaleX: 1, scaleY: 1,
    displayWidth: 231, displayHeight: 190, originX: 0.5, originY: 0.5, body: { enable: true } }, sprite);
  const handle = api.playOzzySuperCast(scene, ozzy);
  const at = ms => { for (let t = at.last || 0; t < ms; t += 16) scene.events.emit('postupdate', 0, Math.min(16, ms - t)); at.last = ms; return layers; };
  return { api, scene, ozzy, layers, handle, at };
}

test('super cast mirrors with the ozzy, replaces a running cast and cleans up', () => {
  const right = castSetup(), left = castSetup({ flipX: true });
  const tipR = rig.rigPoint(right.ozzy, 'staffTip'), tipL = rig.rigPoint(left.ozzy, 'staffTip');
  assert.equal(tipR.x - right.ozzy.x, -(tipL.x - left.ozzy.x));
  const { api, scene, ozzy, layers } = right;
  api.playOzzySuperCast(scene, ozzy);
  assert.ok(layers.slice(0, 3).every(l => !l.active) && layers[3].active, 'a recast replaces the old effect');
  ozzy.body.enable = false;
  scene.events.emit('postupdate', 0, 16);
  assert.ok(layers.every(l => !l.active), 'death clears it');
  for (const name of ['update', 'postupdate', 'shutdown', 'presentation:reset']) assert.equal(scene.events.listenerCount(name), 0);
  assert.equal(ozzy.listenerCount('destroy'), 0);
});
test('super cast leaves with the special pose instead of outliving it', () => {
  const { api, layers, at, ozzy } = castSetup({ frame: { name: 'special00' } });
  at(api.SUPER_TIMELINE.blastMs + 300);
  ozzy.frame = { name: 'special05' };
  at(api.SUPER_TIMELINE.blastMs + 400);
  assert.ok(layers.every(l => l.active), 'still running while he holds the blast frame');
  ozzy.frame = { name: 'idle00' };
  at(api.SUPER_TIMELINE.blastMs + 400 + api.SUPER_TIMELINE.exitMs + 32);
  assert.ok(layers.every(l => !l.active), 'gone shortly after he returns to idle');
});
