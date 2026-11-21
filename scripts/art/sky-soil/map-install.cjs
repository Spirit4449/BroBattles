// Applies one change to Sky Soil (map 2) in both places the game reads it:
// the shipped document (src/shared/maps/2.json) and the effective document,
// saved through the map repository's revision-aware save (the same path Map
// Studio uses), so a publication or legacy override picks it up too.
const fs = require('node:fs');
const path = require('node:path');
const { mapRepository } = require('../../../src/server/services/maps/mapRepository');

const ROOT = path.resolve(__dirname, '../../..');
const SHIPPED = path.join(ROOT, 'src/shared/maps/2.json');

// fn(document, { shipped }) mutates the document in place.
function updateSkySoil(fn) {
  const shipped = JSON.parse(fs.readFileSync(SHIPPED, 'utf8'));
  fn(shipped, { shipped: true });
  fs.writeFileSync(SHIPPED, JSON.stringify(shipped, null, 2) + '\n');
  const { document, revision } = mapRepository.get(2);
  const next = structuredClone(document);
  fn(next, { shipped: false });
  if (JSON.stringify(next) === JSON.stringify(document)) return;
  const saved = mapRepository.save(next, revision);
  console.log('saved map 2 revision', saved.revision.slice(0, 12));
}

module.exports = { updateSkySoil };
