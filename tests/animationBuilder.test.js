const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnimationBuilder } = require('../src/characters/shared/animationBuilder');

function setup(names) {
  const animations = new Map();
  const scene = {
    textures: { get: () => ({ getFrameNames: () => names }) },
    anims: {
      exists: key => animations.has(key),
      create: config => animations.set(config.key, config),
    },
  };
  return { builder: createAnimationBuilder(scene, 'character'), animations };
}

test('atlas prefixes accept strings or alternatives and sort numbered frames naturally', () => {
  const { builder, animations } = setup(['idle10', 'idle2', 'Idle01', 'run02', 'walk01']);
  builder.make('idle', 'idle', 8, -1);
  builder.make('running', ['run', 'walk'], 16, -1);
  assert.deepEqual(animations.get('idle').frames.map(frame => frame.frame), ['Idle01', 'idle2', 'idle10']);
  assert.deepEqual(animations.get('running').frames.map(frame => frame.frame), ['walk01', 'run02']);
  assert.equal(animations.get('idle').frameRate, 8);
  assert.equal(animations.get('idle').repeat, -1);
});

test('explicit artistic ordering is case insensitive and falls back for an incomplete atlas', () => {
  const { builder, animations } = setup(['run00', 'run01', 'run02']);
  builder.make('ordered', 'run', 8, -1, ['RUN02', 'run00', 'run01']);
  builder.make('fallback', 'run', 8, -1, ['run00', 'missing']);
  assert.deepEqual(animations.get('ordered').frames.map(frame => frame.frame), ['run02', 'run00', 'run01']);
  assert.deepEqual(animations.get('fallback').frames.map(frame => frame.frame), ['run00', 'run01', 'run02']);
});

test('repeated setup preserves existing animation definitions and skips missing frames', () => {
  const { builder, animations } = setup(['idle00']);
  builder.make('idle', 'idle', 8, -1);
  builder.make('idle', 'idle', 12, 0);
  builder.make('missing', ['absent'], 8, -1);
  assert.equal(animations.size, 1);
  assert.equal(animations.get('idle').frameRate, 8);
});
