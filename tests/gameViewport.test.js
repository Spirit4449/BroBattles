const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

const exported = {};
vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/client/game/scene/gameViewport.js'), 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code, { exports: exported, Math });
const { fitGameSize, GAME_VIEW } = exported;

const fills = (size, w, h) => Math.abs(size.width / size.height - w / h) < 0.01;

test('common windows fill the screen without bezels', () => {
  for (const [w, h] of [[1920, 1080], [1440, 900], [1024, 768], [1280, 1024], [2340, 1080], [2560, 1080]]) {
    assert.ok(fills(fitGameSize(w, h), w, h), `${w}x${h}`);
  }
});

test('filling trims the view instead of showing more than the arena', () => {
  for (const [w, h] of [[1024, 768], [2560, 1080], [800, 1000], [3840, 1080]]) {
    const size = fitGameSize(w, h);
    assert.ok(size.width <= GAME_VIEW.width && size.width >= GAME_VIEW.minWidth, `${w}x${h} width`);
    assert.ok(size.height <= GAME_VIEW.maxHeight && size.height >= GAME_VIEW.minHeight, `${w}x${h} height`);
  }
  // A 4:3 window trims the sides rather than letterboxing.
  assert.ok(fitGameSize(1024, 768).width < GAME_VIEW.width);
});

test('extreme windows stop trimming and leave room for bezels', () => {
  const portrait = fitGameSize(390, 844);
  assert.equal(portrait.width, GAME_VIEW.minWidth);
  assert.ok(portrait.width / portrait.height > 390 / 844);
  const superWide = fitGameSize(5120, 1440);
  assert.equal(superWide.height, GAME_VIEW.minHeight);
  assert.ok(superWide.width / superWide.height < 5120 / 1440);
});
