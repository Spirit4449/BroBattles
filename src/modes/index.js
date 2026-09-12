import { supportsSuddenDeath } from '../shared/modeCapabilities';

const loadedModes = new Map();
const pendingModes = new Map();
const modeLoaders = {
  'bank-bust': () =>
    Promise.all([
      import(/* webpackChunkName: "mode-bank-bust" */ './bankBust/runtime'),
      import(/* webpackChunkName: "mode-bank-bust" */ './bankBust/preloadAssets'),
    ]).then(([runtime, assets]) => ({
      create: runtime.createBankBustRuntime,
      preload: assets.preloadBankBustAssets,
    })),
};

export { supportsSuddenDeath };

export function loadMode(modeId) {
  const key = String(modeId || 'duels');
  if (loadedModes.has(key)) return Promise.resolve(loadedModes.get(key));

  const loader = modeLoaders[key];
  if (!loader) return Promise.resolve(null);
  if (pendingModes.has(key)) return pendingModes.get(key);

  const pending = loader().then(
    (mode) => {
      loadedModes.set(key, mode);
      pendingModes.delete(key);
      return mode;
    },
    (error) => {
      pendingModes.delete(key);
      throw error;
    },
  );
  pendingModes.set(key, pending);
  return pending;
}

export function preloadModeAssets(scene, modeId, staticPath) {
  loadedModes.get(String(modeId))?.preload?.(scene, staticPath);
}
export function createModeRuntime(options) {
  const modeId = options.getGameData()?.modeId || 'duels';
  return loadedModes.get(String(modeId))?.create(options) || { render() {}, destroy() {}, setEditMode() {} };
}
