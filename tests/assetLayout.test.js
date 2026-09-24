const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'public/assets');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

test('browser raster assets use WebP, with explicit email and UI PNG exceptions', () => {
  const otherRasters = walk(assets).filter(file => /\.(png|jpe?g|gif|bmp|avif)$/i.test(file));
  assert.deepEqual(otherRasters.map(file => path.relative(assets, file)), ['logos/wordmark.png', 'ui/party-search-players.png']);
});

test('all dynamically selected level badges exist in the final flat directory', () => {
  for (let level = 1; level <= 10; level++) {
    const bytes = fs.readFileSync(path.join(assets, 'levels', `${level}.webp`));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  }
  assert.equal(fs.existsSync(path.join(assets, 'levels/reforged')), false);
  assert.match(fs.readFileSync(path.join(root, 'src/lib/levelBadgeView.js'), 'utf8'), /\/assets\/levels\/\$\{normalizedLevel\}\.webp/);
});

test('literal runtime asset URLs resolve to published files', () => {
  for (const folder of ['src', 'public']) {
    for (const file of walk(path.join(root, folder))) {
      if (file.startsWith(assets + path.sep) || !/\.(js|mjs|cjs|json|css|html)$/.test(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const [url] of source.matchAll(/\/assets\/[\w./-]+\.(?:webp|png|svg|mp3|wav|ogg|json|ttf|woff2)/g)) {
        // This is the map editor's example URL for a new, user-supplied asset.
        if (url === '/assets/maps/platform.png') continue;
        assert.ok(fs.existsSync(path.join(root, 'public', url)), `${path.relative(root, file)}: ${url}`);
      }
    }
  }
});

test('published atlases have unique frame names in each texture', () => {
  for (const file of walk(assets).filter(file => file.endsWith('.json'))) {
    const atlas = JSON.parse(fs.readFileSync(file, 'utf8'));
    const textures = Array.isArray(atlas.textures) ? atlas.textures : [atlas];
    const names = new Set(['__BASE']);
    for (const texture of textures) {
      const frames = Array.isArray(texture.frames)
        ? texture.frames.map(frame => frame.filename)
        : Object.keys(texture.frames || {});
      for (const name of frames) {
        assert.ok(!names.has(String(name)), `${path.relative(assets, file)}: duplicate frame ${name}`);
        names.add(String(name));
      }
    }
  }
});
