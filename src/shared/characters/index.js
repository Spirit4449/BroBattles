// Pure content registry: safe to import from the browser, server, and tools.
const definitions = [
  require('./ninja.json'),
  require('./thorg.json'),
  require('./draven.json'),
  require('./wizard.json'),
  require('./huntress.json'),
  require('./gloop.json'),
];
const characterDefinitions = Object.fromEntries(definitions.map(definition => [definition.key, definition]));
const characterStats = Object.fromEntries(definitions.map(definition => [definition.key, definition.stats]));
const characterFrames = Object.fromEntries(definitions.map(definition => [definition.key, definition.frame]));
const duckFrameCells = Object.fromEntries(definitions.map(definition => [definition.key, definition.duckFrame]));
const attackDescriptors = Object.assign({}, ...definitions.map(definition => definition.attacks));
// Client presentation knobs (art scale, animation locks, dash poses, ...).
const characterPresentation = (key) => characterDefinitions[key]?.presentation || {};
module.exports = { characterDefinitions, characterStats, characterFrames, duckFrameCells, attackDescriptors, characterPresentation };
