import { expandRing } from "./impactFx";
import { createLayout } from "./layout";
import { createPromptHost, createPurchasePrompt } from "./purchasePrompt";
import { createVaultRenderer } from "./vaultRenderer";
import { createProps } from "./props";
import { createGoldPickups } from "./goldPickups";
import { createCenterCrate } from "./centerCrate";
import { createTurretShots } from "./turretShots";
import { createCoinLedger } from "./coinLedger";
import { prefersReducedMotion } from "../../../ui/domMotion";
import {
  resolveBankBustSettings,
} from "../../../../shared/bankBustSettings.js";

import { RENDER_LAYERS } from "../../scene/renderLayers";
import { setShotBlockers, setStaticShotTargets } from "../../characters/shared/shotPrediction";

import { createDeathLootEffects } from "../../powerups/deathLootEffects";
import { createCoinFx } from "./coinFx";

import { createVaultEffects } from "./vaultEffects";

const DEFAULT_PURCHASE_FLOOR = resolveBankBustSettings().purchaseFloorCoins;
const modeSoundTrim = {
  "sfx-bankbust-turret-shoot": 0.65,
  "sfx-bankbust-turret-claim": 0.88,
  "sfx-bankbust-wall-claim": 0.27,
  "sfx-bankbust-mine-collect": 0.52,
  "sfx-bankbust-crate-incoming": 0.33,
};

function cloneJson(v) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch (_) {
    return null;
  }
}

function formatCoins(value) {
  return Number(value).toLocaleString("en-US");
}

export function createBankBustRuntime({
  scene,
  Phaser,
  getGameData,
  getModeState,
  getMapObjects,
  getLocalPlayer,
  playerLookup,
} = {}) {
  const state = {
    layout: null,
    lastCoinEventAt: 0,
    // Events that share lastCoinEventAt: a tick can land several in one
    // millisecond, and each of them is its own hit.
    coinEventsAtLast: new Set(),
    previousObjectStates: new Map(),
    mineOwnerById: new Map(),
    recentProjectileIds: new Set(),
    // A vault only busts on screen if this client saw it standing. Rejoining a
    // match after the fact shows the wreck without replaying the explosion.
    vaultsSeenStanding: new Set(),
    vaultBarGhost: new Map(),
    vaultFloors: null,
    centerGoldPhase: null,
    // Where each team's coins are bound this frame. Coins ask every frame, and
    // resolving the HUD end of that means reading the DOM.
    vaultTargetCache: new Map(),
    // Arrival ticks climb in pitch through one payout, so it sounds like a pile
    // of money landing rather than one sound repeating.
    payoutStreak: 0,
    payoutStreakAt: 0,
    // What the buy prompt is currently showing, so it is only rebuilt when it
    // actually changes rather than every frame.
    promptSignature: "",
  };

  // Honour the player's motion preference for the decorative layers. Combat
  // readability never depends on these, so they are safe to drop.
  const reducedMotion = prefersReducedMotion();

  const uiGraphics = scene.add.graphics();
  // Above every vault and prop: these are readouts drawn over the objects, and
  // at the props' own depth they lost the tie-break and vanished behind them.
  uiGraphics.setDepth(RENDER_LAYERS.GAME_OBJECTS + 6);
  const objectGraphics = scene.add.graphics();
  objectGraphics.setDepth(RENDER_LAYERS.GAME_OBJECTS - 1);

  const vaultSprites = new Map();
  const vaultGlows = new Map();
  const vaultCoinLabels = new Map();

  const objectContainers = new Map();
  const pickupSprites = new Map();
  const wallBodies = new Map();
  const turretBaseSprites = new Map();
  const turretHeadSprites = new Map();
  const mineSprites = new Map();
  const wallSprites = new Map();
  const turretProjectileSprites = new Map();
  const turretProjectileVisualState = new Map();
  const turretProjectileLocallyDestroyed = new Set();

  const impactRings = new Set();
  const promptUi = createPromptHost();
  const coinFx = createCoinFx({ scene, Phaser, reducedMotion });
  const lootFx = createDeathLootEffects(scene, Phaser);

  function getMapCentreX() {
    const vaults = Object.values(getLayout()?.vaults || {});
    return vaults.reduce((sum, vault) => sum + Number(vault.x), 0) / Math.max(1, vaults.length);
  }
  const vaultFx = createVaultEffects({
    coinFx,
    scene,
    Phaser,
    layers: RENDER_LAYERS,
    reducedMotion,
    getFloors: () => getVaultFloors(),
    getMapCentreX,
    playSfx: safePlaySfx,
    focusCamera: focusCameraOnBust,
  });

  /** The texture for a prop owned by `team`, falling back to the neutral one. */
  function teamTexture(base, team) {
    const shown = colourTeam(team);
    const key = `${base}-${shown === "team1" || shown === "team2" ? shown : "neutral"}`;
    return scene.textures?.exists?.(key) ? key : `${base}-neutral`;
  }

  function currentLocalPlayer() {
    return getLocalPlayer?.() || null;
  }

  function getLocalTeam() {
    return getGameData?.()?.yourTeam || currentLocalPlayer()?.team || null;
  }

  // Your own team always reads blue and the other team red, whichever slot
  // the server put you in. The artwork and tints are keyed by slot (team1 is
  // blue), so this swaps the slot used for colour only. Spectators, who have
  // no team, see the slots as they are.
  function colourTeam(team) {
    if (team !== "team1" && team !== "team2") return team;
    const local = getLocalTeam();
    if (local !== "team1" && local !== "team2") return team;
    return team === local ? "team1" : "team2";
  }

  // The match is over from here, and most of the players may be a whole map
  // away from the only thing still worth watching.
  function focusCameraOnBust(x, y) {
    const cam = scene.cameras?.main;
    if (!cam) return;
    try {
      cam.startFollow({ x, y }, false, 0.07, 0.07, 0, cam.followOffset?.y || 0);
    } catch (_) {}
  }

  function destroyContainer(entry) {
    try {
      entry?.destroy?.();
    } catch (_) {}
  }

  function safePlaySfx(key, config = {}) {
    try {
      if (!scene.cache?.audio?.exists?.(key)) return;
      const volume = (config.volume ?? 1) * (modeSoundTrim[key] ?? 1);
      scene.sound?.play?.(key, { ...config, volume });
    } catch (_) {}
  }

  /** An expanding ring, the one shape every impact in this mode shares. */
  function shockRing(x, y, { radius = 120, color = 0xfde68a, width = 4, duration = 480 } = {}) {
    if (reducedMotion) return;
    expandRing(
      scene,
      x,
      y,
      { radius, width, color, opacity: 0.9, depth: RENDER_LAYERS.ATTACKS, duration },
      impactRings,
    );
  }

  function cleanupUnused(map, usedIds) {
    for (const [id, entry] of map.entries()) {
      if (usedIds.has(id)) continue;
      if (typeof entry?.setVisible === "function") entry.setVisible(false);
    }
  }

  function render() {
    uiGraphics.clear();
    objectGraphics.clear();

    const modeState = getModeState?.() || null;
    if (modeState?.type !== "bank-bust") {
      setPrompt(null);
      hideUnusedVaults(new Set());
      cleanupUnused(objectContainers, new Set());
      cleanupUnused(mineSprites, new Set());
      cleanupUnused(wallSprites, new Set());
      cleanupUnused(turretBaseSprites, new Set());
      cleanupUnused(turretHeadSprites, new Set());
      for (const visual of pickupSprites.values()) {
        visual?.sprite?.setVisible?.(false);
        visual?.glow?.setVisible?.(false);
        visual?.shadow?.setVisible?.(false);
        visual?.halo?.setVisible?.(false);
      }
      hideCrate();
      for (const sprite of turretProjectileSprites.values()) sprite.setVisible(false);
      for (const visual of turretProjectileVisualState.values()) visual.comet.hide();
      hideUnusedWallBodies(null);
      return;
    }

    syncLayoutFromModeState(modeState);
    vaultFx.tick(scene.game?.loop?.delta);
    processModeEvents(modeState);

    renderObjects(modeState);
    renderPickups(modeState);
    renderCenterGold(modeState);
    renderTurretProjectiles(modeState);
    renderVaults(modeState);
    coinFx.update(scene?.game?.loop?.delta);
    setPrompt(computeInteractPrompt(modeState));
  }

  function destroy() {
    setStaticShotTargets("bankBust", []);
    setShotBlockers("bankBust", []);
    disposePrompt();
    for (const ring of impactRings) destroyContainer(ring);
    impactRings.clear();
    vaultFx.destroy();
    try {
      uiGraphics.destroy();
      objectGraphics.destroy();
    } catch (_) {}
    for (const entry of vaultSprites.values()) {
      destroyContainer(entry?.body);
    }
    for (const glow of vaultGlows.values()) {
      destroyContainer(glow?.halo);
      destroyContainer(glow?.core);
    }
    for (const label of vaultCoinLabels.values()) {
      destroyContainer(label._coinIcon);
      destroyContainer(label);
    }
    destroyCrate();
    for (const visual of pickupSprites.values()) destroyPickupVisual(visual);
    for (const entry of objectContainers.values()) destroyContainer(entry);
    for (const sprite of turretBaseSprites.values()) destroyContainer(sprite);
    for (const sprite of turretHeadSprites.values()) destroyContainer(sprite);
    turretMotion.clear();
    for (const sprite of mineSprites.values()) destroyContainer(sprite);
    for (const sprite of wallSprites.values()) destroyContainer(sprite);
    for (const sprite of turretProjectileSprites.values()) destroyContainer(sprite);
    turretProjectileVisualState.clear();
    turretProjectileLocallyDestroyed.clear();
    coinFx.destroy();
    for (const id of Array.from(wallBodies.keys())) {
      updateWallBody(id, null, false);
    }
    try {
      promptUi.host.remove();
    } catch (_) {}
  }

  const {
    getLayout,
    syncLayoutFromModeState,
    getModeObjectState,
    getLayoutVault,
    getVaultFloors,
    getObjectPositionById,
    getPlayerPositionByName,
  } = createLayout({ getGameData, state, cloneJson, playerLookup });
  const { setPrompt, computeInteractPrompt, disposePrompt } = createPurchasePrompt({
    promptUi,
    state,
    scene,
    formatCoins,
    currentLocalPlayer,
    getLocalTeam,
    DEFAULT_PURCHASE_FLOOR,
    getLayout,
    getModeObjectState,
  });
  const { ensureCoinIcon, placeCoinLabel, hideUnusedVaults, renderVaults } = createVaultRenderer({
    vaultSprites,
    scene,
    vaultGlows,
    Phaser,
    uiGraphics,
    vaultCoinLabels,
    vaultFx,
    getLayoutVault,
    getLocalTeam,
    state,
    reducedMotion,
    colourTeam,
    formatCoins,
  });
  const { ensureObjectSprite, turretMotion, updateWallBody, renderObjects, hideUnusedWallBodies } =
    createProps({
      getMapCentreX,
      objectContainers,
      scene,
      reducedMotion,
      Phaser,
      wallBodies,
      playerLookup,
      getLayout,
      state,
      mineSprites,
      teamTexture,
      formatCoins,
      ensureCoinIcon,
      placeCoinLabel,
      turretBaseSprites,
      turretHeadSprites,
      colourTeam,
      objectGraphics,
      wallSprites,
      cleanupUnused,
      getLocalTeam,
    });
  const { renderPickups, destroyPickupVisual } = createGoldPickups({
    lootFx,
    scene,
    Phaser,
    reducedMotion,
    pickupSprites,
    coinFx,
  });
  const { hideCrate, renderCenterGold, destroyCrate } = createCenterCrate({
    scene,
    lootFx,
    Phaser,
    shockRing,
    coinFx,
    safePlaySfx,
    reducedMotion,
    formatCoins,
    uiGraphics,
    objectGraphics,
    state,
    destroyContainer,
  });
  const { playTurretMuzzle, renderTurretProjectiles } = createTurretShots({
    reducedMotion,
    colourTeam,
    scene,
    Phaser,
    coinFx,
    getMapObjects,
    turretProjectileLocallyDestroyed,
    ensureObjectSprite,
    turretProjectileSprites,
    turretProjectileVisualState,
    wallBodies,
  });
  const { processModeEvents } = createCoinLedger({
    scene,
    getLayout,
    Phaser,
    state,
    safePlaySfx,
    vaultCoinLabels,
    reducedMotion,
    coinFx,
    formatCoins,
    getLayoutVault,
    vaultFx,
    getPlayerPositionByName,
    getObjectPositionById,
    cloneJson,
    playTurretMuzzle,
  });

  return {
    render,
    destroy,
  };
}
