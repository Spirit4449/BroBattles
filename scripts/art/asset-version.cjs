const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');

// Short content version stored in generated artwork manifests and catalogs.
function artAssetVersion(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
}

module.exports = { artAssetVersion };
