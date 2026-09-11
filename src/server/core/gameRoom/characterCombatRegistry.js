const ninja = require('./ninjaCombat');
const huntress = require('./huntressCombat');
const { characterDefinitions } = require('../../../shared/characters');

const adapters = [
  { key: 'ninja', api: ninja, bootstrapKey: 'ninjaCombat',
    specialPayload: (player, payload) => player.isBot
      ? { ...payload, id: `swarm:${++player._botActionSeq}`, aim: { angle: player.flip ? Math.PI : 0, ...payload.aim } } : payload },
  { key: 'huntress', api: huntress, bootstrapKey: 'huntressCombat',
    specialPayload: (player, payload) => player.isBot
      ? { ...payload, id: `special:${++player._botActionSeq}` } : payload },
];
const byCharacter = Object.fromEntries(adapters.map(adapter => [adapter.key, adapter]));

function getAdapter(room, player) {
  const adapter = byCharacter[player?.char_class];
  return adapter || null;
}
function ownsAction(room, player, action) {
  const adapter = getAdapter(room, player);
  return !!adapter && String(action?.type || '').startsWith(`${adapter.key}-`);
}
function requestAction(room, player, action) {
  const adapter = getAdapter(room, player);
  if (!adapter || action?.type !== characterDefinitions[adapter.key].basicAction) return false;
  return adapter.api.request(room, player, action);
}
function requestSpecial(room, player, payload) {
  const adapter = getAdapter(room, player);
  if (!adapter) return null;
  return { handled: true, result: adapter.api.request(room, player, adapter.specialPayload(player, payload), true) };
}
function initialize(room) { for (const adapter of adapters) adapter.api.initialize(room); }
function tick(room) { for (const adapter of adapters) adapter.api.tick(room); }
function dispose(room) { for (const adapter of adapters) adapter.api.dispose(room); }
function bootstrap(room) {
  return Object.fromEntries(adapters.map(adapter => [adapter.bootstrapKey, adapter.api.bootstrap(room)]));
}
module.exports = { initialize, tick, dispose, bootstrap, ownsAction, requestAction, requestSpecial };
