const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const code = require('@babel/core').transformSync(
  fs.readFileSync('src/characters/wizard/effects.js', 'utf8'),
  { babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]] },
).code;
function setup() {
  const api = {}, objects = [], tweens = [];
  vm.runInNewContext(code, { exports: api, require: () => ({}) });
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
