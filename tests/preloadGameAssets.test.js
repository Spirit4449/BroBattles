const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

test('game asset preload completes with the Phaser 3.70 loader API (no font method)', () => {
  const exports = {};
  const { code } = babel.transformSync(fs.readFileSync(require.resolve('../src/gameScene/preloadGameAssets.js'), 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  });
  vm.runInNewContext(code, { exports, require: () => ({ preloadTerrainAudio() {} }) });
  const queued = [];
  const load = Object.fromEntries(['image', 'audio', 'atlas', 'tilemapTiledJSON'].map(type =>
    [type, key => queued.push(key)]));
  let charactersLoaded = false;
  assert.doesNotThrow(() => exports.preloadGameAssets({ scene: { load }, staticPath: '/assets',
    powerupTypes: ['test'], powerupAssetDir: {}, preloadAllCharacters() { charactersLoaded = true; } }));
  assert.ok(charactersLoaded);
  assert.ok(queued.includes('tiles'));
  assert.ok(queued.includes('pu-tick-test'), 'preload reaches the end of the asset queue');
});
