import { BANK_BUST_VAULT_DEFAULT_WIDTH, BANK_BUST_VAULT_DEFAULT_HEIGHT, BANK_BUST_VAULT_DEFAULT_RADIUS } from "../../../../shared/bankBustSettings.js";
export function createLayout({ getGameData, state, cloneJson, playerLookup }) {
  function getBaseLayout() {
    return getGameData?.()?.mapSnapshot?.map?.objectiveLayout?.bankBust || null;
  }

  function getLayout() {
    if (!state.layout) {
      state.layout = cloneJson(getBaseLayout()) || {
        vaults: {},
        objects: [],
        randomGoldSpawnPoints: [],
      };
    }
    return state.layout;
  }

  function syncLayoutFromModeState(modeState) {
    const working = getLayout();
    if (modeState?.vaults) {
      working.vaults = working.vaults || {};
      for (const [team, vault] of Object.entries(modeState.vaults || {})) {
        const existing = working.vaults[team] || {};
        working.vaults[team] = {
          ...existing,
          width: Number(vault?.width) || existing.width || BANK_BUST_VAULT_DEFAULT_WIDTH,
          height: Number(vault?.height) || existing.height || BANK_BUST_VAULT_DEFAULT_HEIGHT,
          radius: Number(vault?.radius) || existing.radius || BANK_BUST_VAULT_DEFAULT_RADIUS,
          label: vault?.label || existing.label || null,
          x: Number.isFinite(Number(existing?.x)) ? Number(existing.x) : Number(vault?.x) || 0,
          y: Number.isFinite(Number(existing?.y)) ? Number(existing.y) : Number(vault?.y) || 0,
        };
      }
    }
    if (Array.isArray(modeState?.objects) && modeState.objects.length) {
      const byId = new Map((working.objects || []).map((entry) => [entry.id, entry]));
      for (const obj of modeState.objects) {
        const current = byId.get(obj.id) || {};
        byId.set(obj.id, {
          ...current,
          ...cloneJson(obj?.config || {}),
          id: obj.id,
          type: obj.type,
          x: Number.isFinite(Number(current?.x)) ? Number(current.x) : Number(obj?.x) || 0,
          y: Number.isFinite(Number(current?.y)) ? Number(current.y) : Number(obj?.y) || 0,
        });
      }
      working.objects = Array.from(byId.values());
    }
    if (Array.isArray(modeState?.randomGoldSpawnPoints) && modeState.randomGoldSpawnPoints.length) {
      const byId = new Map((working.randomGoldSpawnPoints || []).map((entry) => [entry.id, entry]));
      working.randomGoldSpawnPoints = modeState.randomGoldSpawnPoints.map((entry) => {
        const existing = byId.get(entry.id) || {};
        return {
          id: entry.id,
          x: Number.isFinite(Number(existing?.x)) ? Number(existing.x) : Number(entry.x) || 0,
          y: Number.isFinite(Number(existing?.y)) ? Number(existing.y) : Number(entry.y) || 0,
        };
      });
    }
  }

  function getModeObjectState(modeState, id) {
    return (Array.isArray(modeState?.objects) ? modeState.objects : []).find(
      (entry) => entry?.id === id,
    );
  }

  function getLayoutVault(team, vault) {
    const layoutVault = getLayout()?.vaults?.[team] || {};
    return {
      ...layoutVault,
      ...cloneJson(vault || {}),
      x: Number(layoutVault?.x) || Number(vault?.x) || 0,
      y: Number(layoutVault?.y) || Number(vault?.y) || 0,
      width: Number(layoutVault?.width) || Number(vault?.width) || BANK_BUST_VAULT_DEFAULT_WIDTH,
      height: Number(layoutVault?.height) || Number(vault?.height) || BANK_BUST_VAULT_DEFAULT_HEIGHT,
    };
  }

  // Every platform top in the map, for coins to land and bounce on.
  function getVaultFloors() {
    if (state.vaultFloors) return state.vaultFloors;
    const hitboxes = getGameData?.()?.mapSnapshot?.map?.layout?.hitboxes;
    state.vaultFloors = (Array.isArray(hitboxes) ? hitboxes : [])
      .filter((box) => box?.collision?.up !== false)
      .map((box) => ({
        left: Number(box.x) - Number(box.width) / 2,
        right: Number(box.x) + Number(box.width) / 2,
        top: Number(box.y) - Number(box.height) / 2,
      }));
    return state.vaultFloors;
  }

  function getObjectPositionById(id) {
    const layout = getLayout();
    const entry = (Array.isArray(layout?.objects) ? layout.objects : []).find(
      (obj) => obj?.id === id,
    );
    if (!entry) return null;
    return { x: Number(entry.x) || 0, y: Number(entry.y) || 0 };
  }

  function getPlayerPositionByName(name) {
    const spr = playerLookup.sprite(String(name || ""));
    if (!spr) return null;
    return { x: Number(spr.x) || 0, y: Number(spr.y) || 0 };
  }

  return {
    getLayout,
    syncLayoutFromModeState,
    getModeObjectState,
    getLayoutVault,
    getVaultFloors,
    getObjectPositionById,
    getPlayerPositionByName,
  };
}
