import { networkAdapter as ninja } from './ninja/network';
import { networkAdapter as huntress } from './huntress/network';

// Explicit registration keeps client protocol code out of the shared catalog.
const adapters = [ninja, huntress];
const byCharacter = Object.fromEntries(adapters.map(adapter => [adapter.key, adapter]));

export function getCharacterNetworkVersions() {
  return Object.assign({}, ...adapters.map(adapter => adapter.joinFields));
}
export function configureCharacterNetworks(state) {
  for (const adapter of adapters) adapter.configure(state[adapter.bootstrapKey]);
}
export function resetCharacterNetworks() {
  for (const adapter of adapters) adapter.reset();
}
export function discardCharacterPresentation() {
  for (const adapter of adapters) adapter.discard();
}
export function attachCharacterNetworks(scene, context) {
  for (const adapter of adapters) adapter.attach(scene, context);
}
export function observeCharacterSnapshot(snapshot) {
  for (const adapter of adapters) adapter.observe(snapshot);
}
export function handleCharacterNetworkPacket(scene, packet, context) {
  return adapters.some(adapter => adapter.handlePacket(scene, packet, context));
}
export function predictCharacterSpecial(character, scene, player, username, request) {
  return byCharacter[character]?.predictSpecial(scene, player, username, request) ?? request;
}
