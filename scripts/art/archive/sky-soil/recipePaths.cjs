const path = require('node:path');

function prepareRecipe(script) {
  const input = process.argv[2];
  if (!input) {
    console.error(`Usage: node scripts/art/archive/sky-soil/${script} <source-directory>`);
    process.exit(2);
  }
  const directory = path.resolve(input);
  process.chdir(path.resolve(__dirname, '../../../..'));
  return filename => path.join(directory, filename);
}

module.exports = { prepareRecipe };
