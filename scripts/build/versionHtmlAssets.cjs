const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// Older releases stay available so tabs opened before a deploy keep working.
// Beyond that window they only grow dist/ (hundreds of MB after a few weeks),
// so a file is removed once it is both outside the newest few versions of its
// bundle and over a day old. In-app navigation refetches templates, so only tabs
// caught mid-deploy ever request an older hash.
const KEEP_VERSIONS = 5;
const KEEP_MS = 24 * 60 * 60 * 1000;
const HASHED = /^(.+)\.[a-f0-9]{16}\.(js|css)$/;
const COMPRESSED = ['.br', '.gz'];

// Hashed files never change, so each compressed copy is written only once.
// src/server/middleware/precompressed.js serves them instead of compressing
// every response on the Pi.
function writeCompressedCopies(dir, names) {
  for (const name of names) {
    const file = path.join(dir, name);
    let source;
    for (const suffix of COMPRESSED) {
      if (fs.existsSync(file + suffix)) continue;
      try { source ||= fs.readFileSync(file); } catch (_) { return; }
      const output = suffix === '.br'
        ? zlib.brotliCompressSync(source, { params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 10,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length,
        } })
        : zlib.gzipSync(source, { level: 9 });
      // Write then rename so the server never serves a partial file.
      fs.writeFileSync(file + suffix + '.tmp', output);
      fs.renameSync(file + suffix + '.tmp', file + suffix);
    }
  }
}

function pruneOldVersions(dir, current, now = Date.now()) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch (_) { return []; }
  const groups = new Map();
  for (const name of entries) {
    const match = HASHED.exec(name);
    if (!match) continue;
    const key = `${match[1]}.${match[2]}`;
    const file = path.join(dir, name);
    let mtimeMs;
    try { mtimeMs = fs.statSync(file).mtimeMs; } catch (_) { continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ name, file, mtimeMs });
  }
  const removed = [];
  for (const versions of groups.values()) {
    versions.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const [index, version] of versions.entries()) {
      if (index < KEEP_VERSIONS || current.has(version.name) || now - version.mtimeMs < KEEP_MS) continue;
      for (const suffix of ['', ...COMPRESSED]) {
        try { fs.unlinkSync(version.file + suffix); } catch (_) { /* Already gone. */ }
      }
      removed.push(version.name);
    }
  }
  return removed;
}

// Keep old URLs for compatibility; new page loads receive content-addressed
// bundles so every CDN region and browser requests the deployed release.
class VersionHtmlAssetsPlugin {
  apply(compiler) {
    const { Compilation, sources } = compiler.webpack;
    const current = new Set();
    compiler.hooks.thisCompilation.tap('VersionHtmlAssets', compilation => {
      current.clear();
      compilation.hooks.processAssets.tap({name:'VersionHtmlAssets',stage:Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE}, () => {
        for (const html of compilation.getAssets().filter(a => a.name.endsWith('.html'))) {
          const content = html.source.source().toString().replace(/(["'])(\/bundles\/[^"'?\s]+\.(?:js|css))\1/g, (match, quote, url) => {
            const asset = compilation.getAsset(url.slice(1));
            if (!asset) return match;
            const hash = createHash('sha256').update(asset.source.buffer()).digest('hex').slice(0,16);
            const name = asset.name.replace(/\.(js|css)$/, `.${hash}.$1`);
            if (!compilation.getAsset(name)) compilation.emitAsset(name, asset.source, { ...asset.info, immutable: true });
            current.add(path.basename(name));
            return `${quote}/${name}${quote}`;
          });
          compilation.updateAsset(html.name, new sources.RawSource(content));
        }
      });
    });
    compiler.hooks.afterEmit.tap('VersionHtmlAssets', compilation => {
      if (compilation.errors.length) return;
      const dir = path.join(compiler.outputPath, 'bundles');
      writeCompressedCopies(dir, current);
      pruneOldVersions(dir, current);
    });
  }
}
module.exports = VersionHtmlAssetsPlugin;
module.exports.pruneOldVersions = pruneOldVersions;
module.exports.writeCompressedCopies = writeCompressedCopies;
