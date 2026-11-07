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
const art = load('src/client/game/characters/wizard/fireballArt.js');
const particles = load('src/client/game/characters/wizard/fireballParticles.js',
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
test('trail pixels scatter from the back of the ball, behind it, and drain cleanly', () => {
  const { scene, emitters } = particleScene();
  const sprite = { active: true, x: 100, y: 80, scaleX: 0.5, depth: 100 };
  const wake = particles.createFireballParticles(scene, sprite, 0);
  sprite.x = 124;
  scene.events.emit('postupdate', 0, 48);
  assert.ok(emitters.length >= 2);
  assert.ok(emitters.every(e => e.depth < sprite.depth && e.texture === 'wizard-fire-pixels'));
  const calls = emitters.flatMap(e => e.calls);
  assert.ok(calls.length > 6);
  assert.ok(calls.every(c => Number.isInteger(c[0]) && Number.isInteger(c[1]) && c[0] < 124));
  assert.ok(calls.some(c => c[1] < 80) && calls.some(c => c[1] > 80), 'spread to both sides of the path');
  // Pixels cool through the fireball palette in whole steps by swapping to
  // pre-coloured frames, which also works where the renderer ignores tint.
  const flame = emitters[0].config;
  const p = {};
  flame.tint.onEmit(p);
  assert.equal(p.frame.name, `blue-${p._bbShape}-core`);
  const frames = [0, 0.3, 0.6, 0.99].map(t => (flame.tint.onUpdate(p, 'tint', t), p.frame.name));
  assert.equal(new Set(frames).size, 4);
  assert.ok(frames[3].endsWith('-edge'));
  const start = flame.scale.onEmit(p);
  assert.ok(flame.scale.onUpdate(p, 'scale', 0.9) < start);
  const emitted = calls.length;
  wake.stop();
  scene.events.emit('postupdate', 0, 100);
  assert.equal(emitters.flatMap(e => e.calls).length, emitted, 'no new pixels once stopped');
  assert.ok(emitters.every(e => !e.destroyed), 'live pixels finish their life');
  scene.events.emit('postupdate', 0, 1000);
  assert.ok(emitters.every(e => e.destroyed));
  assert.equal(scene.events.listenerCount('postupdate'), 0);
  assert.equal(scene.events.listenerCount('shutdown'), 0);
});
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
test('explosion art: a hot pop that swells into a rising ring of flame and cools into smoke', () => {
  const { EXPLOSION_COLS: W, EXPLOSION_ROWS: H, EXPLOSION_FRAMES: N, EXPLOSION_ORIGIN } = art;
  const cy = Math.round(EXPLOSION_ORIGIN.y * H - 0.5);
  const frames = Array.from({ length: N }, (_, f) => art.explosionFrameCells(f));
  const count = (cells, test) => cells.reduce((n, c) => n + (test(c) ? 1 : 0), 0);
  const fire = c => c > 1 && c < 6;
  for (const [f, cells] of frames.entries()) {
    for (let x = 0; x < W; x++) assert.ok(!cells[x] && !cells[(H - 1) * W + x], `frame ${f} clear top/bottom`);
    for (let y = 0; y < H; y++) assert.ok(!cells[y * W] && !cells[y * W + W - 1], `frame ${f} clear sides`);
  }
  assert.ok(count(frames[0], c => c === 5) > count(frames[0], fire) / 2, 'opens on a white-hot pop');
  const peak = frames.reduce((best, cells, f) => (count(cells, fire) > count(frames[best], fire) ? f : best), 0);
  assert.ok(peak > 1 && count(frames[peak], fire) > count(frames[0], fire) * 4, 'swells well past the ball');
  const above = cells => cells.reduce((n, c, i) => n + (fire(c) && Math.floor(i / W) < cy ? 1 : 0), 0);
  assert.ok(above(frames[peak]) > count(frames[peak], fire) / 2, 'flames lick upward');
  // After the pop the middle burns out, leaving a ring of flame.
  const cx = Math.round(EXPLOSION_ORIGIN.x * W - 0.5);
  const ring = frames[Math.round(N / 2)];
  assert.equal(ring[cy * W + cx], 0, 'the centre burns out into a ring');
  assert.ok(count(ring, fire) > count(frames[0], fire) * 2);
  const last = frames[N - 1];
  assert.equal(count(last, c => c >= 4 && c < 6), 0, 'the end has cooled');
  assert.ok(count(last, c => c === 6) > 0, 'and leaves smoke');
  assert.ok(count(last, fire) < count(frames[peak], fire) / 2, 'and breaks apart');
});
test('a fireball impact plays the team explosion once and cleans it up', () => {
  const attack = load('src/client/game/characters/wizard/attack.js', attackImports);
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
  attack.spawnWizardFireballVisual(scene, { id: 'remote', angle: Math.PI }, enemy);
  tweens[tweens.length - 1].onComplete();
  const booms = sprites.filter(o => String(o.texture).startsWith('wizard-explosion'));
  assert.equal(booms.length, 1);
  assert.equal(booms[0].texture, 'wizard-explosion-red');
  assert.equal(booms[0].anims.key, 'wizard-explosion-red:burst');
  booms[0].emit('animationcomplete');
  assert.equal(booms[0].active, false);
  assert.equal(scene.events.listenerCount('presentation:reset'), 0);
  assert.equal(scene.events.listenerCount('shutdown'), 0);
});
test('fireball art: round leading face, grows on the staff, never clips its frame', () => {
  const { FIREBALL_COLS: W, FIREBALL_ROWS: H, FIREBALL_ORIGIN } = art;
  const cx = Math.round(FIREBALL_ORIGIN.x * W - 0.5), cy = Math.round(FIREBALL_ORIGIN.y * H - 0.5);
  const filled = f => art.fireballFrameCells(f).reduce((n, c) => n + (c > 0), 0);
  for (const [a, b] of [[0, 4], [4, 8], [8, 15]]) assert.ok(filled(b) > filled(a), `spawn grows from frame ${a} to ${b}`);
  for (let f = 0; f < 32; f++) {
    const cells = art.fireballFrameCells(f);
    for (let x = 0; x < W; x++) assert.ok(!cells[x] && !cells[(H - 1) * W + x], `frame ${f} clear top/bottom`);
    for (let y = 0; y < H; y++) assert.ok(!cells[y * W] && !cells[y * W + W - 1], `frame ${f} clear sides`);
    if (f < 16) continue;
    const run = (dx, dy) => { let n = 0; while (cells[(cy + dy * (n + 1)) * W + cx + dx * (n + 1)]) n++; return n; };
    const [left, right, front] = [run(-1, 0), run(1, 0), run(0, 1)];
    assert.ok(Math.abs(left - right) <= 1 && Math.abs(front - left) <= 1, `frame ${f} leading face is round`);
    const area = rows => rows.reduce((n, y) => n + cells.slice(y * W, y * W + W).filter(Boolean).length, 0);
    const rows = [...Array(H).keys()];
    assert.ok(area(rows.filter(y => y < cy)) > area(rows.filter(y => y > cy)) * 1.1, `frame ${f} trails flame behind`);
    assert.equal(cells[cy * W + cx], 5, 'hot core at the anchor');
  }
});
test('charge holds its size and reuses its animated sprite on release', () => {
  const attack = load('src/client/game/characters/wizard/attack.js', attackImports);
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
  const enemy = object(300, 100);
  enemy._bbTeamColor = 0xff413f;
  const remote = attack.spawnWizardFireballVisual(scene, { id: 'remote', angle: Math.PI }, enemy);
  assert.ok(remote.active, 'opponent fireballs spawn without a local charge');
  assert.equal(remote._bbTeamColor, 0xff413f);
  assert.equal(remote.anims.key, 'wizard-fireball-red:flight');
  scene.events.emit('presentation:reset');
  assert.equal(remote.active, false);
});
