const { deepFreeze } = require('../deepFreeze');
// Built-in documents and their catalog metadata share one registration list.
const { mapSummary } = require('./mapDocument');
const mapDefaults = deepFreeze([
  require('./1.json'),
  require('./2.json'),
  require('./3.json'),
  require('./4.json'),
  require('./5.json'),
]);
const mapsCatalog = deepFreeze({
  defaultMapId: 1,
  maps: mapDefaults.map(mapSummary),
});
module.exports = { mapDefaults, mapsCatalog };
