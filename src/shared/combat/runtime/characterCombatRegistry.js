const ninja = require('./ninjaCombat.js');
const sparrow = require('./sparrowCombat.js');
const seraph = require('./abilities/sparrowSeraphAbility.js');
const { characterDefinitions } = require('../../characters');

const adapters = [
  { key: 'ninja', api: ninja, bootstrapKey: 'ninjaCombat',
    specialPayload: (player, payload) => player.isBot
      ? { ...payload, id: `swarm:${++player._botActionSeq}`, aim: { angle: player.flip ? Math.PI : 0, ...payload.aim } } : payload },
  // Sparrow's super (Seraph) activates like any ability; its one released
  // bolt arrives later as its own action.
  { key: 'sparrow', api: sparrow, bootstrapKey: 'sparrowCombat',
    actions: { 'sparrow-light-bolt': (room, player, action) => seraph.requestFire(room, player, action) } },
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
  if (!adapter) return false;
  const custom = adapter.actions?.[action?.type];
  if (custom) return custom(room, player, action);
  if (action?.type !== characterDefinitions[adapter.key].basicAction) return false;
  return adapter.api.request(room, player, action);
}
function requestSpecial(room, player, payload) {
  const adapter = getAdapter(room, player);
  if (!adapter?.specialPayload) return null;
  return { handled: true, result: adapter.api.request(room, player, adapter.specialPayload(player, payload), true) };
}
function initialize(room) { for (const adapter of adapters) adapter.api.initialize(room); }
function tick(room) { for (const adapter of adapters) adapter.api.tick(room); }
function dispose(room) { for (const adapter of adapters) adapter.api.dispose(room); }
function cancelCasts(room, player, options) { getAdapter(room, player)?.api.cancelCasts(room, player, options); }
function bootstrap(room) {
  return Object.fromEntries(adapters.map(adapter => [adapter.bootstrapKey, adapter.api.bootstrap(room)]));
}
module.exports = { hasProtocol: character => !!byCharacter[character], initialize, tick, dispose, cancelCasts, bootstrap, ownsAction, requestAction, requestSpecial };
