import { createBankBustRuntime } from './bankBust/runtime';
import { preloadBankBustAssets } from './bankBust/preloadAssets';
import { supportsSuddenDeath } from '../shared/modeCapabilities';

const modes = {
  'bank-bust': { create: createBankBustRuntime, preload: preloadBankBustAssets },
};
export { supportsSuddenDeath };
export function preloadModeAssets(scene, modeId, staticPath) {
  modes[modeId]?.preload?.(scene, staticPath);
}
export function createModeRuntime(options) {
  const modeId = options.getGameData()?.modeId || 'duels';
  return modes[modeId]?.create(options) || { render() {}, destroy() {}, setEditMode() {} };
}
