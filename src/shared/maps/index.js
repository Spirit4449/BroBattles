// Built-in documents and their catalog metadata share one registration list.
const mapDefaults = [
  require('./1.json'),
  require('./2.json'),
  require('./3.json'),
  require('./4.json'),
];
const mapsCatalog = {
  defaultMapId: 1,
  maps: mapDefaults.map(document => ({ ...document.metadata, id: document.id, label: document.label })),
};
module.exports = { mapDefaults, mapsCatalog };
