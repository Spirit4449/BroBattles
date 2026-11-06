const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const babel = require('@babel/core');
const loadServerClock = require('./helpers/serverClockModule');
const loadShotPrediction = require('./helpers/shotPredictionModule');
const { characterHitBounds } = require('../src/shared/combat/shotContact');
const tuning = require('../src/shared/characters/characterTuning.js');

const compiled = new Map();
function load(file, require, globals = {}) {
  if (!compiled.has(file)) compiled.set(file, babel.transformSync(fs.readFileSync(file, 'utf8'), {
    babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code);
  const exports = {};
  vm.runInNewContext(compiled.get(file), { exports, require, ...globals });
  return exports;
}
const packetDedupe = load('src/client/game/characters/shared/packetDedupe.js', () => ({}), { Date });

// A scene with one enemy drawn standing so its body is centered on `centerY`.
function arena({ enemyX = 330, centerY = 298, character = 'wizard', clock = { now: () => 0 } } = {}) {
  const shots = loadShotPrediction({ serverClock: loadServerClock({ performance: { now: () => 0 } }), performance: clock });
  const box = characterHitBounds(character, 0, 0);
  const enemy = { active: true, visible: true, flipX: false, x: enemyX, y: centerY - (box.top + box.bottom) / 2,
    anims: { frames: 0, update() { this.frames++; } } };
  const sounds = [], impacts = [];
  // The real shared hit feedback, with the scene's burst helpers recorded.
  const feedback = load('src/client/game/characters/shared/hitFeedback.js', name =>
    name.includes('shotPrediction') ? shots : name.includes('attackDelivery') ? require('../src/shared/combat/attackDelivery')
      : { spawnDamageImpact: (_, sprite) => impacts.push({ sprite }), spawnDuckGuardImpact: (_, sprite) => impacts.push({ sprite, guard: true }) });
  shots.trackShotTargets({ localUsername: 'me', opponentPlayersRef: { foe: { opponent: enemy, character } },
    playHitSound: (who, sprite) => sounds.push({ who, sprite }),
    playHitFeedback: (sprite, options) => feedback.playHitFeedback(scene, sprite, options) });
  const delayed = [], tweens = [], objects = [];
  function object(x = 0, y = 0, radius = 0, color = null) {
    const o = Object.assign(new EventEmitter(), { x, y, radius, color, active: true, visible: true, alpha: 1 });
    for (const key of ['setDepth', 'setOrigin', 'setScale', 'setAngle', 'setAlpha', 'setVisible', 'setStrokeStyle', 'setBlendMode', 'setFrame', 'setRotation'])
      o[key] = (...args) => { if (key === 'setVisible') o.visible = args[0]; return o; };
    o.destroy = () => { o.active = false; o.emit('destroy'); };
    objects.push(o); return o;
  }
  const scene = { events: new EventEmitter(), textures: { exists: () => false }, children: { list: [] },
    add: { circle: object, sprite: object, graphics: object },
    tweens: { add: config => { tweens.push(config); return { stop() {} }; }, killTweensOf() {} },
    time: { delayedCall: (ms, fn) => delayed.push({ ms, fn }) },
    physics: { world: { bounds: { x: 0, y: 0, width: 3000, height: 1200 } } }, _mapObjects: [] };
  const caster = Object.assign(new EventEmitter(), { active: true, x: 100, y: 300, flipX: false, displayWidth: 150, displayHeight: 150,
    anims: { frames: 0, update() { this.frames++; } } });
  const runDelayed = () => { for (const job of delayed.splice(0).sort((a, b) => a.ms - b.ms)) job.fn(); };
  return { shots, enemy, scene, caster, delayed, tweens, objects, runDelayed, sounds, impacts, feedback };
}
const common = (f, extra = {}) => name =>
  name.includes('shotPrediction') ? f.shots : name.includes('shotContact') ? require('../src/shared/combat/shotContact')
    : name.includes('packetDedupe') ? packetDedupe : name.includes('characterTuning') ? tuning
      : name.includes('projectilePresentation') ? require('../src/shared/projectilePresentation')
        : name.includes('renderLayers') ? { RENDER_LAYERS: { ATTACKS: 20 } }
          : name.includes('runtimeId') ? { createRuntimeId: prefix => `${prefix}-1` }
            : name.includes('flipLock') ? { lockPlayerFlip: () => () => {}, enforceLockedFlip() {} }
              : name.includes('attackDelivery') ? require('../src/shared/combat/attackDelivery')
              : name.includes('thorgSweep') ? require('../src/shared/characters/thorgSweep')
              : name.includes('shared/characters/index') ? require('../src/shared/characters')
              : extra[Object.keys(extra).find(key => name.includes(key))] || { playSpriteAnimation() {}, playPlayerSound() {} };

test('requests carry the render time remote actors are drawn at, never an invented one', () => {
  const { shots } = arena();
  assert.deepEqual({ ...shots.withShotView({ type: 'x' }) }, { type: 'x' });
  shots.noteRemoteView(4321.5);
  assert.deepEqual({ ...shots.withShotView({ type: 'x', id: 'a' }) }, { type: 'x', id: 'a', viewMono: 4321.5 });
  shots.noteRemoteView(NaN);
  assert.equal(shots.withShotView({}).viewMono, 4321.5);
});

test('displayed targets use the server hit box at the drawn position; dead or hidden enemies are skipped', () => {
  const f = arena({ character: 'ninja' });
  const [foe] = f.shots.displayedShotTargets();
  assert.deepEqual({ ...foe.bounds }, characterHitBounds('ninja', f.enemy.x, f.enemy.y));
  f.enemy._ducking = true;
  assert.deepEqual({ ...f.shots.displayedShotTargets()[0].bounds }, characterHitBounds('ninja', f.enemy.x, f.enemy.y, { ducking: true }));
  f.enemy.visible = false;
  assert.equal(f.shots.displayedShotTargets().length, 0);
  f.enemy.visible = true;
  f.shots.setStaticShotTargets('mode', [{ name: 'vault:team2', inset: false, bounds: { left: 0, right: 1, top: 0, bottom: 1 } }]);
  assert.deepEqual([...f.shots.displayedShotTargets().map(t => t.name)], ['foe', 'vault:team2']);
  f.shots.setStaticShotTargets('mode', []);
  assert.equal(f.shots.predictShotContact({ x: 0, y: f.enemy.y }, { x: 1000, y: f.enemy.y }, 5).target.name, 'foe');
});

function wizard(f) {
  return load('src/client/game/characters/wizard/attack.js', common(f, {
    fireballParticles: { createFireballParticles: () => ({ stop() {}, destroy() {} }), spawnFireballBurst() {} },
    fireballArt: { ensureFireballTextures() {}, FIREBALL_ORIGIN: { x: 0.5, y: 0.7 } },
  }), { Phaser: { Math: { RadToDeg: r => r * 180 / Math.PI }, BlendModes: { ADD: 1 } } });
}
const FIREBALL = tuning.getResolvedCharacterAttackConfig('wizard', 'fireball');
const impacts = f => f.objects.filter(o => o.radius === FIREBALL.visualRadius && o.color === 0xffd9a0);

test('the caster\'s fireball leaves on time, bursts once on each enemy as drawn, and the echo is skipped', () => {
  const f = arena(), api = wizard(f);
  const payload = api.performWizardFireball({ scene: f.scene, player: f.caster }, { angle: 0 });
  assert.equal(f.delayed.find(job => job.ms === FIREBALL.castDelayMs) !== undefined, true);
  f.runDelayed();
  assert.equal(api.consumeWizardRelease(f.scene, payload.id), false, 'the server echo of this id is not drawn again');
  const flight = f.tweens.find(t => t.duration === Math.round(FIREBALL.range / FIREBALL.speed * 1000));
  for (let progress = 0; progress <= 1; progress += 0.01) {
    flight.targets.t = progress; flight.onUpdate({ targets: [{ t: progress }] });
  }
  assert.equal(impacts(f).length, 1, 'one burst for the one enemy it passes through');
  const box = characterHitBounds('wizard', f.enemy.x, f.enemy.y);
  assert.ok(Math.abs(impacts(f)[0].x - (box.left - FIREBALL.collisionRadius)) < 6, `burst at ${impacts(f)[0].x}`);
});

test('an interrupted wizard charge releases nothing, leaving the server echo to draw', () => {
  const f = arena(), api = wizard(f);
  const payload = api.performWizardFireball({ scene: f.scene, player: f.caster }, { angle: 0 });
  f.caster.emit('attack:interrupted');
  f.runDelayed();
  assert.equal(api.consumeWizardRelease(f.scene, payload.id), true);
});

test('other players\' fireballs never burst on this player\'s targets', () => {
  const f = arena(), api = wizard(f);
  api.spawnWizardFireballVisual(f.scene, { id: 'remote', angle: 0, direction: 1, start: { x: 134.5, y: 282 } }, f.caster);
  const flight = f.tweens.find(t => typeof t.onUpdate === 'function');
  for (let progress = 0; progress <= 1; progress += 0.01) flight.onUpdate({ targets: [{ t: progress }] });
  assert.equal(impacts(f).length, 0);
});

function gloop(f, finishes) {
  return load('src/client/game/characters/gloop/attack.js', common(f, {
    gloopProjectile: require('../src/shared/characters/gloopProjectile'),
    slimeVisual: { slimeRadius: (r) => r, createSlimeBud: () => ({ update: () => true, retract() {}, destroy() {} }),
      createSlimeVisual: (scene, state) => {
      let finished = false;
      return { body: { once() {} }, impact() {}, destroy() {}, state,
        update: () => !finished, finish(options = {}) { finished = true; finishes.push({ ...options, x: state.x, y: state.y }); } };
    } },
  }));
}

test('the thrower\'s slimeball splats on the enemy as drawn before the server confirms; the echo is skipped', () => {
  const finishes = [], f = arena({ enemyX: 350, centerY: 300, character: 'ninja' }), api = gloop(f, finishes);
  const payload = api.performGloopSlimeball({ scene: f.scene, player: f.caster }, { direction: 1, targetX: 350, targetY: 300 });
  f.runDelayed();
  assert.equal(api.consumeGloopRelease(f.scene, payload.id), false, 'the server echo of this id is not drawn again');
  for (let i = 0; i < 120 && !finishes.length; i++) f.scene.events.emit('update', 0, 16);
  assert.deepEqual([...finishes.map(entry => entry.onCharacter)], [true]);
  const box = characterHitBounds('ninja', f.enemy.x, f.enemy.y);
  assert.ok(finishes[0].x >= box.left - 18 - 1e-6, 'splat where the ball met the drawn body');
  // The server's splat for the same ball changes nothing.
  api.handleGloopSlimeSplat(f.scene, { id: payload.id, target: 'foe' });
  assert.equal(finishes.length, 1);
});

test('a slimeball thrown by another player is not ended by bodies on this screen', () => {
  const finishes = [], f = arena({ enemyX: 350, centerY: 300, character: 'ninja' }), api = gloop(f, finishes);
  api.spawnGloopSlimeballVisual(f.scene, { id: 'remote', direction: 1, angle: 0, start: { x: 130, y: 300 }, speed: 300, initialVy: 0 }, f.caster);
  for (let i = 0; i < 30; i++) f.scene.events.emit('update', 0, 16);
  assert.equal(finishes.length, 0);
});

test('every predicted hit plays its sound once at the target, holds a brief hitstop, and the server does not repeat it', () => {
  const clock = { t: 1000, now() { return this.t; } };
  const f = arena({ clock });
  const target = { name: 'foe', sprite: f.enemy };
  f.shots.notePredictedHit({ delivery: 'attached', character: 'thorg', target, attacker: f.caster });
  assert.deepEqual(f.sounds.map(s => [s.who, s.sprite === f.enemy]), [['thorg', true]]);
  // Both fighters' frames hold; then they run on.
  f.enemy.anims.update(0, 16); f.caster.anims.update(0, 16);
  assert.equal(f.enemy.anims.frames + f.caster.anims.frames, 0);
  clock.t += 200;
  f.enemy.anims.update(0, 16); f.caster.anims.update(0, 16);
  assert.equal(f.enemy.anims.frames + f.caster.anims.frames, 2);
  // The shared hit feedback bursts on the target once.
  assert.deepEqual(f.impacts.map(i => i.sprite === f.enemy), [true]);
  // The confirmation, the impact echo and the health update's feedback are
  // each skipped once.
  assert.equal(f.shots.takePredictedHit('foe', 'confirm'), true);
  assert.equal(f.shots.takePredictedHit('foe', 'confirm'), false);
  assert.equal(f.shots.takePredictedHit('foe', 'impact'), true);
  assert.equal(f.shots.takePredictedHit('foe', 'feedback'), true);
  assert.equal(f.shots.takePredictedHit('foe', 'feedback'), false);
  // A released shot holds only the victim; an unconfirmed prediction expires.
  f.shots.notePredictedHit({ delivery: 'released', character: 'ninja', target, attacker: f.caster });
  f.enemy.anims.update(0, 16); f.caster.anims.update(0, 16);
  assert.equal(f.caster.anims.frames, 2);
  assert.equal(f.enemy.anims.frames, 1);
  clock.t += 5000;
  assert.equal(f.shots.takePredictedHit('foe', 'confirm'), false);
  // Areas are never predicted.
  f.shots.notePredictedHit({ delivery: 'area', character: 'draven', target, attacker: f.caster });
  assert.equal(f.sounds.length, 2);
});

test('the shared hit feedback flashes a white copy over the fighter, bursts, and holds it for the given hitstop', () => {
  const clock = { t: 1000, now() { return this.t; } };
  const f = arena({ clock });
  const copies = [];
  f.enemy.texture = { key: 'wizard-skin' };
  f.enemy.frame = { name: 'idle3' };
  f.enemy.tint = 0x50ce88;
  f.scene.add.sprite = (x, y, key, frame) => {
    const copy = { x, y, key, frame, active: true, setTintFill(color) { this.fill = color; }, setAlpha(a) { this.alpha = a; },
      setPosition(px, py) { this.x = px; this.y = py; }, destroy() { this.active = false; } };
    copies.push(copy); return copy;
  };
  assert.equal(f.feedback.playHitFeedback(f.scene, f.enemy, { hitstopMs: f.feedback.hitstopForDelivery('attached'), duckBlocked: true }), true);
  assert.equal(copies.length, 1);
  assert.deepEqual([copies[0].key, copies[0].frame, copies[0].fill], ['wizard-skin', 'idle3', 0xffffff]);
  assert.equal(f.enemy.tint, 0x50ce88, 'the fighter keeps its own tint');
  assert.deepEqual(f.impacts.map(i => !!i.guard), [false, true]);
  f.enemy.anims.update(0, 16);
  assert.equal(f.enemy.anims.frames, 0);
  // The copy follows the fighter and is removed when it fades.
  f.enemy.x += 40;
  const fade = f.tweens.find(t => t.targets === copies[0]);
  fade.onUpdate(); fade.onComplete();
  assert.deepEqual([copies[0].x, copies[0].active], [f.enemy.x, false]);
  // Hidden fighters get no flash; unknown deliveries give no hitstop.
  f.enemy.visible = false;
  f.feedback.playHitFeedback(f.scene, f.enemy, { hitstopMs: f.feedback.hitstopForDelivery(null) });
  assert.equal(copies.length, 1);
  assert.equal(f.feedback.hitstopForDelivery('released') > 0, true);
});

function melee(f, file, extra = {}) {
  return load(file, common(f, { weapon: { startThorgSweep() {} }, ...extra }), { performance: f.clock });
}

test('a Draven splash strikes the enemy as drawn with the server volume, once, and misses one out of reach', () => {
  const splash = tuning.getResolvedCharacterAttackConfig('draven', 'splash');
  for (const [enemyX, strikes] of [[100 + splash.tipOffset, 1], [100 + splash.tipOffset + splash.width + 200, 0]]) {
    const clock = { t: 0, now() { return this.t; } };
    const f = Object.assign(arena({ enemyX, centerY: 290, character: 'draven', clock }), { clock });
    f.scene.game = { loop: { delta: 16 } };
    const api = melee(f, 'src/client/game/characters/draven/attack.js');
    api.performDravenSplashAttack({ scene: f.scene, player: f.caster }, { direction: 1 });
    for (; clock.t <= splash.activeWindowMs; clock.t += 16) f.scene.events.emit('update');
    assert.equal(f.sounds.length, strikes, `enemy at ${enemyX}`);
  }
});

test('a Thorg sweep strikes the enemy as drawn on the attack clock, after the windup, once', () => {
  const sweep = tuning.getResolvedCharacterAttackConfig('thorg', 'sweep');
  const clock = { t: 0, now() { return this.t; } };
  const f = Object.assign(arena({ enemyX: 100 + sweep.radiusX, centerY: 290, character: 'thorg', clock }), { clock });
  const api = melee(f, 'src/client/game/characters/thorg/attack.js');
  api.performThorgFallAttack({ scene: f.scene, player: f.caster }, { direction: 1 });
  for (; clock.t < sweep.windupMs; clock.t += 16) f.scene.events.emit('update');
  assert.equal(f.sounds.length, 0, 'nothing during the windup');
  for (; clock.t <= sweep.windupMs + sweep.strikeMs + 32; clock.t += 16) f.scene.events.emit('update');
  assert.equal(f.sounds.length, 1);
  assert.equal(f.scene.events.listenerCount('update'), 0, 'prediction stops with the strike');
});
