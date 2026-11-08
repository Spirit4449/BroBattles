import { networkAdapter as ninja, createNinjaNetwork } from './ninja/network';
import { networkAdapter as huntress, createHuntressNetwork } from './huntress/network';
import { networkAdapter as wizard } from './wizard/network';
import { trackShotTargets, resetShotPrediction } from './shared/shotPrediction';
import { predictGloopHook } from './gloop/special';
import { playCharacterSound } from './index';
import { playHitFeedback } from './shared/hitFeedback';

// Explicit registration keeps client protocol code out of the shared catalog.
const registrations = [
  { adapter: ninja, create: options => createNinjaNetwork(options).networkAdapter },
  { adapter: huntress, create: options => createHuntressNetwork(options).networkAdapter },
  { adapter: wizard, create: () => wizard },
];
const adapters = registrations.map(entry => entry.adapter);
// Embedded simulations use the same registrations with isolated state/clocks.
export function createCharacterNetworkAdapters(options = {}) {
  return registrations.map(entry => entry.create(options));
}
const byCharacter = Object.fromEntries(adapters.map(adapter => [adapter.key, adapter]));
// Specials that launch a predicted shot without a dedicated protocol.
const specialPredictors = { gloop: predictGloopHook };

export function getCharacterNetworkVersions() {
  return Object.assign({}, ...adapters.map(adapter => adapter.joinFields));
}
export function configureCharacterNetworks(state) {
  for (const adapter of adapters) adapter.configure(state[adapter.bootstrapKey]);
}
export function resetCharacterNetworks() {
  for (const adapter of adapters) adapter.reset();
  resetShotPrediction();
}
export function discardCharacterPresentation() {
  for (const adapter of adapters) adapter.discard();
}
export function attachCharacterNetworks(scene, context) {
  trackShotTargets({ ...context,
    playHitSound: (character, sprite) => playCharacterSound(scene, character, 'hit', {}, sprite),
    playHitFeedback: (sprite, options) => playHitFeedback(scene, sprite, options) });
  for (const adapter of adapters) adapter.attach(scene, context);
}
export function observeCharacterSnapshot(snapshot) {
  for (const adapter of adapters) adapter.observe(snapshot);
}
export function handleCharacterNetworkPacket(scene, packet, context) {
  return adapters.some(adapter => adapter.handlePacket(scene, packet, context));
}
export function predictCharacterSpecial(character, scene, player, username, request) {
  const predict = byCharacter[character]?.predictSpecial || specialPredictors[character];
  return predict?.(scene, player, username, request) ?? request;
}
