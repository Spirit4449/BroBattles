const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

test('all original frames render into identical visible bounds and normalization is cached', () => {
  const code = babel.transformSync(fs.readFileSync('src/characters/wizard/fireballFrames.js', 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  let selected = 0;
  const calls = [], names = ['fire00', 'fire01', 'fire02'];
  const sizes = [[80, 100], [140, 280], [100, 160]];
  const context = {
    clearRect() {},
    drawImage(_source, x) { selected = x / 240; },
    getImageData() {
      const data = new Uint8ClampedArray(240 * 370 * 4);
      const [width, height] = sizes[selected];
      for (let y = 30; y < 30 + height; y++) {
        for (let x = 20; x < 20 + width; x++) data[(y * 240 + x) * 4 + 3] = 255;
      }
      return { data };
    },
  };
  let cached = false;
  const scene = { textures: {
    exists: key => key === 'wizard-fireball' || cached,
    get: () => ({ getFrameNames: () => names, get: name => ({
      source: { image: {} }, cutX: names.indexOf(name) * 240, cutY: 0, cutWidth: 240, cutHeight: 370,
    }) }),
    createCanvas: () => ({
      getContext: () => ({ drawImage: (...args) => calls.push(args) }),
      add() {}, refresh() { cached = true; },
    }),
  } };
  const exports = {};
  vm.runInNewContext(code, { exports, document: { createElement: () => ({ getContext: () => context }) } });
  assert.equal(exports.getSteadyFireballTexture(scene), 'wizard-fireball-steady');
  assert.equal(calls.length, 3, 'retain every animation frame');
  calls.forEach((call, index) => {
    assert.deepEqual(call.slice(5), [index * 240 + 70, 105, 100, 160]);
    assert.deepEqual(call.slice(3, 5), sizes[index], 'sample each original silhouette at its own bounds');
  });
  exports.getSteadyFireballTexture(scene);
  assert.equal(calls.length, 3, 'do not rebuild textures per shot');
});
