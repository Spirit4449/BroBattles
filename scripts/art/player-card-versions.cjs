// Usage: node scripts/art/player-card-versions.cjs
// Stamps each card animation's content hash into the catalog. Clients request
// `?v=<hash>`, which the server caches as immutable while the bytes match.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.resolve(__dirname, '../../public');
const CATALOG_PATH = path.resolve(__dirname, '../../src/shared/catalogs/playerCardsCatalog.json');
const FIELDS = [['animationUrl', 'animationVersion'], ['animationAppleUrl', 'animationAppleVersion']];

function playerCardAssetVersion(url) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(PUBLIC_DIR, url))).digest('hex').slice(0, 16);
}

function stampPlayerCardVersions(card) {
  for (const [urlField, versionField] of FIELDS) {
    if (card[urlField]) card[versionField] = playerCardAssetVersion(card[urlField]);
    else delete card[versionField];
  }
  return card;
}

if (require.main === module) {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  catalog.cards.forEach(stampPlayerCardVersions);
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`Versioned ${catalog.cards.filter(card => card.animationVersion).length} card animations.`);
}

module.exports = { FIELDS, playerCardAssetVersion, stampPlayerCardVersions };
