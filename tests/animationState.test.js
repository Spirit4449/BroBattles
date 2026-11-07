const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

function load(file, dependencies = {}) {
  const exports = {};
  const { code } = babel.transformSync(fs.readFileSync(require.resolve(file), 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  });
  vm.runInNewContext(code, { exports, require: key => dependencies[key] || {} });
  return exports;
}
const animation = load('../src/client/game/characters/shared/animationState');

test('animation locks include the base interval and per-frame additions', () => {
  const duration = anim => animation.getAnimationDurationMs({ anims: { get: () => anim } }, 'cast');
  assert.equal(duration({ frameRate: 10, frames: [{ duration: 58 }, { duration: 80 }] }), 368);
  assert.equal(duration({ frameRate: 1000, msPerFrame: 1, duration: 870,
    frames: Array.from({ length: 12 }, () => ({ duration: 71.5 })) }), 900);
  assert.equal(duration({ frameRate: 20, frames: [{}, {}, {}] }), 180);
  assert.equal(duration(null), 520);
});

test('an interrupted jump resumes, while an uninterrupted completed jump stays on its last frame', () => {
  const calls = [];
  const sprite = { body: { touching: { down: false } }, anims: {
    play(key, ignoreIfPlaying) { calls.push({ key, ignoreIfPlaying }); this.currentAnim = { key }; },
  } };
  const play = logical => animation.playCharacterAnimation({ scene: {}, sprite, character: 'ninja',
    logical, resolveAnimKey: (_scene, char, wanted) => `${char}-${wanted}` });
  play('jumping');
  sprite.anims.isPlaying = false;
  play('jumping');
  assert.equal(calls.length, 1);
  play('throw');
  play('jumping');
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).key, 'ninja-jumping');
});

test('remote death wins over residual velocity and dash snapshots reset landed jumps', () => {
  assert.equal(animation.chooseRemoteAnimationState({ animation: 'dying',
    currentPosition: { grounded: false, vy: -300, wallSliding: false } }), 'dying');
  const sprite = { _bbAnimationState: { jumpPlayedAirborne: true, restartJump: true } };
  assert.equal(animation.chooseRemoteAnimationState({ animation: 'dashing', sprite,
    currentPosition: { grounded: true } }), 'dashing');
  assert.equal(sprite._bbAnimationState.jumpPlayedAirborne, false);
  assert.equal(sprite._bbAnimationState.restartJump, false);
});

test('remote rider carried by a moving platform stays idle', () => {
  const choose = (dx, dy) => animation.chooseRemoteAnimationState({ animation: 'idle',
    previousPosition: { x: 100, y: 200 },
    currentPosition: { x: 100 + dx, y: 200 + dy, vx: 0, vy: 0, grounded: true, wallSliding: false } });
  assert.equal(choose(0, 6), 'idle');
  assert.equal(choose(0, -6), 'idle');
  assert.equal(choose(6, 0), 'idle');
});

const registry = load('../src/client/game/characters/index', {
  './manifest': { __esModule: true, default: [{ key: 'ninja', setupAnimations() {} }] },
  '../../views/skinAssets.js': {
    normalizeSkinId: value => value === 'default' ? '' : value || '',
    buildCharacterSkinTextureKey: (char, skin) => `${char}__${skin}`,
  },
  '../../../shared/characters/index.js': { characterFrames: {}, characterPresentation: () => ({}) },
  '../../../shared/physics/ducking.js': { DUCK_FRAME_CELLS: {} },
  '../../../shared/physics/movementPhysics.json': require('../src/shared/physics/movementPhysics.json'),
});

test('qualified animation requests resolve on the selected skin before its idle fallback', () => {
  const keys = new Set(['ninja-running', 'ninja__king-running', 'ninja__king-idle']);
  const scene = { anims: { exists: key => keys.has(key) } };
  for (const key of ['running', 'ninja-running', 'ninja__king-running']) {
    assert.equal(registry.resolveAnimKey(scene, 'ninja', key, 'idle', 'king'), 'ninja__king-running');
  }
  assert.equal(registry.resolveAnimKey(scene, 'ninja', 'missing', 'ninja-idle', 'king'), 'ninja__king-idle');
});

test('dash resolution never scans an atlas; setup registers naturally ordered dash poses once', () => {
  let scans = 0;
  const animations = new Map([['ninja-idle', {}]]);
  const scene = {
    textures: { exists: () => true, get: () => ({ getFrameNames() { scans++; return ['dash10', 'dash2', 'dash1']; } }) },
    anims: { exists: key => animations.has(key), create: config => animations.set(config.key, config) },
  };
  for (let i = 0; i < 100; i++) assert.equal(registry.resolveAnimKey(scene, 'ninja', 'dashing'), 'ninja-idle');
  assert.equal(scans, 0);
  registry.setupFor(scene, 'ninja');
  registry.setupFor(scene, 'ninja');
  assert.equal(scans, 1);
  assert.deepEqual(Array.from(animations.get('ninja-dashing').frames, frame => frame.frame), ['dash1', 'dash2', 'dash10']);
  assert.equal(registry.resolveAnimKey(scene, 'ninja', 'dashing'), 'ninja-dashing');
});

test('authored movement clips follow speed and vertical velocity for local and remote sprites',()=>{
  const frames=Array.from({length:5},(_,i)=>({id:i}));
  const clips={run:{key:'run',frames,bbMotion:{kind:'running',speed:260}},
    jump:{key:'jump',frames,bbMotion:{kind:'jumping',speed:490}},
    fall:{key:'fall',frames,bbMotion:{kind:'falling',speed:490}},idle:{key:'idle',frames}};
  for(const remote of [false,true]){
    const sprite={body:{velocity:{x:130,y:-490}},_bbAnimationVelocity:remote?{x:130,y:-490}:undefined,anims:{
      play(key){this.currentAnim=clips[key];this.isPlaying=true;},
      pause(){this.isPlaying=false;},setCurrentFrame(f){this.currentFrame=f;},timeScale:1}};
    const velocity=remote?sprite._bbAnimationVelocity:sprite.body.velocity;
    const play=(logical,key)=>animation.playCharacterAnimation({scene:{anims:{get:k=>clips[k]}},sprite,
      character:'gloop',logical,resolveAnimKey:()=>key});
    play('running','run');const slow=sprite.anims.timeScale;
    velocity.x=260;
    play('running','run');assert.ok(sprite.anims.timeScale>slow);
    play('jumping','jump');assert.equal(sprite.anims.currentFrame,frames[0]);
    assert.equal(sprite.anims.timeScale,1,'running speed must not leak into the jump');
    velocity.y=-1;
    play('jumping','jump');assert.equal(sprite.anims.currentFrame,frames.at(-1));
    velocity.y=0;
    play('falling','fall');assert.equal(sprite.anims.currentFrame,frames[0]);
    velocity.y=490;
    play('falling','fall');assert.equal(sprite.anims.currentFrame,frames.at(-1));
    play('idle','idle');assert.equal(sprite.anims.isPlaying,true,'normal playback resumes after manual airborne poses');
  }
});

test('a remote follow-up packet that plays nothing keeps the windup lock instead of restarting it', () => {
  // Wizard: the windup plays the throw, the release 520 ms later plays nothing.
  const throwAnim = { frameRate: 18, frames: Array.from({ length: 8 }, () => ({ duration: 58 })) };
  const scene = { anims: { get: key => (key === 'wizard-throw' ? throwAnim : null) } };
  const sprite = { anims: { play(key) { this.currentAnim = { key }; } } };
  const wrapper = { opponent: sprite };
  const playThrow = () => { sprite.anims.play('wizard-throw'); animation.noteAnimationPlayed(sprite, 'throw'); return true; };
  const present = (actionType, handler) =>
    animation.presentRemoteAction({ scene, wrapper, character: 'wizard', actionType }, handler);

  const lockOf = target => animation.remoteAnimationLockUntil(target);
  assert.equal(present('wizard-fireball', playThrow), true);
  const lock = lockOf(sprite);
  assert.ok(lock > 0);

  assert.equal(present('wizard-fireball-release', () => true), true);
  assert.equal(lockOf(sprite), lock, 'the release does not extend the lock');

  // A handler that replays the animation (the next attack) gets a fresh lock.
  const start = Date.now(); while (Date.now() - start < 5) {}
  present('wizard-fireball', playThrow);
  assert.ok(lockOf(sprite) > lock);

  // Unconsumed actions never lock.
  const idle = { opponent: { anims: {} } };
  animation.presentRemoteAction({ scene, wrapper: idle, character: 'wizard', actionType: 'x' }, () => false);
  assert.equal(lockOf(idle.opponent), 0);
});

// The action layer on a controllable clock, with a fake Phaser animation set.
function actionRig() {
  let now = 1000;
  const exports = {};
  const { code } = babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/characters/shared/animationState'), 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  });
  vm.runInNewContext(code, { exports, require: () => ({}), performance: { now: () => now }, Date: { now: () => now } });
  const clips = {
    'wizard-special': { frameRate: 50, frames: Array.from({ length: 16 }, () => ({ duration: 90 })) },
    'wizard-throw': { frameRate: 18, frames: Array.from({ length: 8 }, () => ({ duration: 58 })) },
  };
  for (const key of ['idle', 'running', 'jumping', 'dying', 'dashing']) clips[`wizard-${key}`] = { frameRate: 10, frames: [{}] };
  const scene = { anims: { exists: key => !!clips[key], get: key => clips[key] } };
  const plays = [];
  const sprite = { _bbCharacter: 'wizard', anims: { play(key, ignoreIfPlaying) {
    plays.push({ key, ignoreIfPlaying });
    if (!(ignoreIfPlaying && this.currentAnim?.key === key)) this.currentAnim = { key };
  } } };
  const api = exports;
  const action = (logical, options = {}) => api.playSpriteAnimation({ scene, sprite, character: 'wizard', logical, fallback: 'idle', ...options });
  const move = logical => api.playCharacterAnimation({ scene, sprite, character: 'wizard', logical,
    resolveAnimKey: (_scene, char, wanted) => `${char}-${wanted}` });
  return { api, sprite, plays, action, move, duration: key => api.getAnimationDurationMs(scene, key), advance: ms => { now += ms; } };
}

test('a special shows for its whole animation and movement cannot cut it short', () => {
  const rig = actionRig();
  rig.action('special');
  const length = rig.duration('wizard-special');
  rig.advance(length - 50);
  for (const logical of ['running', 'jumping', 'idle']) rig.move(logical);
  assert.equal(rig.sprite.anims.currentAnim.key, 'wizard-special');
  assert.equal(rig.api.getPresentedAnimation(rig.sprite), 'special');
  rig.advance(60);
  rig.move('running');
  assert.equal(rig.sprite.anims.currentAnim.key, 'wizard-running');
});

test('asking for the showing special again continues it; only a hold extends it', () => {
  const rig = actionRig();
  rig.action('special');                 // local press
  const until = rig.api.activeAction(rig.sprite).until;
  rig.advance(150);
  rig.action('special');                 // server echo
  assert.equal(rig.plays.length, 1, 'the echo does not restart the pose');
  assert.equal(rig.api.activeAction(rig.sprite).until, until);
  assert.equal(Math.round(rig.api.actionElapsedMs(rig.sprite, 'special')), 150);
  rig.action('special', { holdMs: 3000 });
  assert.equal(rig.plays.length, 1);
  assert.ok(rig.api.activeAction(rig.sprite).until > until);
  rig.action('special', { restart: true });
  assert.equal(rig.plays.length, 2);
  assert.equal(rig.api.actionElapsedMs(rig.sprite), 0);
});

test('a new attack id restarts the throw, the same id does not', () => {
  const rig = actionRig();
  rig.action('throw', { id: 'a' });
  rig.action('throw', { id: 'a' });
  assert.equal(rig.plays.length, 1);
  rig.advance(100);
  rig.action('throw', { id: 'b' });
  assert.equal(rig.plays.length, 2);
  assert.equal(rig.plays[1].ignoreIfPlaying, false);
  assert.equal(rig.api.activeAction(rig.sprite).id, 'b');
});

test('dashing and dying end an action; other character animations replace it', () => {
  for (const interrupt of ['dashing', 'dying']) {
    const rig = actionRig();
    rig.action('special');
    rig.move(interrupt);
    assert.equal(rig.sprite.anims.currentAnim.key, `wizard-${interrupt}`);
    assert.equal(rig.api.activeAction(rig.sprite), null);
  }
  const rig = actionRig();
  rig.action('throw');
  rig.action('dying');
  assert.equal(rig.api.activeAction(rig.sprite), null);
  assert.equal(rig.sprite.anims.currentAnim.key, 'wizard-dying');
});
