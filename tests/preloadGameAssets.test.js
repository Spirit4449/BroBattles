const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

function loadPreloader() {
  const exports = {};
  const { code } = babel.transformSync(fs.readFileSync(require.resolve('../src/gameScene/preloadGameAssets.js'), 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  });
  const legacy = {};
  const legacyCode = babel.transformSync(fs.readFileSync(require.resolve('../src/maps/legacy/preloadAssets.js'), 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  vm.runInNewContext(legacyCode, { exports: legacy });
  vm.runInNewContext(code, { exports, require: name => {
    if (name.includes('legacy')) return legacy;
    if (name.includes('shared/powerups')) return require('../src/shared/powerups');
    return { preloadTerrainAudio() {} };
  } });
  return exports.preloadGameAssets;
}

function makeLoaderQueue() {
  const queued = [];
  const load = Object.fromEntries(['image', 'audio', 'atlas', 'tilemapTiledJSON', 'spritesheet'].map(type =>
    [type, key => queued.push(key)]));
  return { load, queued };
}

test('game asset preload completes with the Phaser 3.70 loader API (no font method)', () => {
  const preloadGameAssets = loadPreloader();
  const { load, queued } = makeLoaderQueue();
  let charactersLoaded = false;
  assert.doesNotThrow(() => preloadGameAssets({ scene: { load }, staticPath: '/assets',
    powerupTypes: ['health', 'shockwave', 'freeze'], powerupAssetDir: { health: 'health', shockwave: 'shockwave', freeze: 'freeze' },
    preloadAllCharacters() { charactersLoaded = true; } }));
  assert.ok(charactersLoaded);
  assert.ok(queued.includes('tiles'));
  assert.ok(queued.includes('sfx-nosuper'), 'preloads the super-not-ready cue');
  assert.ok(queued.includes('pu-tick-health'), 'powerups with periodic effects preload their tick sound');
  assert.ok(queued.includes('pu-tick-freeze'), 'freeze preloads its ambient tick sound');
  assert.ok(!queued.includes('pu-tick-shockwave'), 'instant shockwave does not preload a nonexistent tick sound');
});

test('legacy fallback queues assets only for the selected map', () => {
  const preloadGameAssets = loadPreloader();
  const { load, queued } = makeLoaderQueue();

  preloadGameAssets({
    scene: { load },
    staticPath: '/assets',
    mapId: 2,
    powerupTypes: [],
    powerupAssetDir: {},
    preloadAllCharacters() {},
  });

  assert.ok(queued.includes('mangrove-base-middle'));
  assert.ok(!queued.includes('lushy-base'));
  assert.ok(!queued.includes('serenity-large-platform'));
  assert.ok(!queued.includes('tiles'));
});
