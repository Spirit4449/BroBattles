const { loadClientModule } = require('./helpers/clientModule');
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
function load(file, imports = () => ({})) {
  const exports = {};
  loadClientModule(file, { exports, require: imports, Phaser: { Math: { RadToDeg: r => r * 180 / Math.PI } } });
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
  if (name.includes('characterTuning')) return require('../src/shared/characters/characterTuning');
  if (name.includes('runtimeId')) return { createRuntimeId: () => 'test' };
  if (name.includes('ozzyCharge')) return require('../src/shared/characters/ozzyCharge');
  if (name.includes('shotPrediction')) return { shotBlockerContact: () => null };
  if (name === './aimPoses') return require('../src/client/game/characters/ozzy/aimPoses');
  if (name.includes('animationState')) return { playSpriteAnimation() {}, actionElapsedMs: () => 0 };
  return {};
};
const { castDelayMs, activeScale } = require('../src/shared/characters/characterTuning').getResolvedCharacterAttackConfig('ozzy', 'fireball');
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

test('charge keeps its release size and finishes growing in flight', () => {
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
  // The tip as drawn on attack03 (ozzy.json rig), with the sprite's default centre origin.
  const { rigOf, rigPointArt } = require('../src/shared/characters/characterRig');
  const { w, h } = rigOf('ozzy').frame;
  const [tipX, tipY] = rigPointArt('ozzy', 'staffTip', 'attack03');
  assert.equal(attack.getOzzyStaffTip(owner).x, 100 + tipX - w / 2);
  assert.equal(attack.getOzzyStaffTip(owner).y, 100 + tipY - h / 2);
  owner.flipX = true;
  assert.equal(attack.getOzzyStaffTip(owner).x, 100 + w / 2 - tipX);
  owner.flipX = false;
  const sprite = attack.chargeOzzyFireball(scene, owner, { id: 'cast', angle: Math.PI / 4 });
  assert.equal(sprite.frameName, 'fire00');
  scene.events.emit('postupdate', 0, castDelayMs / 2);
  assert.equal(sprite.frameName, 'fire08');
  const chargeScale = sprite.scale;
  assert.equal(chargeScale, activeScale);
  owner.x = 150;
  scene.events.emit('postupdate', 0, 450);
  assert.equal(sprite.frameName, 'fire15');
  scene.events.emit('postupdate', 0, 100);
  assert.equal(sprite.frameName, 'fire15', 'spawn holds and never loops');
  const x = sprite.x;
  const y = sprite.y;
  const flight = attack.spawnOzzyFireballVisual(scene, { id: 'cast', angle: Math.PI / 4, start: { x: x + 10, y } }, owner);
  assert.equal(flight, sprite);
  assert.equal(flight.frameName, 'fire16');
  assert.equal(flight.x, x);
  assert.equal(flight.scale, chargeScale);
  const travel = tweens[tweens.length - 1];
  travel.targets[0].t = 0;
  travel.onUpdate(travel);
  assert.equal(flight.x, x, 'first flight frame stays on the charged core');
  for (const t of [0.04, 0.15, 0.4]) {
    travel.targets[0].t = t;
    travel.onUpdate(travel);
    assert.ok(flight.x > x);
    assert.equal(flight.scale, chargeScale, 'growth is drawn at a fixed pixel size');
    if (t === 0.04) assert.ok(Number(flight.frameName.slice(4)) > 16);
    assert.ok(Math.abs((flight.x - x) - (flight.y - y)) < 1e-8, 'flight stays on the diagonal from the charged core');
  }
  assert.equal(flight.anims.key, 'ozzy-fireball-unified:flight');
  assert.equal(scene._ozzyCharges.size, 0);
  assert.equal(owner.listenerCount('destroy'), 0);
  scene.events.emit('presentation:reset');
  assert.equal(sprite.active, false);
  const enemy = object(300, 100);
  enemy._bbTeamColor = 0xff413f;
  const remote = attack.spawnOzzyFireballVisual(scene, { id: 'remote', angle: Math.PI }, enemy);
  assert.ok(remote.active, 'opponent fireballs spawn without a local charge');
  assert.equal(remote._bbTeamColor, 0xff413f);
  assert.equal(remote.frameName, 'fire16');
  const remoteTravel = tweens.at(-1);
  remoteTravel.targets[0].t = 0.5;
  remoteTravel.onUpdate(remoteTravel);
  assert.equal(remote.anims.key, 'ozzy-fireball-red:flight');
  scene.events.emit('presentation:reset');
  assert.equal(remote.active, false);
});

test('charge follows the drawn staff from the first frame and holds its launch point through recovery', () => {
  const attack = load('src/client/game/characters/ozzy/attack.js', attackImports);
  function object(x = 0, y = 0) {
    const o = Object.assign(new EventEmitter(), { active: true, visible: true, x, y, anims: { play() {}, stop() {} }, destroy() { this.active = false; this.emit('destroy'); } });
    for (const m of ['setScale', 'setOrigin', 'setAngle', 'setDepth', 'setStrokeStyle', 'setBlendMode'])
      o[m] = () => o;
    o.setVisible = value => { o.visible = value; return o; };
    o.setFrame = value => { o.frameName = value; return o; };
    return o;
  }
  const scene = { events: new EventEmitter(), textures: { exists: () => true }, anims: { exists: () => true },
    add: { sprite: object, circle: object }, tweens: { add: () => ({ stop() {} }), killTweensOf() {} } };
  const owner = object(100, 100);
  owner.frame = { name: 'aimhigh00' };
  owner.flipX = true;
  owner.scaleX = owner.scaleY = 2;
  const sprite = attack.chargeOzzyFireball(scene, owner, { id: 'windup', angle: 0 });
  assert.equal(sprite.visible, true);
  assert.equal(sprite.frameName, 'fire00');
  let tip = attack.getOzzyStaffTip(owner);
  assert.deepEqual([sprite.x, sprite.y], [tip.x, tip.y]);
  for (const frame of ['aimhigh01', 'aimhigh02', 'aimhigh03', 'aimhigh04', 'aimhigh05']) {
    owner.frame.name = frame;
    owner.x += 3;
    scene.events.emit('postupdate', 0, castDelayMs / 6);
    tip = attack.getOzzyStaffTip(owner);
    assert.deepEqual([sprite.x, sprite.y], [tip.x, tip.y]);
  }
  assert.notEqual(sprite.frameName, 'fire00');
  owner.frame.name = 'aimhigh07';
  scene.events.emit('postupdate', 0, castDelayMs);
  assert.deepEqual([sprite.x, sprite.y], [tip.x, tip.y], 'follow-through cannot drag a pending release');
  scene.events.emit('presentation:reset');
});

test('Pocket Ace releases an eight ball from the striking cue in either facing for every aim pose', () => {
  const attack = load('src/client/game/characters/ozzy/attack.js', name =>
    name === './pocketAceShot' ? require('../src/client/game/characters/ozzy/pocketAceShot') : attackImports(name));
  const { cueTip, STRIKE_FRAME } = require('../src/client/game/characters/ozzy/pocketAceShot');
  const { spriteArtPoint } = require('../src/client/game/characters/shared/rig.js');
  const { DIRECTIONS } = require('../src/client/game/characters/ozzy/aimPoses');
  function object(x, y, texture) {
    const sprite = Object.assign(new EventEmitter(), { x, y, texture, active: true, anims: { play() {} } });
    for (const method of ['setOrigin', 'setFrame', 'setDepth', 'setScale', 'setAngle', 'setStrokeStyle', 'setVisible']) sprite[method] = () => sprite;
    return sprite;
  }
  for (const { frame, elevation } of DIRECTIONS) for (const flipX of [false, true]) {
    let flight;
    const scene = { add: { sprite: object, circle: object }, textures: { exists: () => true },
      anims: { exists: () => true }, events: new EventEmitter(),
      tweens: { add(config) { if (config.t === 1) flight = config; return { stop() {} }; } } };
    const owner = { x: 300, y: 200, scaleX: 0.92, scaleY: 0.92, flipX,
      texture: { key: 'ozzy__ozzy-pocket-ace' }, frame: { name: frame + '07', realWidth: 231, realHeight: 190 } };
    const angle = -elevation * Math.PI / 180;
    const ball = attack.spawnOzzyFireballVisual(scene, { id: 'shot', angle: flipX ? Math.PI - angle : angle,
      direction: flipX ? -1 : 1, start: { x: 280, y: 210 } }, owner);
    const tip = spriteArtPoint(owner, cueTip(frame + STRIKE_FRAME), 'ozzy');
    assert.equal(ball.texture, 'ozzy-pocket-ace-eight-ball');
    assert.deepEqual([ball.x, ball.y], [tip.x, tip.y]);
    const heading = flipX ? Math.PI - angle : angle;
    for (const progress of [0.01, 0.05, 0.12, 0.5]) {
      flight.onUpdate({ targets: [{ t: progress }] });
      const dx = ball.x - tip.x, dy = ball.y - tip.y;
      assert.ok(Math.abs(dx * Math.sin(heading) - dy * Math.cos(heading)) < 1e-7);
      assert.ok(dx * Math.cos(heading) + dy * Math.sin(heading) > 0);
    }
  }
});
