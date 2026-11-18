// Run on each environment before dropping the tracked runtime map copies.
require('dotenv').config({ quiet: true });
const { mapRepository } = require('../../src/server/services/maps/mapRepository');

for (const result of mapRepository.importLegacy()) {
  if (result.error) {
    console.error(`Map ${result.id}: ${result.error.message}`, result.error.errors || '');
    process.exitCode = 1;
    continue;
  }
  console.log(`Map ${result.id}: ${result.imported ? 'imported' : 'already published'} ${result.revision}`);
}

const archive = mapRepository.pinHistory();
for (const entry of archive.filter(entry => entry.error)) {
  console.error(`History ${entry.id}/${entry.file}: ${entry.error.message}`);
  process.exitCode = 1;
}
console.log(`Verified artwork for ${archive.filter(entry => !entry.error).length} of ${archive.length} archived map documents.`);
