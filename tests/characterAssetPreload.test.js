const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '..');

// Run real preload methods without initializing sockets or browser renderers.
function loadModule(file) {
  const exports = {};
  const { code } = babel.transformSync(fs.readFileSync(path.join(root, file), 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  });
  vm.runInNewContext(code, {
    exports,
    Phaser: { Loader: { Events: { COMPLETE: 'complete' } } },
    require(name) {
      if (name.includes('characterEntityBase')) return loadModule('src/characters/shared/characterEntityBase.js');
      if (name.includes('characterTuning')) return require('../src/shared/characterTuning.js');
      return {};
    },
  });
  return { __esModule: true, ...exports };
}

const manifest = fs.readFileSync(path.join(root, 'src/characters/manifest.js'), 'utf8');
const characters = [...manifest.matchAll(/from "\.\/([^/]+)\/constructor"/g)].map(match => match[1]);
for (const character of characters) {
  for (const includeBaseAtlas of [true, false]) {
    test(`${character} preload resolves every asset (base atlas: ${includeBaseAtlas})`, () => {
      const queued = [];
      const load = Object.fromEntries(['image', 'audio', 'spritesheet', 'atlas'].map(type =>
        [type, (key, url, atlas) => queued.push({ type, key, urls: type === 'atlas' ? [url, atlas] : [url].flat() })]));
      load.on = () => {};
      const Character = loadModule(`src/characters/${character}/constructor.js`).default;
      Character.preload({ load, sound: { get: () => null } }, '/assets', { includeBaseAtlas });
      assert.ok(queued.length > 0);
      for (const { type, key, urls } of queued) {
        for (const url of urls) {
          const file = path.join(root, 'public', url);
          assert.ok(fs.existsSync(file), `${key}: ${url}`);
          const bytes = fs.readFileSync(file);
          assert.ok(bytes.length > 0, `${key}: empty ${url}`);
          if (url.endsWith('.webp')) {
            assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', url);
            assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', url);
          }
          if (type === 'atlas' && url.endsWith('.json')) assert.ok(JSON.parse(bytes).frames, url);
        }
      }
      if (character === 'gloop') {
        for (const key of ['gloop-slimeball', 'gloop-slimeball-attack', 'gloop-hand']) {
          assert.ok(!queued.some(asset => asset.key === key), `obsolete texture queued: ${key}`);
        }
        for (const key of ['gloop-hand-grip-source', 'gloop-hand-open', 'gloop-hand-closed']) {
          assert.ok(queued.some(asset => asset.key === key), `active hand texture missing: ${key}`);
        }
      }
    });
  }
}
