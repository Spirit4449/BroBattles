const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const babel = require('@babel/core');
function load(file, imports = () => ({})) {
  const exports = {};
  const code = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  vm.runInNewContext(code, { exports, require: imports, Phaser: { Math: { RadToDeg: r => r * 180 / Math.PI } } });
  return exports;
}
const particles = load('src/characters/wizard/fireballParticles.js');
test('pixel particles spread across the rear on both render layers and drain cleanly', () => {
  const emitters = [];
  const scene = { events: new EventEmitter(), textures: { exists: () => true }, add: {
    particles: (_x, _y, texture, config) => {
      const emitter = { texture, config, calls: [], setDepth(depth) { this.depth = depth; return this; },
        emitParticleAt(...args) { this.calls.push(args); }, destroy() { this.destroyed = true; } };
      emitters.push(emitter); return emitter;
    },
  } };
  const sprite = { active: true, x: 100, y: 80, scaleX: 0.5, depth: 100 };
  const wake = particles.createFireballParticles(scene, sprite, 0);
  sprite.x = 124;
  scene.events.emit('postupdate', 0, 48);
  assert.deepEqual(emitters.map(e => e.depth), [98, 99]);
  for (const e of emitters) {
    assert.equal(e.texture, 'wizard-fire-pixels');
    assert.equal(e.calls.length, 18);
    assert.ok(e.calls.every(c => Number.isInteger(c[0]) && Number.isInteger(c[1]) && c[0] < 124));
    assert.ok(e.calls.some(c => c[1] < 80));
    assert.ok(e.calls.some(c => c[1] > 80));
  }
  wake.stop();
  scene.events.emit('postupdate', 0, 100);
  assert.ok(emitters.every(e => !e.destroyed && e.calls.length === 18));
  scene.events.emit('postupdate', 0, 300);
  assert.ok(emitters.every(e => e.destroyed));
  assert.equal(scene.events.listenerCount('postupdate'), 0);
  assert.equal(scene.events.listenerCount('shutdown'), 0);
});
test('charge holds its size and reuses its animated sprite on release', () => {
  const attack = load('src/characters/wizard/attack.js', name => {
    if (name.includes('fireballFrames')) return { getSteadyFireballTexture: () => 'wizard-fireball-steady' };
    if (name.includes('fireballParticles')) return { createFireballParticles: () => ({ stop() {}, destroy() {} }) };
    if (name.includes('renderLayers')) return { RENDER_LAYERS: { ATTACKS: 60 } };
    if (name.includes('characterTuning')) return { getResolvedCharacterAttackConfig: () => ({ activeScale: 0.5, castDelayMs: 520, speed: 450, range: 1050, forwardOffset: 0.23, verticalOffset: 0.12, baseAngleDeg: -90, bobAmplitude: 0, bobFreqMs: 120 }) };
    if (name.includes('runtimeId')) return { createRuntimeId: () => 'test' };
    return {};
  });
  function object(x = 0, y = 0) {
    const o = Object.assign(new EventEmitter(), { active: true, x, y, anims: { play(key) { this.key = key; }, stop() {} }, destroy() { this.active = false; this.emit('destroy'); } });
    for (const m of ['setScale', 'setOrigin', 'setAngle', 'setDepth', 'setStrokeStyle', 'setVisible', 'setFrame', 'setBlendMode']) o[m] = value => { if (m === 'setScale') o.scale = value; if (m === 'setFrame') o.frameName = value; return o; };
    return o;
  }
  const tweens = [];
  const scene = { events: new EventEmitter(), textures: { exists: () => true }, anims: { exists: () => true },
    add: { sprite: object, circle: object }, tweens: { add: config => { const tween = { ...config, targets: [config.targets], stop() {} }; tweens.push(tween); return tween; }, killTweensOf() {} } };
  const owner = object(100, 100);
  owner.frame = { name: 'attack03' };
  assert.equal(attack.getWizardStaffTip(owner).x, 126.5);
  assert.equal(attack.getWizardStaffTip(owner).y, 77);
  owner.flipX = true;
  assert.equal(attack.getWizardStaffTip(owner).x, 73.5);
  owner.flipX = false;
  const sprite = attack.chargeWizardFireball(scene, owner, { id: 'cast', angle: 0 });
  scene.events.emit('postupdate', 0, 90);
  assert.equal(sprite.frameName, 'fire02');
  assert.equal(sprite.scale, 0.5, 'growth is baked into the spawn frames');
  owner.x = 150;
  scene.events.emit('postupdate', 0, 450);
  assert.equal(sprite.frameName, 'fire15');
  scene.events.emit('postupdate', 0, 100);
  assert.equal(sprite.frameName, 'fire15', 'spawn holds and never loops');
  const x = sprite.x;
  const flight = attack.spawnWizardFireballVisual(scene, { id: 'cast', angle: 0, start: { x: x + 10, y: sprite.y } }, owner);
  assert.equal(flight, sprite);
  assert.equal(flight.anims.key, 'wizard-fireball-unified:flight');
  assert.equal(flight.x, x);
  assert.equal(flight.scale, 0.5);
  const travel = tweens[tweens.length - 1];
  travel.targets[0].t = 0;
  travel.onUpdate(travel);
  assert.equal(flight.x, x, 'first flight frame stays on the charged core');
  assert.equal(scene._wizardCharges.size, 0);
  assert.equal(owner.listenerCount('destroy'), 0);
  scene.events.emit('presentation:reset');
  assert.equal(sprite.active, false);
});
