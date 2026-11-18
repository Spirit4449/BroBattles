const { parseVersionedBundle } = require('../../src/shared/net/bundleVersion');
const fs = require('node:fs');
const path = require('node:path');
const { pruneOldVersions } = require('./versionHtmlAssets.cjs');

function pruneDevBundles(dist, now = Date.now()) {
  const referenced = new Set();
  try {
    // Development middleware writes to memory. The on-disk HTML usually
    // belongs to the last production build and may still reference old hashes.
    const entries = fs.readdirSync(dist, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
      const html = fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
      for (const [, name] of html.matchAll(/\/bundles\/([^"'?#\s/]+)(?=["'?#\s])/g)) {
        if (parseVersionedBundle(name)) referenced.add(name);
      }
    }
  } catch (error) {
    // Incomplete HTML inventory means it is unsafe to prune.
    if (error.code !== 'ENOENT') throw error;
    return [];
  }
  return pruneOldVersions(path.join(dist, 'bundles'), referenced, now);
}

class PruneDevBundlesPlugin {
  apply(compiler) {
    let pruned = false;
    compiler.hooks.afterEmit.tap('PruneDevBundles', compilation => {
      if (pruned || compilation.errors.length) return;
      pruned = true;
      try {
        pruneDevBundles(compiler.outputPath);
      } catch (error) {
        compiler.getInfrastructureLogger('PruneDevBundles').warn(error.message);
      }
    });
  }
}

module.exports = PruneDevBundlesPlugin;
module.exports.pruneDevBundles = pruneDevBundles;
