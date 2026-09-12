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
  vm.runInNewContext(code, { exports, require: name => name.includes('legacy') ? legacy : { preloadTerrainAudio() {} } });
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
    powerupTypes: ['test'], powerupAssetDir: {}, preloadAllCharacters() { charactersLoaded = true; } }));
  assert.ok(charactersLoaded);
  assert.ok(queued.includes('tiles'));
  assert.ok(queued.includes('pu-tick-test'), 'preload reaches the end of the asset queue');
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
