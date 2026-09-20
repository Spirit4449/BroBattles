const test = require('node:test');
const assert = require('node:assert/strict');
const { setStaticCacheHeaders } = require('../src/server/helpers/staticCache');

test('only content-addressed JS and CSS get immutable caching', () => {
  for (const [file, expected] of [
    ['/dist/bundles/game.bundle.0123456789abcdef.js', 'public, max-age=31536000, immutable'],
    ['/dist/bundles/index.0123456789abcdef.css', 'public, max-age=31536000, immutable'],
    ['/dist/bundles/game.bundle.js', 'public, max-age=0'],
    ['/dist/bundles/mode-bank-bust.js', 'public, max-age=0'],
    ['/dist/game.html', 'public, max-age=0'],
    ['/dist/battle-preload.json', 'public, max-age=0'],
    ['/dist/assets/ninja/spritesheet.webp', 'public, max-age=0'],
  ]) {
    let header;
    setStaticCacheHeaders({ setHeader: (name, value) => { assert.equal(name, 'Cache-Control'); header = value; } }, file);
    assert.equal(header, expected, file);
  }
});
