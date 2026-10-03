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
const animation = load('../src/characters/shared/animationState');

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

const registry = load('../src/characters/index', {
  './manifest': { __esModule: true, default: [{ key: 'ninja', setupAnimations() {} }] },
  '../lib/skinAssets.js': {
    normalizeSkinId: value => value === 'default' ? '' : value || '',
    buildCharacterSkinTextureKey: (char, skin) => `${char}__${skin}`,
  },
  '../shared/characters/index.js': { characterFrames: {}, characterPresentation: () => ({}) },
  '../shared/ducking.js': { DUCK_FRAME_CELLS: {} },
  '../shared/movementPhysics.json': require('../src/shared/movementPhysics.json'),
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
