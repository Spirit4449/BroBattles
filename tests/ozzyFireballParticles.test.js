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
const art = load('src/client/game/characters/ozzy/fireballArt.js');
const particles = load('src/client/game/characters/ozzy/fireballParticles.js',
  name => name.includes('fireballArt') ? art : require('../src/shared/projectilePresentation'));
const attackImports = name => {
  if (name.includes('projectilePresentation')) return require('../src/shared/projectilePresentation');
  if (name.includes('fireballParticles')) return { createFireballParticles: () => ({ stop() {}, destroy() {} }), spawnFireballBurst() {} };
  if (name.includes('fireballArt')) return art;
  if (name.includes('launchRamp')) return require('../src/shared/combat/launchRamp');
  if (name.includes('renderLayers')) return { RENDER_LAYERS: { ATTACKS: 60 } };
  if (name.includes('shared/rig')) return require('../src/client/game/characters/shared/rig.js');
  if (name.includes('characterRig')) return require('../src/shared/characters/characterRig');
  if (name.includes('attachToPlayer')) return require('../src/client/game/characters/shared/attachToPlayer.js');
  if (name.includes('characterTuning')) return { getResolvedCharacterAttackConfig: () => ({ activeScale: 0.5, castDelayMs: 520, speed: 450, range: 1050, forwardOffset: 0.23, verticalOffset: 0.12, baseAngleDeg: -90, bobAmplitude: 0, bobFreqMs: 120 }) };
  if (name.includes('runtimeId')) return { createRuntimeId: () => 'test' };
  if (name.includes('shotPrediction')) return { shotBlockerContact: () => null };
  return {};
};
function particleScene() {
  const emitters = [];
  const scene = { events: new EventEmitter(), textures: { exists: () => true, get: () => ({ get: name => ({ name }) }) }, add: {
    particles: (_x, _y, texture, config) => {
      const emitter = { texture, config, calls: [], setDepth(depth) { this.depth = depth; return this; },
        emitParticleAt(...args) { this.calls.push(args); }, explode(...args) { this.exploded = args; },
        destroy() { this.destroyed = true; } };
      emitters.push(emitter); return emitter;
    },
  } };
  return { scene, emitters };
}

test('impact burst sprays pixels once and cleans itself up', () => {
  const { scene, emitters } = particleScene();
  let timer;
  scene.time = { delayedCall: (_ms, fn) => (timer = fn) };
  particles.spawnFireballBurst(scene, 10.4, 20.6, { _bbTeamColor: 0xff413f });
  assert.equal(emitters.length, 1);
  assert.deepEqual(emitters[0].exploded.slice(1), [10, 21]);
  timer();
  assert.ok(emitters[0].destroyed);
  assert.equal(scene.events.listenerCount('shutdown'), 0);
  assert.equal(scene.events.listenerCount('presentation:reset'), 0);
  particles.spawnFireballBurst(scene, 0, 0, null);
  scene.events.emit('presentation:reset');
  assert.ok(emitters[1].destroyed, 'a match reset clears live bursts');
});

test('a fireball impact plays the team explosion once and cleans it up', () => {
  const attack = load('src/client/game/characters/ozzy/attack.js', attackImports);
  const sprites = [];
  const created = [];
  function object(x = 0, y = 0, texture = null) {
    const o = Object.assign(new EventEmitter(), { active: true, x, y, texture, anims: { play(key) { this.key = key; }, stop() {} },
      destroy() { this.active = false; this.emit('destroy'); } });
    for (const m of ['setScale', 'setOrigin', 'setAngle', 'setDepth', 'setStrokeStyle', 'setVisible', 'setFrame', 'setBlendMode', 'setRotation'])
      o[m] = () => o;
    sprites.push(o);
    return o;
  }
  const tweens = [];
  const scene = { events: new EventEmitter(), textures: { exists: () => true },
    anims: { exists: key => created.includes(key), create: config => created.push(config.key) },
    add: { sprite: object, circle: object }, time: { delayedCall() {} },
    tweens: { add: config => { const tween = { ...config, targets: [config.targets], stop() {} }; tweens.push(tween); return tween; }, killTweensOf() {} } };
  const enemy = object(300, 100);
  enemy._bbTeamColor = 0xff413f;
  attack.spawnOzzyFireballVisual(scene, { id: 'remote', angle: Math.PI }, enemy);
  tweens[tweens.length - 1].onComplete();
  const booms = sprites.filter(o => String(o.texture).startsWith('ozzy-explosion'));
  assert.equal(booms.length, 1);
  assert.equal(booms[0].texture, 'ozzy-explosion-red');
  assert.equal(booms[0].anims.key, 'ozzy-explosion-red:burst');
  booms[0].emit('animationcomplete');
  assert.equal(booms[0].active, false);
  assert.equal(scene.events.listenerCount('presentation:reset'), 0);
  assert.equal(scene.events.listenerCount('shutdown'), 0);
});

test('charge holds its size and reuses its animated sprite on release', () => {
  const attack = load('src/client/game/characters/ozzy/attack.js', attackImports);
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
  assert.equal(attack.getOzzyStaffTip(owner).x, 126.5);
  assert.equal(attack.getOzzyStaffTip(owner).y, 77);
  owner.flipX = true;
  assert.equal(attack.getOzzyStaffTip(owner).x, 73.5);
  owner.flipX = false;
  const sprite = attack.chargeOzzyFireball(scene, owner, { id: 'cast', angle: 0 });
  scene.events.emit('postupdate', 0, 90);
  assert.equal(sprite.frameName, 'fire02');
  assert.equal(sprite.scale, 0.5, 'growth is baked into the spawn frames');
  owner.x = 150;
  scene.events.emit('postupdate', 0, 450);
  assert.equal(sprite.frameName, 'fire15');
  scene.events.emit('postupdate', 0, 100);
  assert.equal(sprite.frameName, 'fire15', 'spawn holds and never loops');
  const x = sprite.x;
  const flight = attack.spawnOzzyFireballVisual(scene, { id: 'cast', angle: 0, start: { x: x + 10, y: sprite.y } }, owner);
  assert.equal(flight, sprite);
  assert.equal(flight.anims.key, 'ozzy-fireball-unified:flight');
  assert.equal(flight.x, x);
  assert.equal(flight.scale, 0.5);
  const travel = tweens[tweens.length - 1];
  travel.targets[0].t = 0;
  travel.onUpdate(travel);
  assert.equal(flight.x, x, 'first flight frame stays on the charged core');
  assert.equal(scene._ozzyCharges.size, 0);
  assert.equal(owner.listenerCount('destroy'), 0);
  scene.events.emit('presentation:reset');
  assert.equal(sprite.active, false);
  const enemy = object(300, 100);
  enemy._bbTeamColor = 0xff413f;
  const remote = attack.spawnOzzyFireballVisual(scene, { id: 'remote', angle: Math.PI }, enemy);
  assert.ok(remote.active, 'opponent fireballs spawn without a local charge');
  assert.equal(remote._bbTeamColor, 0xff413f);
  assert.equal(remote.anims.key, 'ozzy-fireball-red:flight');
  scene.events.emit('presentation:reset');
  assert.equal(remote.active, false);
});
