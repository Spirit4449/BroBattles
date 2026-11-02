import { RENDER_LAYERS } from "../../scene/renderLayers";
import { setStaticShotTargets } from "../../characters/shared/shotPrediction";
import PROP_FRAMES from "./propFrames.json";
import { createDeathLootEffects } from "../../powerups/deathLootEffects";
import { createCoinFx } from "./coinFx";
import {
  COIN_FRAME_SCALE,
  coinSpinFrame,
  crateStage,
  createCrateSpring,
  kickCrate,
  stepCrateSpring,
} from "./coinMotion.mjs";
import { createVaultEffects, PUFF_TEXTURE } from "./vaultEffects";
import { stepTurretAim } from "./turretMotion.mjs";

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

function createPromptHost() {
  const host = document.createElement("div");
  host.id = "bank-bust-prompt-host";
  host.innerHTML = `
    <style>
      /* A buy prompt, not a sentence. A key cap, what you get, what it costs:
         the old one spelled out "Press E - wall costs 5500 vault coins", which
         is a line of prose to read mid-fight.

         It floats over the thing being bought rather than sitting in the
         bottom-centre lane, where it covered the ability readout and told you
         nothing about which slot it meant. Its left and top are written each
         frame from the object's screen position. */
      #bank-bust-interact-prompt{position:fixed;left:0;top:0;transform:translate(-50%,-100%);display:none;align-items:center;gap:10px;z-index:100000;background:var(--bb-hud-bg);padding:8px 14px;color:var(--bb-text);font:10px/1 var(--bb-font-display);text-transform:uppercase;text-shadow:2px 2px 0 var(--bb-ink);box-shadow:var(--bb-hud-frame);white-space:nowrap;will-change:left,top}
      #bank-bust-interact-prompt.open{display:flex}
      #bank-bust-interact-prompt .bb-key{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 4px;background:var(--bb-text);color:var(--bb-ink);text-shadow:none;box-shadow:inset -2px -2px 0 rgba(0,0,0,.35)}
      #bank-bust-interact-prompt .bb-act{letter-spacing:.06em}
      #bank-bust-interact-prompt .bb-cost{display:inline-flex;align-items:center;gap:5px;color:#ffd264}
      #bank-bust-interact-prompt .bb-coin{width:10px;height:10px;border-radius:50%;background:#ffd264;box-shadow:inset -2px -2px 0 rgba(0,0,0,.35)}
      /* Affordable but blocked by the vault's spend floor: the price turns red
         and the key cap goes away, because pressing it would do nothing. */
      #bank-bust-interact-prompt.blocked .bb-cost{color:#ff8e8e}
      #bank-bust-interact-prompt.blocked .bb-coin{background:#ff8e8e}
    </style>
    <div id="bank-bust-interact-prompt"></div>
  `;
  document.body.appendChild(host);
  return { host, prompt: host.querySelector("#bank-bust-interact-prompt") };
}

export function createBankBustRuntime({
  scene,
  Phaser,
  getGameData,
  getModeState,
  getMapObjects,
  getLocalPlayer,
  getOpponentPlayers,
  getTeamPlayers,
} = {}) {
  const TURRET_RENDER_Y_OFFSET = 0;
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
  const reducedMotion = (() => {
    try {
      return !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    } catch (_) {
      return false;
    }
  })();

  const TEAM_TINT = { team1: 0x4f8ff7, team2: 0xf4584f };
  const TEAM_TINT_SOFT = { team1: 0x93c5fd, team2: 0xfca5a5 };
  const objectiveGraphics = scene.add.graphics();
  objectiveGraphics.setDepth(RENDER_LAYERS.GAME_OBJECTS);
  const uiGraphics = scene.add.graphics();
  // Above every vault and prop: these are readouts drawn over the objects, and
  // at the props' own depth they lost the tie-break and vanished behind them.
  uiGraphics.setDepth(RENDER_LAYERS.GAME_OBJECTS + 6);
  const objectGraphics = scene.add.graphics();
  objectGraphics.setDepth(RENDER_LAYERS.GAME_OBJECTS - 1);

  const vaultSprites = new Map();
  const vaultGlows = new Map();
  const vaultCoinLabels = new Map();
  // The crate, once it has been dropped: see ensureCrate.
  let crate = null;
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

  const promptUi = createPromptHost();
  const coinFx = createCoinFx({ scene, Phaser, reducedMotion });
  const lootFx = createDeathLootEffects(scene, Phaser);

  const vaultFx = createVaultEffects({
    scene,
    Phaser,
    layers: RENDER_LAYERS,
    reducedMotion,
    getFloors: getVaultFloors,
    // Halfway between the vaults, so a door blows out into the arena.
    getMapCentreX: () => {
      const vaults = Object.values(getLayout()?.vaults || {});
      return vaults.reduce((sum, vault) => sum + Number(vault.x), 0) / Math.max(1, vaults.length);
    },
    playSfx: safePlaySfx,
    focusCamera: focusCameraOnBust,
  });

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
          width: Number(vault?.width) || existing.width || 150,
          height: Number(vault?.height) || existing.height || 180,
          radius: Number(vault?.radius) || existing.radius || 90,
          label: vault?.label || existing.label || null,
          x: Number.isFinite(Number(existing?.x))
            ? Number(existing.x)
            : Number(vault?.x) || 0,
          y: Number.isFinite(Number(existing?.y))
            ? Number(existing.y)
            : Number(vault?.y) || 0,
        };
      }
    }
    if (Array.isArray(modeState?.objects) && modeState.objects.length) {
      const byId = new Map(
        (working.objects || []).map((entry) => [entry.id, entry]),
      );
      for (const obj of modeState.objects) {
        const current = byId.get(obj.id) || {};
        byId.set(obj.id, {
          ...current,
          ...cloneJson(obj?.config || {}),
          id: obj.id,
          type: obj.type,
          x: Number.isFinite(Number(current?.x))
            ? Number(current.x)
            : Number(obj?.x) || 0,
          y: Number.isFinite(Number(current?.y))
            ? Number(current.y)
            : Number(obj?.y) || 0,
        });
      }
      working.objects = Array.from(byId.values());
    }
    if (
      Array.isArray(modeState?.randomGoldSpawnPoints) &&
      modeState.randomGoldSpawnPoints.length
    ) {
      const byId = new Map(
        (working.randomGoldSpawnPoints || []).map((entry) => [entry.id, entry]),
      );
      working.randomGoldSpawnPoints = modeState.randomGoldSpawnPoints.map(
        (entry) => {
          const existing = byId.get(entry.id) || {};
          return {
            id: entry.id,
            x: Number.isFinite(Number(existing?.x))
              ? Number(existing.x)
              : Number(entry.x) || 0,
            y: Number.isFinite(Number(existing?.y))
              ? Number(existing.y)
              : Number(entry.y) || 0,
          };
        },
      );
    }
  }

  // `prompt` is { key?, action, cost?, blocked? } or null.
  /** The texture for a prop owned by `team`, falling back to the neutral one. */
  function teamTexture(base, team) {
    const key = `${base}-${team === "team1" || team === "team2" ? team : "neutral"}`;
    return scene.textures?.exists?.(key) ? key : `${base}-neutral`;
  }

  /** Where a world point lands on the page, for anchoring DOM to the scene. */
  function worldToPage(x, y) {
    const cam = scene?.cameras?.main;
    const canvas = scene?.game?.canvas;
    if (!cam || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / (scene.scale?.width || rect.width || 1);
    const scaleY = rect.height / (scene.scale?.height || rect.height || 1);
    return {
      x: rect.left + (x - cam.worldView.x) * cam.zoom * scaleX,
      y: rect.top + (y - cam.worldView.y) * cam.zoom * scaleY,
    };
  }

  function setPrompt(prompt = null) {
    const node = promptUi.prompt;
    if (!prompt?.action) {
      node.classList.remove("open", "blocked");
      node.replaceChildren();
      state.promptSignature = "";
      return;
    }
    // Pinned over the slot it is talking about. Without an anchor it would
    // still be drawn, just off the top-left corner, so fall back to the old
    // bottom-centre position rather than losing the prompt entirely.
    const anchor =
      Number.isFinite(prompt.worldX) && Number.isFinite(prompt.worldY)
        ? worldToPage(prompt.worldX, prompt.worldY)
        : null;
    if (anchor) {
      node.style.left = `${Math.round(anchor.x)}px`;
      node.style.top = `${Math.round(anchor.y)}px`;
    } else {
      node.style.left = "50%";
      node.style.top = `${Math.round((window.innerHeight || 0) - 120)}px`;
    }
    const signature = `${prompt.key || ""}|${prompt.action}|${prompt.cost ?? ""}|${prompt.blocked ? 1 : 0}`;
    node.classList.add("open");
    node.classList.toggle("blocked", !!prompt.blocked);
    if (state.promptSignature === signature) return;
    state.promptSignature = signature;
    const parts = [];
    if (prompt.key) {
      const key = document.createElement("span");
      key.className = "bb-key";
      key.textContent = prompt.key;
      parts.push(key);
    }
    const action = document.createElement("span");
    action.className = "bb-act";
    action.textContent = prompt.action;
    parts.push(action);
    if (Number.isFinite(prompt.cost)) {
      const cost = document.createElement("span");
      cost.className = "bb-cost";
      const coin = document.createElement("span");
      coin.className = "bb-coin";
      cost.append(coin, document.createTextNode(formatCoins(prompt.cost)));
      parts.push(cost);
    }
    node.replaceChildren(...parts);
  }

  function currentLocalPlayer() {
    return getLocalPlayer?.() || null;
  }

  function getAllRenderablePlayers() {
    const items = [];
    const local = currentLocalPlayer();
    if (local) items.push(local);
    for (const wrap of Object.values(getOpponentPlayers?.() || {})) {
      if (wrap?.opponent) items.push(wrap.opponent);
    }
    for (const wrap of Object.values(getTeamPlayers?.() || {})) {
      if (wrap?.opponent) items.push(wrap.opponent);
    }
    return items;
  }

  function getLocalTeam() {
    return getGameData?.()?.yourTeam || currentLocalPlayer()?.team || null;
  }

  function getModeObjectState(modeState, id) {
    return (Array.isArray(modeState?.objects) ? modeState.objects : []).find(
      (entry) => entry?.id === id,
    );
  }

  function computeInteractPrompt(modeState) {
    const localPlayer = currentLocalPlayer();
    if (!localPlayer || localPlayer.dead || !localPlayer.body) return "";
    const team = getLocalTeam();
    if (!team) return "";
    // Purchases are paid out of your own vault, and cannot take it below the
    // floor, so the prompt quotes both.
    const vaultCoins = Math.max(0, Number(modeState?.vaults?.[team]?.coins) || 0);
    const floorCoins = Math.max(0, Number(modeState?.purchaseFloorCoins) || 0);
    const canAfford = (cost) => vaultCoins - cost >= floorCoins;
    let best = null;
    for (const entry of Array.isArray(getLayout()?.objects)
      ? getLayout().objects
      : []) {
      if (entry?.type !== "claimableTurret" && entry?.type !== "wallSlot")
        continue;
      const dx = (Number(entry?.x) || 0) - localPlayer.x;
      const dy = (Number(entry?.y) || 0) - localPlayer.y;
      const distance = Math.hypot(dx, dy);
      // Match the server's own reach, so the prompt appears exactly where
      // pressing E would actually work.
      const interactionRadius = Math.max(
        24,
        Number(
          entry?.type === "claimableTurret" ? entry?.claimRadius : entry?.buildRadius,
        ) ||
          Number(entry?.interactionRadius) ||
          74,
      );
      if (distance > interactionRadius) continue;
      if (!best || distance < best.distance) best = { entry, distance };
    }
    if (!best?.entry) return null;
    const runtimeObject = getModeObjectState(modeState, best.entry.id) || {
      state: {},
      type: best.entry.type,
    };
    // Hung a little above the slot, clear of a character standing on it.
    const worldX = Number(best.entry?.x) || 0;
    const worldY = (Number(best.entry?.y) || 0) - (Number(best.entry?.height) || 64) / 2 - 18;
    const buy = (action, cost, owned) => {
      if (owned) return { action, worldX, worldY };
      return {
        key: canAfford(cost) ? "E" : null,
        action, cost, worldX, worldY,
        blocked: !canAfford(cost),
      };
    };
    if (best.entry.type === "claimableTurret") {
      return buy("Turret", Math.max(0, Number(best.entry?.claimCost) || 0),
        runtimeObject?.state?.claimedByTeam === team);
    }
    return buy("Wall", Math.max(0, Number(best.entry?.cost) || 0),
      runtimeObject?.state?.builtByTeam === team);
  }

  function getLayoutVault(team, vault) {
    const layoutVault = getLayout()?.vaults?.[team] || {};
    return {
      ...layoutVault,
      ...cloneJson(vault || {}),
      x: Number(layoutVault?.x) || Number(vault?.x) || 0,
      y: Number(layoutVault?.y) || Number(vault?.y) || 0,
      width: Number(layoutVault?.width) || Number(vault?.width) || 150,
      height: Number(layoutVault?.height) || Number(vault?.height) || 180,
    };
  }

  // Which vault frame a coin level should be showing. The vault visibly
  // degrades as it is emptied, so its condition reads from across the map.
  function vaultStateKey(coins, startingCoins) {
    if (coins <= 0) return "breached";
    const ratio = coins / Math.max(1, startingCoins);
    return ratio <= 0.4 ? "damaged" : "intact";
  }

  function ensureVaultSprite(team) {
    let entry = vaultSprites.get(team) || null;
    if (entry?.body?.scene) return entry;
    if (!scene.textures?.exists?.("bank-bust-vault-intact")) return null;
    const body = scene.add.image(-9999, -9999, "bank-bust-vault-intact");
    body.setDepth(RENDER_LAYERS.GAME_OBJECTS + 1);
    body.setVisible(false);
    // Older vault artwork painted its team parts in a magenta key, which the
    // install split into a white mask to tint. The current artwork does not:
    // the team colour is the glow and the hit outline instead. Asking for a
    // texture that is not loaded would draw Phaser's missing-texture box over
    // the door, so the mask is only used when it is actually there.
    const accentKey = "bank-bust-vault-intact-accent";
    const accent = scene.textures?.exists?.(accentKey)
      ? scene.add.image(-9999, -9999, accentKey)
      : null;
    if (accent) {
      accent.setDepth(RENDER_LAYERS.GAME_OBJECTS + 2);
      accent.setVisible(false);
    }
    entry = { body, accent, stateKey: null };
    vaultSprites.set(team, entry);
    return entry;
  }

  // A warm halo behind each vault. The vault is the thing both teams are
  // playing around, and without it the door was just another dark panel on a
  // dark wall: you could walk past your own objective without seeing it.
  function ensureVaultGlow(team) {
    let glow = vaultGlows.get(team) || null;
    if (glow?.halo?.scene) return glow;
    const halo = scene.add.image(-9999, -9999, PUFF_TEXTURE);
    halo.setBlendMode(Phaser.BlendModes.ADD);
    halo.setDepth(RENDER_LAYERS.GAME_OBJECTS - 2);
    const core = scene.add.image(-9999, -9999, PUFF_TEXTURE);
    core.setBlendMode(Phaser.BlendModes.ADD);
    core.setDepth(RENDER_LAYERS.GAME_OBJECTS - 2);
    glow = { halo, core };
    vaultGlows.set(team, glow);
    return glow;
  }

  // The coins-in-vault number, drawn over each vault in the world.
  function ensureVaultCoinLabel(team) {
    let label = vaultCoinLabels.get(team) || null;
    if (label?.scene) return label;
    label = scene.add.text(-9999, -9999, "0", {
      fontFamily: "'Press Start 2P', monospace",
      fontSize: "13px",
      color: "#fde68a",
      stroke: "#0b1220",
      strokeThickness: 5,
    });
    label.setOrigin(0.5);
    label.setDepth(RENDER_LAYERS.GAME_OBJECTS + 7);
    vaultCoinLabels.set(team, label);
    return label;
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

  // The match is over from here, and most of the players may be a whole map
  // away from the only thing still worth watching.
  function focusCameraOnBust(x, y) {
    const cam = scene.cameras?.main;
    if (!cam) return;
    try {
      cam.startFollow({ x, y }, false, 0.07, 0.07, 0, cam.followOffset?.y || 0);
    } catch (_) {}
  }

  function hideUnusedVaults(usedTeams) {
    for (const [team, entry] of vaultSprites.entries()) {
      if (usedTeams.has(team)) continue;
      vaultFx.hide(team);
      entry?.body?.setVisible?.(false);
      entry?.accent?.setVisible?.(false);
    }
    for (const [team, glow] of vaultGlows.entries()) {
      if (usedTeams.has(team)) continue;
      glow?.halo?.setVisible?.(false);
      glow?.core?.setVisible?.(false);
    }
    for (const [team, label] of vaultCoinLabels.entries()) {
      if (!usedTeams.has(team)) label?.setVisible?.(false);
    }
  }

  function destroyContainer(entry) {
    try {
      entry?.destroy?.();
    } catch (_) {}
  }

  function ensureObjectContainer(id, type) {
    let container = objectContainers.get(id) || null;
    if (container?.scene) return container;
    const bg = scene.add.rectangle(0, 0, 130, 62, 0x000000, 0);
    const label = scene.add.text(0, 0, type, {
      fontFamily: "Lato, sans-serif",
      fontSize: "13px",
      color: "#f8fafc",
      fontStyle: "700",
      stroke: "#0f172a",
      strokeThickness: 4,
    });
    label.setOrigin(0.5);
    container = scene.add.container(-9999, -9999, [bg, label]);
    container.setSize(150, 90);
    container.setDepth(RENDER_LAYERS.GAME_OBJECTS + 1);
    container.setVisible(false);
    container._bg = bg;
    container._label = label;
    objectContainers.set(id, container);
    return container;
  }

  function ensureObjectSprite(
    map,
    id,
    textureKey,
    depth = RENDER_LAYERS.GAME_OBJECTS + 2,
  ) {
    let sprite = map.get(id) || null;
    if (sprite?.scene) return sprite;
    if (!scene.textures?.exists?.(textureKey)) return null;
    sprite = scene.add.image(-9999, -9999, textureKey);
    sprite.setDepth(depth);
    sprite.setVisible(false);
    map.set(id, sprite);
    return sprite;
  }

  // An animated prop. Its texture is per owner, so changing hands restarts the
  // loop on the new owner's sheet.
  function ensurePropSprite(map, id, textureKey, frames, depth) {
    let sprite = map.get(id) || null;
    if (!sprite?.scene) {
      if (!scene.textures?.exists?.(textureKey)) return null;
      sprite = scene.add.sprite(-9999, -9999, textureKey);
      sprite.setDepth(depth);
      sprite.setVisible(false);
      map.set(id, sprite);
    }
    if (sprite._propKey !== textureKey && scene.textures?.exists?.(textureKey)) {
      sprite._propKey = textureKey;
      const anim = `bank-bust-prop:${textureKey}`;
      if (!scene.anims.exists(anim)) {
        scene.anims.create({ key: anim, frameRate: frames.rate, repeat: -1,
          frames: Array.from({ length: frames.frames }, (_, frame) => ({ key: textureKey, frame })) });
      }
      sprite.play(anim);
    }
    return sprite;
  }

  // Idle guns droop or sweep. Once aimed, the barrel follows the same server
  // angle as the bullets, with recoil on every shot.
  const turretMotion = new Map();
  const TURRET_RECOIL_PX = 9;

  function animateTurret(id, head, base, entry, runtime, ownerTeam, socket) {
    const now = scene.time.now;
    const seconds = now / 1000;
    const dt = Math.min(50, Number(scene.game?.loop?.delta) || 16) / 1000;
    let motion = turretMotion.get(id);
    if (!motion) {
      // Unclaimed turrets start facing the far side of the level, like their owner.
      const facing = Number(entry.x) < 2500 ? Math.PI : 0;
      motion = { angle: facing, facing, shotAt: NaN, recoil: 0, phase: Number(entry.x) % 7 };
      turretMotion.set(id, motion);
    }
    stepTurretAim(motion, runtime?.state?.aimAngle, ownerTeam, now, dt);

    const shotAt = Number(runtime?.state?.lastShotAt);
    if (Number.isFinite(shotAt) && shotAt !== motion.shotAt) {
      if (Number.isFinite(motion.shotAt)) {
        motion.recoil = 1;
        flashMuzzle(socket, motion.angle);
      }
      motion.shotAt = shotAt;
    }
    motion.recoil = Math.max(0, motion.recoil - dt * 6);

    // The barrels are drawn pointing left, so the gun kicks along its own +x.
    const kick = motion.recoil * motion.recoil * TURRET_RECOIL_PX;
    const hum = ownerTeam ? Math.sin(seconds * 2.6 + motion.phase) * 0.8 : 0;
    head.setRotation(motion.angle);
    head.setFlipY(Math.cos(motion.angle) < 0);
    head.setPosition(socket.x + Math.cos(motion.angle) * kick, socket.y + Math.sin(motion.angle) * kick + hum);
    base.y += motion.recoil * 1.5;
    head.anims.timeScale = ownerTeam ? 1 : 0.25;
    base.anims.timeScale = ownerTeam ? 1 : 0.35;
  }

  function flashMuzzle(socket, angle) {
    if (reducedMotion) return;
    const reach = PROP_FRAMES["turret-gun"].frameWidth * PROP_FRAMES["turret-gun"].hubX;
    const flash = scene.add.circle(
      socket.x - Math.cos(angle) * reach,
      socket.y - Math.sin(angle) * reach,
      7, 0xffd9a0, 0.9,
    );
    flash.setDepth(RENDER_LAYERS.GAME_OBJECTS + 2);
    flash.setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: flash, alpha: 0, scale: 1.6, duration: 90, ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });
  }

  function safePlaySfx(key, config = {}) {
    try {
      if (!scene.cache?.audio?.exists?.(key)) return;
      scene.sound?.play?.(key, config);
    } catch (_) {}
  }

  function ensureWallBody(id, entry) {
    let wall = wallBodies.get(id) || null;
    if (wall?.zone?.scene) return wall;
    const zone = scene.add.zone(
      Number(entry?.x) || 0,
      Number(entry?.y) || 0,
      Math.max(10, Number(entry?.width) || 120),
      Math.max(10, Number(entry?.height) || 46),
    );
    scene.physics.add.existing(zone, true);
    zone.setVisible(false);
    wall = { zone, colliders: [], builtByTeam: null };
    wallBodies.set(id, wall);
    return wall;
  }

  function rebuildWallColliders(wall, builtByTeam) {
    if (!wall?.zone) return;
    for (const collider of wall.colliders || []) {
      try {
        collider?.destroy?.();
      } catch (_) {}
    }
    wall.colliders = [];
    wall.builtByTeam = builtByTeam || null;
    if (builtByTeam !== "team1" && builtByTeam !== "team2") return;

    const local = currentLocalPlayer();
    const localTeam = getLocalTeam();
    const addCollider = (sprite) => {
      if (!sprite?.body || !wall.zone?.body) return;
      try {
        wall.colliders.push(scene.physics.add.collider(sprite, wall.zone));
      } catch (_) {}
    };

    // The owning team can pass through; only the opposing team collides.
    const ownerIsLocalTeam = localTeam === builtByTeam;
    if (!ownerIsLocalTeam) {
      addCollider(local);
      for (const wrap of Object.values(getTeamPlayers?.() || {})) {
        addCollider(wrap?.opponent);
      }
    }
    if (ownerIsLocalTeam) {
      for (const wrap of Object.values(getOpponentPlayers?.() || {})) {
        addCollider(wrap?.opponent);
      }
    }
  }

  function updateWallBody(id, entry, active, builtByTeam = null) {
    if (!active) {
      const existing = wallBodies.get(id);
      if (!existing) return;
      try {
        existing.zone?.destroy?.();
      } catch (_) {}
      for (const collider of existing.colliders || []) {
        try {
          collider?.destroy?.();
        } catch (_) {}
      }
      wallBodies.delete(id);
      return;
    }
    const wall = ensureWallBody(id, entry);
    if (!wall?.zone) return;
    wall.zone.setPosition(Number(entry?.x) || 0, Number(entry?.y) || 0);
    wall.zone.setSize(
      Math.max(10, Number(entry?.width) || 120),
      Math.max(10, Number(entry?.height) || 46),
    );
    wall.zone.body?.setSize?.(
      Math.max(10, Number(entry?.width) || 120),
      Math.max(10, Number(entry?.height) || 46),
      true,
    );
    wall.zone.body?.updateFromGameObject?.();
    rebuildWallColliders(wall, builtByTeam);
  }

  function resolveScenePointFromHud(selector) {
    try {
      const el = document.querySelector(selector);
      const canvas = scene?.game?.canvas;
      const cam = scene?.cameras?.main;
      if (!el || !canvas || !cam) return null;
      const er = el.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      const sx = er.left + er.width / 2 - cr.left;
      const sy = er.top + er.height / 2 - cr.top;
      return cam.getWorldPoint(sx, sy);
    } catch (_) {
      return null;
    }
  }

  // Where a team's coins live on screen: the vault itself in the world, and
  // its row in the HUD. Collected coins travel to whichever is on camera, so
  // the connection between picking a coin up and the vault filling is visible.
  function vaultScreenTarget(team) {
    const vault = getLayout()?.vaults?.[team];
    if (vault && Number.isFinite(Number(vault.x))) {
      const cam = scene?.cameras?.main;
      const x = Number(vault.x);
      const y = Number(vault.y);
      if (cam && Phaser.Geom.Rectangle.Contains(cam.worldView, x, y)) {
        return { x, y };
      }
    }
    return resolveScenePointFromHud(
      `#bank-bust-${String(team || "").toLowerCase()} .bank-bust-vault-coins`,
    );
  }

  function cachedVaultTarget(team) {
    const cached = state.vaultTargetCache.get(team);
    if (cached?.at === scene.time.now) return cached.point;
    const point = vaultScreenTarget(team);
    state.vaultTargetCache.set(team, { at: scene.time.now, point });
    return point;
  }

  function playPayoutTick() {
    const now = scene.time.now;
    state.payoutStreak = now - state.payoutStreakAt > 500 ? 0 : state.payoutStreak + 1;
    state.payoutStreakAt = now;
    safePlaySfx("sfx-coin-pickup", {
      volume: 0.07,
      rate: Math.min(1.7, 0.95 + state.payoutStreak * 0.07),
    });
  }

  // The vault's number gets a knock each time coins land on it.
  function punchVaultLabel(team) {
    const label = vaultCoinLabels.get(team);
    if (!label?.scene || reducedMotion) return;
    scene.tweens.killTweensOf(label);
    label.setScale(1.3);
    scene.tweens.add({ targets: label, scale: 1, duration: 200, ease: "Back.easeOut" });
  }

  function flyCoinsToVault({ x, y, team, amount = 1, big = false }) {
    coinFx.floatText(Number(x), Number(y) - 18, `+${formatCoins(Math.abs(Number(amount)))}`, {
      size: big ? 16 : 13,
    });
    const count = big
      ? 12
      : Math.max(4, Math.min(9, Math.round(Math.abs(Number(amount)) / 220) + 2));
    coinFx.flyTo(Number(x), Number(y), () => cachedVaultTarget(team), {
      count,
      onArrive: () => {
        playPayoutTick();
        punchVaultLabel(team);
      },
    });
  }

  // A purchase: coins leave the vault and land on the thing being bought.
  function flyCoinsFromVault({ x, y, team, amount = 1 }) {
    coinFx.floatText(Number(x), Number(y) - 40, `-${formatCoins(Math.abs(Number(amount)))}`, {
      color: "#ff9d9d", size: 13,
    });
    const origin = cachedVaultTarget(team);
    if (!origin) return;
    const target = { x: Number(x), y: Number(y) };
    coinFx.flyTo(origin.x, origin.y, () => target, {
      count: Math.max(4, Math.min(10, Math.round(Math.abs(Number(amount)) / 900) + 3)),
      onArrive: playPayoutTick,
    });
  }

  /**
   * Coins thrown out of a point, as loose objects. Used wherever gold is
   * physically knocked out of something.
   */
  function burstCoins(x, y, options = {}) {
    coinFx.burst(x, y, options);
  }

  /** An expanding ring, the one shape every impact in this mode shares. */
  function shockRing(x, y, { radius = 120, color = 0xfde68a, width = 4, duration = 480 } = {}) {
    if (reducedMotion) return;
    const ring = scene.add.circle(x, y, 8, 0x000000, 0);
    ring.setStrokeStyle(width, color, 0.9);
    ring.setDepth(RENDER_LAYERS.ATTACKS);
    scene.tweens.add({
      targets: ring, radius, alpha: 0, duration, ease: "Cubic.easeOut",
      onComplete: () => { try { ring.destroy(); } catch (_) {} },
    });
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
    const local = currentLocalPlayer();
    const localName = String(getGameData?.()?.username || "");
    if (name && local && localName && String(name) === localName) {
      return { x: Number(local.x) || 0, y: Number(local.y) || 0 };
    }
    const wrap =
      (getOpponentPlayers?.() || {})[String(name)] ||
      (getTeamPlayers?.() || {})[String(name)] ||
      null;
    const spr = wrap?.opponent || null;
    if (!spr) return null;
    return { x: Number(spr.x) || 0, y: Number(spr.y) || 0 };
  }

  function cleanupUnused(map, usedIds) {
    for (const [id, entry] of map.entries()) {
      if (usedIds.has(id)) continue;
      if (typeof entry?.setVisible === "function") entry.setVisible(false);
    }
  }

  function renderVaults(modeState) {
    const usedVaults = new Set();
    // Standing enemy vaults are shot targets for this player's predicted hits.
    const shotTargets = [];
    const lowRatio = Number(modeState?.lowCoinsRatio) || 0.25;

    for (const [team, vaultRaw] of Object.entries(modeState?.vaults || {})) {
      usedVaults.add(team);
      const vault = getLayoutVault(team, vaultRaw);
      const coins = Math.max(0, Number(vaultRaw?.coins) || 0);
      const startingCoins = Math.max(1, Number(vaultRaw?.startingCoins) || 1);
      const ratio = Phaser.Math.Clamp(coins / startingCoins, 0, 1);
      const width = Math.max(60, Number(vault.width) || 150);
      const height = Math.max(60, Number(vault.height) || 180);
      const x = Number(vault.x) || 0;
      const y = Number(vault.y) || 0;

      if (coins > 0 && getLocalTeam() && team !== getLocalTeam()) {
        shotTargets.push({ name: `vault:${team}`, inset: false, bounds: {
          left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 } });
      }

      if (coins > 0) {
        state.vaultsSeenStanding.add(team);
      } else if (state.vaultsSeenStanding.delete(team)) {
        vaultFx.bust(team, { x, y, width, height });
      }

      const entry = ensureVaultSprite(team);
      let stateKey = vaultStateKey(coins, startingCoins);
      if (entry?.stateKey && vaultFx.holdingFrame(team, entry.stateKey)) {
        stateKey = entry.stateKey;
      }
      if (entry && entry.stateKey !== stateKey) {
        if (entry.stateKey) {
          vaultFx.conditionChanged(team, { x, y, width, height }, entry.stateKey, stateKey);
        }
        entry.stateKey = stateKey;
        entry.body.setTexture(`bank-bust-vault-${stateKey}`);
        const accentKey = `bank-bust-vault-${stateKey}-accent`;
        if (entry.accent && scene.textures?.exists?.(accentKey)) {
          entry.accent.setTexture(accentKey);
        }
      }

      const low = ratio <= lowRatio;
      const pose = vaultFx.pose(team, { x, y, width, height }, { low, stateKey });
      const drawX = pose.x;
      const drawY = pose.y;

      if (entry) {
        for (const sprite of [entry.body, entry.accent]) {
          if (!sprite) continue;
          sprite.setPosition(drawX, pose.spriteY);
          sprite.setDisplaySize(width * pose.scaleX, height * pose.scaleY);
          sprite.setVisible(true);
        }
        entry.body.clearTint();
        if (pose.flash) entry.body.setTintFill(0xffffff);
        else if (stateKey === "breached") entry.body.setTint(0x8b93a4);
        else if (pose.alarm) entry.body.setTint(0xffb3a6);
        if (entry.accent) {
          // The accent mask is white, so tinting it gives an exact team
          // colour. It dims as the vault empties and flashes while it is hit.
          entry.accent.setTint(pose.hot ? 0xffffff : TEAM_TINT[team] || 0xffffff);
          entry.accent.setAlpha(coins <= 0 ? 0.25 : 0.55 + 0.45 * ratio);
        }
      }

      // A halo behind the door, breathing, and brighter the fuller the vault
      // is. This is what makes the objective findable across a dark level.
      const glow = ensureVaultGlow(team);
      if (glow) {
        const breathe = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(scene.time.now / 900);
        const alive = coins > 0 ? 1 : 0.25;
        const haloColour = pose.bloom > 0.15 ? 0xffb347 : pose.alarm ? 0xff3b30 : coins > 0 ? 0xffb347 : 0x64748b;
        const haloAlpha = pose.alarm ? 0.26 : (0.1 + 0.07 * breathe) * alive;
        const haloSize = 2 * (width * (1 + 0.7 * pose.bloom) + 18 * breathe);
        glow.halo.setPosition(drawX, drawY);
        glow.halo.setDisplaySize(haloSize, haloSize);
        glow.halo.setTint(haloColour);
        glow.halo.setAlpha(Math.min(1, 2.2 * (haloAlpha + 0.32 * pose.bloom)));
        glow.halo.setVisible(true);
        const coreSize = 2 * (width * 0.62 + 8 * breathe);
        glow.core.setPosition(drawX, drawY);
        glow.core.setDisplaySize(coreSize, coreSize);
        glow.core.setTint(TEAM_TINT_SOFT[team] || 0xffd264);
        glow.core.setAlpha(1.6 * (0.1 + 0.08 * breathe) * alive);
        glow.core.setVisible(true);
      }

      // The hit box, drawn. These are exactly the bounds a shot is tested
      // against, so a vault now visibly occupies the rectangle it occupies:
      // before this there was nothing to tell you it could be attacked at all.
      if (coins > 0) {
        const hitLeft = drawX - width / 2;
        const hitTop = drawY - height / 2;
        const outlineTint = TEAM_TINT[team] || 0xffffff;
        uiGraphics.lineStyle(3, pose.hot ? 0xfff1b8 : outlineTint, pose.hot ? 1 : 0.7);
        uiGraphics.strokeRect(hitLeft, hitTop, width, height);
        // Corner ticks, so the rectangle still reads as a target and not as a
        // box someone drew around the art.
        const tick = Math.round(Math.min(width, height) * 0.16);
        uiGraphics.lineStyle(5, pose.hot ? 0xffffff : outlineTint, 0.95);
        for (const [cx, sx] of [[hitLeft, 1], [hitLeft + width, -1]]) {
          for (const [cy, sy] of [[hitTop, 1], [hitTop + height, -1]]) {
            uiGraphics.beginPath();
            uiGraphics.moveTo(cx + sx * tick, cy);
            uiGraphics.lineTo(cx, cy);
            uiGraphics.lineTo(cx, cy + sy * tick);
            uiGraphics.strokePath();
          }
        }
      }

      // Coins are this mode's only health pool, so one bar carries both
      // readings: how much is left to steal and how close the vault is to
      // breaking. Keep the bar and coin label above the artwork so neither
      // is covered by the vault or the platform it stands on.
      const barWidth = Math.round(width * 0.86);
      const barHeight = 12;
      const barX = drawX - barWidth / 2;
      const barY = drawY - height / 2 - barHeight - 12;
      uiGraphics.fillStyle(0x0b1220, 0.9);
      uiGraphics.fillRect(barX - 3, barY - 3, barWidth + 6, barHeight + 6);
      uiGraphics.fillStyle(0x1f2937, 1);
      uiGraphics.fillRect(barX, barY, barWidth, barHeight);
      // What was just lost stays lit and drains away, so a hit reads on the
      // bar as a chunk gone rather than a width that quietly changed.
      const ghostRatio = Math.max(
        ratio,
        (state.vaultBarGhost.get(team) ?? ratio) -
          (reducedMotion ? 1 : (Number(scene.game?.loop?.delta) || 16) / 900),
      );
      state.vaultBarGhost.set(team, ghostRatio);
      uiGraphics.fillStyle(0xffffff, 0.85);
      uiGraphics.fillRect(barX, barY, barWidth * ghostRatio, barHeight);
      const flashOn =
        low && !reducedMotion && Math.sin(scene.time.now / 160) > 0;
      uiGraphics.fillStyle(
        flashOn ? 0xfff1b8 : TEAM_TINT_SOFT[team] || 0xffffff,
        1,
      );
      uiGraphics.fillRect(barX, barY, Math.max(0, barWidth * ratio), barHeight);
      // Where spending has to stop, marked on the same bar.
      const floorCoins = Math.max(0, Number(modeState?.purchaseFloorCoins) || 0);
      if (floorCoins > 0 && floorCoins < startingCoins) {
        uiGraphics.fillStyle(0xffffff, 0.6);
        uiGraphics.fillRect(
          barX + barWidth * (floorCoins / startingCoins),
          barY,
          2,
          barHeight,
        );
      }
      const coinLabel = ensureVaultCoinLabel(team);
      coinLabel.setText(formatCoins(coins));
      coinLabel.setPosition(drawX, barY - 14);
      coinLabel.setScale(pose.labelScale);
      coinLabel.setVisible(true);
    }
    hideUnusedVaults(usedVaults);
    const site = modeState?.centerGold;
    if (site?.phase === "active" && site.health > 0) {
      const width = Number(site.width) || 124;
      const height = Number(site.height) || 116;
      shotTargets.push({ name: "crate:center", inset: false, bounds: {
        left: site.x - width / 2, right: site.x + width / 2,
        top: site.y - height / 2, bottom: site.y + height / 2 } });
    }
    setStaticShotTargets("bankBust", shotTargets);
  }

  function renderObjects(modeState) {
    const layout = getLayout();
    const objectStateById = new Map(
      (Array.isArray(modeState?.objects) ? modeState.objects : []).map(
        (entry) => [entry.id, entry],
      ),
    );
    const usedObjectIds = new Set();
    for (const entry of Array.isArray(layout?.objects) ? layout.objects : []) {
      usedObjectIds.add(entry.id);
      const runtime = objectStateById.get(entry.id) || {
        state: {},
        type: entry.type,
      };
      const container = ensureObjectContainer(entry.id, entry.type);
      container.setVisible(true);
      container.x = Number(entry.x) || 0;
      container.y = Number(entry.y) || 0;
      const label = container._label;
      label.setPosition(0, 0);
      if (entry.type === "goldMine") {
        const owner = state.mineOwnerById.get(entry.id) || null;
        // One texture per owner rather than a tint over the whole sprite: a
        // multiply tint turns dark steel into washed blue, and the artwork
        // already marks the parts that belong to a team.
        const mineFrames = PROP_FRAMES.mine;
        const mineSprite = ensurePropSprite(
          mineSprites,
          entry.id,
          teamTexture("bank-bust-mine", owner),
          mineFrames,
          RENDER_LAYERS.GAME_OBJECTS,
        );
        if (mineSprite) {
          mineSprite.setVisible(true);
          mineSprite.setPosition(container.x, container.y);
          mineSprite.setScale(1);
          mineSprite.clearTint();
        }
        // The count is lit on the brass plate painted across the mine's frame.
        const stored = Math.max(0, Number(runtime?.state?.storedGold) || 0);
        const full = stored >= Math.max(1, Number(runtime?.state?.maxStoredGold) || Infinity);
        label.setText(formatCoins(stored));
        label.setFontFamily("'Press Start 2P', monospace");
        label.setFontSize(10);
        label.setFontStyle("normal");
        label.setStroke("#000000", 0);
        label.setColor(full ? "#fff3b0" : stored > 0 ? "#ffd264" : "#8a6a34");
        label.setAlign("center");
        label.setResolution(3);
        label.setPosition(
          (mineFrames.plateX - 0.5) * mineFrames.frameWidth,
          (mineFrames.plateY - 0.5) * mineFrames.frameHeight,
        );
      } else if (entry.type === "claimableTurret") {
        const ownerTeam = runtime?.state?.claimedByTeam || null;
        // Nothing written over it: the empty mount and the claimed gun look
        // different, and walking up to it brings up the buy prompt.
        label.setText("");
        const mountFrames = PROP_FRAMES["turret-mount"];
        const gunFrames = PROP_FRAMES["turret-gun"];
        const turretBase = ensurePropSprite(
          turretBaseSprites,
          entry.id,
          teamTexture("bank-bust-turret-mount", ownerTeam),
          mountFrames,
          RENDER_LAYERS.GAME_OBJECTS,
        );
        const turretHead = ensurePropSprite(
          turretHeadSprites,
          entry.id,
          teamTexture("bank-bust-turret-gun", ownerTeam),
          gunFrames,
          RENDER_LAYERS.GAME_OBJECTS + 1,
        );
        if (turretBase) {
          turretBase.setVisible(true);
          turretBase.setPosition(
            container.x,
            container.y + TURRET_RENDER_Y_OFFSET,
          );
          turretBase.setScale(1);
          turretBase.clearTint();
        }
        if (turretHead && turretBase) {
          turretHead.setVisible(true);
          turretHead.setOrigin(gunFrames.hubX, gunFrames.hubY);
          turretHead.setScale(1);
          turretHead.clearTint();
          animateTurret(entry.id, turretHead, turretBase, entry, runtime, ownerTeam, {
            x: container.x + (mountFrames.socketX - 0.5) * mountFrames.frameWidth,
            y: container.y + TURRET_RENDER_Y_OFFSET + (mountFrames.socketY - 0.5) * mountFrames.frameHeight,
          });
        }
      } else if (entry.type === "wallSlot") {
        const builtByTeam = runtime?.state?.builtByTeam || null;
        const wallWidth = Math.max(10, Number(entry.width) || 48);
        const wallHeight = Math.max(10, Number(entry.height) || 96);
        const tall = wallHeight > 96;
        const wallKey = builtByTeam
          ? teamTexture(tall ? "bank-bust-wall-tall" : "bank-bust-wall-built", builtByTeam)
          : tall ? "bank-bust-wall-tall-slot" : "bank-bust-wall-slot";
        const wallSprite = ensureObjectSprite(
          wallSprites, entry.id, wallKey, RENDER_LAYERS.GAME_OBJECTS,
        );
        if (wallSprite) {
          wallSprite.setVisible(true);
          wallSprite.setTexture(wallKey);
          wallSprite.setPosition(container.x, container.y);
          wallSprite.setScale(1);
          wallSprite.clearTint();
        }
        label.setText("");
        if (builtByTeam === "team1" || builtByTeam === "team2") {
          objectGraphics.lineStyle(
            3,
            builtByTeam === "team1" ? 0x60a5fa : 0xf87171,
            0.9,
          );
          objectGraphics.strokeRoundedRect(
            container.x - wallWidth / 2,
            container.y - wallHeight / 2,
            wallWidth,
            wallHeight,
            4,
          );
        }
        updateWallBody(entry.id, entry, !!builtByTeam, builtByTeam);
      } else {
        label.setText("");
      }
    }
    cleanupUnused(objectContainers, usedObjectIds);
    cleanupUnused(mineSprites, usedObjectIds);
    cleanupUnused(wallSprites, usedObjectIds);
    cleanupUnused(turretBaseSprites, usedObjectIds);
    cleanupUnused(turretHeadSprites, usedObjectIds);

    hideUnusedWallBodies(modeState);
  }

  function hideUnusedWallBodies(modeState) {
    const activeWallIds = new Set(
      (Array.isArray(modeState?.objects) ? modeState.objects : [])
        .filter(
          (entry) => entry?.type === "wallSlot" && entry?.state?.builtByTeam,
        )
        .map((entry) => entry.id),
    );
    for (const id of Array.from(wallBodies.keys())) {
      if (activeWallIds.has(id)) continue;
      updateWallBody(id, null, false);
    }
  }

  // A pickup's point sits this far above the surface under it, up where a
  // fighter's body reaches it. The coin is drawn lower, hovering just off the
  // floor, with its shadow on the floor itself.
  const PICKUP_FLOOR_DROP = 40;
  const PICKUP_HOVER_DROP = 14;

  const HALO_TEXTURE = "bb-coin-spawn-halo";

  function createPickupVisual(pickup) {
    const x = Number(pickup.x) || 0;
    const y = Number(pickup.y) || 0;
    const spilled = pickup.reason === "centerGold";
    const glow = lootFx.glow(x, y, spilled ? 78 : 54, 0xffc34a, 0.3);
    const sprite = scene.add.image(x, y, "coin-spin", 0);
    sprite.setDepth(RENDER_LAYERS.POWERUPS);
    sprite.setScale((spilled ? 1.4 : 1) * COIN_FRAME_SCALE);
    const shadow = scene.add.ellipse(x, y + PICKUP_FLOOR_DROP, 22, 6, 0x000000, 0.3);
    shadow.setDepth(RENDER_LAYERS.POWERUPS - 1);
    // Thrown out of the crate, or dropping in from above.
    const fromX = Number.isFinite(pickup.fromX) ? pickup.fromX : x;
    const fromY = Number.isFinite(pickup.fromY) ? pickup.fromY : y - 90;
    const arrivalMs = Number(pickup.arrivalMs) || PICKUP_ARRIVE_MS;
    // Fraction of the arrival at which the coin first touches the floor.
    const touch = Phaser.Math.Clamp(
      (Number(pickup.claimableMs) || arrivalMs * BOUNCE_FIRST_TOUCH) / arrivalMs,
      0.05, 1,
    );
    const halo = reducedMotion ? null : lootFx.glowImage(HALO_TEXTURE, x, y, 0xffd264);
    halo?.setDisplaySize(spilled ? 56 : 44, spilled ? 120 : 96);
    return {
      sprite, glow, shadow, halo, arrivalMs, touch,
      fromX, fromY,
      arc: Number.isFinite(pickup.fromX) ? 90 : 0,
      bornAt: scene.time.now,
      landed: reducedMotion,
      phase: Math.random() * Math.PI * 2,
      nextGlintAt: scene.time.now + 500 + Math.random() * 1400,
    };
  }

  // Only for a snapshot that does not say; the server sets the real times, and
  // the coin can be collected from its first floor touch.
  const PICKUP_ARRIVE_MS = 1300;
  const BOUNCE_FIRST_TOUCH = 1 / 2.75; // where Bounce.Out first reaches 1
  const HALO_PEAK_ALPHA = 0.6;
  const HALO_RISE = 0.2; // of the arrival, spent brightening
  const HALO_LINGER = 0.3; // of the arrival, spent fading after the coin lands

  function renderPickups(modeState) {
    const used = new Set();
    const nowSec = scene.time.now / 1000;
    for (const pickup of Array.isArray(modeState?.randomGoldPickups)
      ? modeState.randomGoldPickups
      : []) {
      used.add(pickup.id);
      let visual = pickupSprites.get(pickup.id) || null;
      if (!visual?.sprite?.scene) {
        visual = createPickupVisual(pickup);
        pickupSprites.set(pickup.id, visual);
      }
      const x = Number(pickup.x) || 0;
      const y = Number(pickup.y) || 0;
      const bob = reducedMotion ? 0 : Math.sin(nowSec * 2.8 + visual.phase) * 4;
      let drawX = x;
      const restY = y + PICKUP_HOVER_DROP;
      let drawY = restY + bob;
      let spinRate = 6;
      const age = scene.time.now - visual.bornAt;
      if (!visual.landed) {
        const t = Phaser.Math.Clamp(age / visual.arrivalMs, 0, 1);
        // The throw and the first drop end together at the first floor touch,
        // when the server lets the coin be collected; the bounces follow.
        const thrown = Math.min(1, t / visual.touch);
        const eased = t < visual.touch
          ? thrown * BOUNCE_FIRST_TOUCH
          : BOUNCE_FIRST_TOUCH +
            ((t - visual.touch) / (1 - visual.touch || 1)) * (1 - BOUNCE_FIRST_TOUCH);
        const fall = Phaser.Math.Easing.Bounce.Out(eased);
        drawX = Phaser.Math.Linear(visual.fromX, x, thrown);
        drawY = Phaser.Math.Linear(visual.fromY, restY, fall) - Math.sin(thrown * Math.PI) * visual.arc;
        spinRate = 10;
        visual.sprite.setAlpha(Math.min(1, t / 0.15));
        if (t >= 1) {
          visual.landed = true;
          visual.landedAt = scene.time.now;
          coinFx.sparkle(x, y + PICKUP_FLOOR_DROP - 6, { count: 3, radius: 18, scale: 0.8 });
        }
      } else if (visual.landedAt) {
        // The bob eases in from a standstill rather than snapping in.
        drawY = restY + bob * Math.min(1, (scene.time.now - visual.landedAt) / 480);
      }
      visual.sprite.setPosition(drawX, drawY);
      if (!reducedMotion) {
        visual.sprite.setFrame(coinSpinFrame(nowSec * spinRate + visual.phase));
      }
      const pulse = 0.5 + 0.5 * Math.sin(nowSec * 3.5 + visual.phase);
      visual.glow.setPosition(drawX, drawY);
      if (visual.halo) {
        const progress = age / visual.arrivalMs;
        if (progress >= 1 + HALO_LINGER) {
          visual.halo.destroy();
          visual.halo = null;
        } else {
          const brightness = progress < HALO_RISE
            ? progress / HALO_RISE
            : Math.min(1, (1 + HALO_LINGER - progress) / HALO_LINGER);
          // A short column of light on the coin, not a beam from the ceiling.
          visual.halo.setPosition(drawX, drawY - 16);
          visual.halo.setAlpha(HALO_PEAK_ALPHA * brightness);
        }
      }
      visual.glow.setAlpha(0.2 + 0.18 * pulse);
      visual.shadow.setPosition(x, y + PICKUP_FLOOR_DROP);
      visual.shadow.setScale(visual.landed ? 1 - 0.14 * (bob / 4) : 0.6);
      // Now and then, a glint off the edge of the coin.
      if (!reducedMotion && visual.landed && scene.time.now >= visual.nextGlintAt) {
        visual.nextGlintAt = scene.time.now + 900 + Math.random() * 1800;
        coinFx.sparkle(
          drawX + Phaser.Math.Between(-9, 9),
          drawY + Phaser.Math.Between(-9, 9),
          { scale: 0.9, depth: RENDER_LAYERS.POWERUPS + 1 },
        );
      }
    }
    for (const [id, visual] of pickupSprites.entries()) {
      if (used.has(id)) continue;
      destroyPickupVisual(visual);
      pickupSprites.delete(id);
    }
  }

  function destroyPickupVisual(visual) {
    try {
      visual?.sprite?.destroy?.();
      visual?.glow?.destroy?.();
      visual?.shadow?.destroy?.();
      visual?.halo?.destroy?.();
    } catch (_) {}
  }

  const CRATE_DROP_MS = 340;
  const CRATE_DROP_HEIGHT = 620;
  const CRATE_WARNING_MS = 5000;

  function ensureCrate() {
    if (crate?.body?.scene) return crate;
    if (!scene.textures?.exists?.("bank-bust-center-crate-intact")) return null;
    // Pivoting on the base is what makes a blow rock it rather than spin it.
    const body = scene.add.image(-9999, -9999, "bank-bust-center-crate-intact");
    body.setOrigin(0.5, 1);
    body.setDepth(RENDER_LAYERS.GAME_OBJECTS + 1);
    body.setVisible(false);
    const shadow = scene.add.ellipse(-9999, -9999, 132, 16, 0x000000, 0.42);
    shadow.setDepth(RENDER_LAYERS.GAME_OBJECTS);
    shadow.setVisible(false);
    const glow = lootFx.glow(-9999, -9999, 240, 0xffb84a, 0, RENDER_LAYERS.GAME_OBJECTS - 1);
    crate = {
      body, shadow, glow,
      spring: createCrateSpring(),
      stage: null,
      droppedAt: 0,
      landed: false,
      leaving: false,
      lastHitAt: 0,
      flashUntil: 0,
      barHealth: 1,
      nextCreakAt: 0,
    };
    return crate;
  }

  function hideCrate() {
    crate?.body?.setVisible?.(false);
    crate?.shadow?.setVisible?.(false);
    crate?.glow?.setVisible?.(false);
  }

  function crateFloor(site) {
    return Number(site.y) + (Number(site.height) || 116) / 2;
  }

  function isOnCamera(x, y) {
    const view = scene?.cameras?.main?.worldView;
    return !!view && Phaser.Geom.Rectangle.Contains(view, x, y);
  }

  function landCrate(site) {
    const x = Number(site.x);
    const floor = crateFloor(site);
    crate.landed = true;
    kickCrate(crate.spring, Math.random() < 0.5 ? -1 : 1, 0.5);
    crate.spring.squashSpeed -= 5;
    shockRing(x, floor, { radius: 170, color: 0xfff3c4, width: 4, duration: 420 });
    for (const side of [-1, 1]) {
      coinFx.debris(x + side * 58, floor - 4, {
        tint: 0x8d8473, width: 7, height: 7, count: 7,
        speed: [90, 260], spread: 0.9, direction: side < 0 ? -Math.PI * 0.9 : -Math.PI * 0.1,
        life: [0.3, 0.55],
      });
    }
    safePlaySfx("sfx-bankbust-wall-claim", { volume: 0.35 });
    if (!reducedMotion && isOnCamera(x, floor)) {
      try { scene.cameras?.main?.shake?.(170, 0.005); } catch (_) {}
    }
  }

  // A blow on the crate, from the side the snapshot says it came from.
  function hitCrate(site, hit) {
    const x = Number(site.x);
    const floor = crateFloor(site);
    const height = Number(site.height) || 116;
    const side = Math.sign(x - (Number(hit.x) || x)) || (Math.random() < 0.5 ? -1 : 1);
    const maxHealth = Math.max(1, Number(site.maxHealth) || 1);
    // A big hit should look bigger, but a small one still has to register.
    const strength = Phaser.Math.Clamp((Number(hit.damage) || 0) / (maxHealth * 0.16), 0.55, 1.5);
    kickCrate(crate.spring, side, strength);
    crate.flashUntil = scene.time.now + 70;
    const face = x - side * 40;
    const topY = floor - height * 0.72;
    coinFx.debris(face, floor - height * 0.5, {
      tint: 0x7a4a26, width: 7, height: 3, count: 5,
      speed: [140, 320], spread: 1.5,
      direction: side > 0 ? -Math.PI * 0.75 : -Math.PI * 0.25,
      floorY: floor, floorLeft: x - 120, floorRight: x + 120, life: [0.4, 0.7],
    });
    burstCoins(x + Phaser.Math.Between(-30, 30), topY, {
      count: Math.round(2 + 3 * strength),
      speed: [170, 340], spread: 1.5, scale: 0.72,
      floorY: floor - 12, floorLeft: x - 120, floorRight: x + 120,
      life: [0.5, 0.9],
    });
    coinFx.sparkle(face, floor - height * 0.5, { count: 3, radius: 18 });
    safePlaySfx("sfx-coin-pickup", { volume: 0.13, rate: 0.7 + Math.random() * 0.3 });
    safePlaySfx("sfx-bankbust-turret-shoot", { volume: 0.05, rate: 0.6 });
  }

  // The stage it just fell to: a plank goes flying and the pitch of the fight
  // rises, so its condition reads without looking at the bar.
  function crackCrate(site) {
    const x = Number(site.x);
    const floor = crateFloor(site);
    const height = Number(site.height) || 116;
    coinFx.debris(x, floor - height * 0.8, {
      frame: crate.stage === "broken" ? 1 : 0,
      speed: [240, 380], spread: 1.1,
      floorY: floor - 4, floorLeft: x - 120, floorRight: x + 120,
      life: [1, 1.5],
    });
    burstCoins(x, floor - height * 0.75, {
      count: 9, speed: [220, 420], spread: 1.7,
      floorY: floor - 12, floorLeft: x - 120, floorRight: x + 120,
      life: [0.8, 1.2],
    });
    safePlaySfx("sfx-bankbust-mine-collect", { volume: 0.14, rate: 0.8 });
    crate.spring.squashSpeed -= 3;
  }

  function breakCrate(site) {
    const x = Number(site.x);
    const floor = crateFloor(site);
    const height = Number(site.height) || 116;
    const midY = floor - height / 2;
    hideCrate();
    const flash = lootFx.glow(x, midY, 180, 0xfff3c4, 1, RENDER_LAYERS.ATTACKS);
    scene.tweens.add({
      targets: flash, displayWidth: 460, displayHeight: 460, alpha: 0,
      duration: 340, ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });
    shockRing(x, midY, { radius: 260, color: 0xffd264, width: 6, duration: 520 });
    shockRing(x, midY, { radius: 150, color: 0xfff3c4, width: 3, duration: 360 });
    const floorRange = { floorY: floor - 8, floorLeft: x - 120, floorRight: x + 120 };
    // The crate itself: its planks, its brackets and the padlock.
    for (const [frame, count] of [[0, 2], [1, 3], [2, 4], [3, 1]]) {
      coinFx.debris(x, midY, {
        frame, count, speed: [260, 560], spread: Math.PI * 1.15,
        life: [1, 1.6], ...floorRange,
      });
    }
    coinFx.debris(x, midY, {
      tint: 0x7a4a26, width: 8, height: 3, count: 18,
      speed: [200, 560], spread: Math.PI * 1.4, life: [0.5, 1], ...floorRange,
    });
    burstCoins(x, midY, {
      count: 42, speed: [240, 640], spread: Math.PI * 1.25, jitter: 30,
      life: [1, 1.8], ...floorRange,
    });
    coinFx.sparkle(x, midY, { count: 14, radius: 90 });
    coinFx.floatText(x, floor - height - 8, `${formatCoins(Number(site.reward) || 0)}!`, { size: 18 });
    safePlaySfx("sfx-bankbust-wall-claim", { volume: 0.5 });
    safePlaySfx("sfx-bankbust-mine-collect", { volume: 0.3 });
    if (!reducedMotion && isOnCamera(x, midY)) {
      try { scene.cameras?.main?.shake?.(260, 0.008); } catch (_) {}
    }
  }

  // Nobody opened it in time: it flickers and collapses in on itself, with
  // nothing thrown out, so it could not be mistaken for coins worth chasing.
  function retireCrate() {
    if (!crate?.body?.scene) return;
    crate.leaving = true;
    crate.shadow.setVisible(false);
    crate.glow.setVisible(false);
    scene.tweens.add({
      targets: crate.body, scaleY: 0, scaleX: 1.15, alpha: 0.2,
      duration: reducedMotion ? 1 : 300, ease: "Cubic.easeIn",
      onComplete: () => {
        crate.leaving = false;
        hideCrate();
        crate.body.setAlpha(1);
      },
    });
  }

  function renderActiveCrate(site) {
    const entry = ensureCrate();
    if (!entry) return;
    const x = Number(site.x);
    const floor = crateFloor(site);
    const maxHealth = Math.max(1, Number(site.maxHealth) || 1);
    const ratio = Phaser.Math.Clamp((Number(site.health) || 0) / maxHealth, 0, 1);
    const dt = Math.min(0.05, (Number(scene?.game?.loop?.delta) || 16) / 1000);

    const stage = crateStage(ratio);
    if (entry.stage !== stage) {
      const wasStage = entry.stage;
      entry.stage = stage;
      entry.body.setTexture(`bank-bust-center-crate-${stage}`);
      if (wasStage) crackCrate(site);
    }

    const hit = site.lastHit;
    if (hit && Number(hit.at) > entry.lastHitAt) {
      entry.lastHitAt = Number(hit.at);
      hitCrate(site, hit);
    }

    // Close to breaking, it strains on its own and leaks.
    if (!reducedMotion && ratio <= 0.25 && scene.time.now >= entry.nextCreakAt) {
      entry.nextCreakAt = scene.time.now + 520 + Math.random() * 700;
      kickCrate(entry.spring, Math.random() < 0.5 ? -1 : 1, 0.16);
      burstCoins(x + Phaser.Math.Between(-36, 36), floor - 60, {
        count: 1, speed: [60, 130], spread: 1.2, scale: 0.72,
        floorY: floor - 12, floorLeft: x - 120, floorRight: x + 120, life: [0.5, 0.8],
      });
    }

    stepCrateSpring(entry.spring, dt);

    let lift = 0;
    if (!entry.landed) {
      const t = (scene.time.now - entry.droppedAt) / CRATE_DROP_MS;
      if (t >= 1 || reducedMotion) landCrate(site);
      else lift = (1 - t * t) * CRATE_DROP_HEIGHT;
    }
    const { rock, squash } = reducedMotion ? { rock: 0, squash: 0 } : entry.spring;
    const halfWidth = entry.body.width / 2;
    // Tipping about the base would push one corner through the floor, so the
    // crate rides up onto that corner instead.
    const ride = Math.abs(Math.sin(rock)) * halfWidth * 0.75;
    entry.body.setVisible(true);
    entry.body.setPosition(x, floor - lift - ride);
    entry.body.setRotation(rock);
    entry.body.setScale(1 - squash * 0.55, 1 + squash);

    // White for the frame it is struck, then the last few seconds count down.
    const remaining = Number(site.expiresAt || 0) - Date.now();
    if (scene.time.now < entry.flashUntil) {
      entry.body.setTintFill(0xffffff);
    } else if (remaining < CRATE_WARNING_MS && Math.floor(scene.time.now / 130) % 2 === 0) {
      entry.body.setTint(0xff9a8a);
    } else {
      entry.body.clearTint();
    }

    const shadowScale = Phaser.Math.Clamp(1 - lift / CRATE_DROP_HEIGHT, 0.25, 1);
    entry.shadow.setVisible(true);
    entry.shadow.setPosition(x, floor - 3);
    entry.shadow.setScale(shadowScale * (1 + Math.abs(rock) * 0.5), shadowScale);

    const breathe = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(scene.time.now / 420);
    entry.glow.setVisible(entry.landed);
    entry.glow.setPosition(x, floor - 58);
    entry.glow.setAlpha((0.16 + 0.12 * breathe) * (1.6 - ratio * 0.6));

    if (entry.landed) drawCrateHealth(entry, x, floor - (Number(site.height) || 116) - 18, ratio);
  }

  function drawCrateHealth(entry, x, y, ratio) {
    const width = 104;
    const height = 8;
    const left = x - width / 2;
    // The lost chunk lingers for a moment and then drains, so the size of the
    // last hit is readable.
    entry.barHealth = Math.max(ratio, entry.barHealth - 0.6 * ((Number(scene?.game?.loop?.delta) || 16) / 1000));
    uiGraphics.fillStyle(0x0b1220, 0.9);
    uiGraphics.fillRect(left - 3, y - 3, width + 6, height + 6);
    uiGraphics.fillStyle(0x1f2937, 1);
    uiGraphics.fillRect(left, y, width, height);
    uiGraphics.fillStyle(0xfff1b8, 1);
    uiGraphics.fillRect(left, y, width * entry.barHealth, height);
    uiGraphics.fillStyle(0xf59e0b, 1);
    uiGraphics.fillRect(left, y, width * ratio, height);
    uiGraphics.fillStyle(0xfde68a, 1);
    uiGraphics.fillRect(left, y, width * ratio, 2);
  }

  // Square brackets on the hilltop: where the next crate lands.
  function drawCrateSite(x, floor, size, alpha, color = 0xfacc15) {
    const half = size / 2;
    const tick = 14;
    objectGraphics.lineStyle(3, color, alpha);
    for (const sx of [-1, 1]) {
      objectGraphics.beginPath();
      objectGraphics.moveTo(x + sx * (half - tick), floor);
      objectGraphics.lineTo(x + sx * half, floor);
      objectGraphics.lineTo(x + sx * half, floor - tick);
      objectGraphics.strokePath();
    }
  }

  // The contested centre crate. Its site is always marked so both teams know
  // where the fight will be; the crate itself only exists while it is live.
  function renderCenterGold(modeState) {
    const site = modeState?.centerGold;
    if (!site?.enabled) {
      hideCrate();
      return;
    }
    const x = Number(site.x) || 0;
    const floor = crateFloor(site);
    const phase = String(site.phase || "");
    const now = Date.now();
    const wasActive = state.centerGoldPhase === "active";

    if (wasActive && phase !== "active") {
      if (site.lastOutcome === "broken") breakCrate(site);
      else retireCrate();
      if (crate) {
        crate.stage = null;
        crate.landed = false;
      }
    }

    if (phase === "active") {
      if (!wasActive) {
        const entry = ensureCrate();
        if (entry) {
          entry.droppedAt = scene.time.now;
          entry.landed = false;
          entry.leaving = false;
          entry.barHealth = 1;
          entry.spring = createCrateSpring();
          // Its first hit is new; an older round's cannot replay.
          entry.lastHitAt = Number(site.lastHit?.at) || 0;
        }
      }
      renderActiveCrate(site);
    } else if (!crate?.leaving) {
      hideCrate();
    }

    if (phase === "announced") {
      // Counting down: the brackets close on the landing spot, and a shadow
      // grows under a crate that has not arrived yet.
      const total = Math.max(1, Number(site.spawnAt || 0) - Number(site.announceAt || 0));
      const progress = Phaser.Math.Clamp(1 - (Number(site.spawnAt || 0) - now) / total, 0, 1);
      const pulse = reducedMotion ? 1 : 0.6 + 0.4 * Math.abs(Math.sin(scene.time.now / 180));
      drawCrateSite(x, floor, 260 - 120 * progress, (0.45 + 0.5 * progress) * pulse, 0xfde68a);
      objectGraphics.fillStyle(0x000000, 0.1 + 0.25 * progress);
      objectGraphics.fillEllipse(x, floor - 3, 40 + 90 * progress, 6 + 8 * progress);
      if (state.centerGoldPhase !== "announced") {
        safePlaySfx("sfx-bankbust-mine-claim", { volume: 0.4 });
      }
    } else if (phase !== "active" && phase !== "done") {
      drawCrateSite(x, floor, 140, 0.28);
    }

    state.centerGoldPhase = phase;
  }

  // A turret firing: a flash down the barrel and a coin thrown out of the
  // breech. The gun is bolted to a bank, so it spits coins for casings.
  function playTurretMuzzle(shot) {
    if (reducedMotion) return;
    const x = Number(shot?.x) || 0;
    const y = Number(shot?.y) || 0;
    const angle = Number(shot?.angle) || 0;
    const team = shot?.ownerTeam;
    const colour = team === "team2" ? 0xffb4b4 : team === "team1" ? 0xbfdcff : 0xffd264;

    const flash = scene.add.circle(x, y, 16, colour, 0.85);
    flash.setBlendMode(Phaser.BlendModes.ADD);
    flash.setDepth(RENDER_LAYERS.ATTACKS);
    scene.tweens.add({
      targets: flash, radius: 30, alpha: 0, duration: 130, ease: "Quad.easeOut",
      onComplete: () => { try { flash.destroy(); } catch (_) {} },
    });
    // Sparks along the line of fire.
    const spark = scene.add.rectangle(x, y, 34, 5, 0xfff3c4, 0.9);
    spark.setRotation(angle);
    spark.setBlendMode(Phaser.BlendModes.ADD);
    spark.setDepth(RENDER_LAYERS.ATTACKS);
    scene.tweens.add({
      targets: spark, scaleX: 1.9, alpha: 0, duration: 110, ease: "Quad.easeOut",
      onComplete: () => { try { spark.destroy(); } catch (_) {} },
    });
    // Casings out of the back of the gun, a couple per shot.
    burstCoins(x, y, {
      count: 2,
      speed: [70, 150],
      spread: 0.7,
      direction: angle + Math.PI * 0.75,
      scale: 0.6,
      life: [380, 620],
    });
  }

  function renderTurretProjectiles(modeState) {
    const activeIds = new Set();
    const now = Date.now();
    const dtMs = Math.max(
      1,
      Math.min(50, Number(scene?.game?.loop?.delta) || 16),
    );
    const dtSec = dtMs / 1000;
    const mapColliders = Array.isArray(getMapObjects?.())
      ? getMapObjects()
      : [];
    for (const shot of Array.isArray(modeState?.turretProjectiles)
      ? modeState.turretProjectiles
      : []) {
      activeIds.add(shot.id);
      if (turretProjectileLocallyDestroyed.has(shot.id)) continue;
      const sprite = ensureObjectSprite(
        turretProjectileSprites,
        shot.id,
        "bank-bust-bullet",
        RENDER_LAYERS.ATTACKS,
      );
      if (!sprite) continue;
      const ownerTeam = shot?.ownerTeam || null;
      sprite.setVisible(true);
      const serverX = Number(shot?.x) || 0;
      const serverY = Number(shot?.y) || 0;
      const serverVx = Number(shot?.vx) || 0;
      const serverVy = Number(shot?.vy) || 0;
      const targetAngle = Number(shot?.angle) || 0;
      sprite.setDisplaySize(22, 14);
      if (!turretProjectileVisualState.has(shot.id)) {
        turretProjectileVisualState.set(shot.id, {
          x: serverX,
          y: serverY,
          vx: serverVx,
          vy: serverVy,
          lastServerX: serverX,
          lastServerY: serverY,
          bornAt: now,
          rotation: targetAngle,
        });
      }

      const visual = turretProjectileVisualState.get(shot.id);
      if (visual) {
        // Client-side ballistic sim: use authoritative velocity and only softly correct drift.
        visual.vx = Phaser.Math.Linear(visual.vx, serverVx, 0.2);
        visual.vy = Phaser.Math.Linear(visual.vy, serverVy, 0.2);
        visual.x += visual.vx * dtSec;
        visual.y += visual.vy * dtSec;
        visual.x = Phaser.Math.Linear(visual.x, serverX, 0.08);
        visual.y = Phaser.Math.Linear(visual.y, serverY, 0.08);
        visual.rotation = Phaser.Math.Angle.RotateTo(
          visual.rotation,
          targetAngle,
          0.6,
        );
        sprite.setPosition(visual.x, visual.y);
        sprite.setRotation(visual.rotation);

        let hitBarrier = false;
        for (const mapObject of mapColliders) {
          if (!mapObject?.body) continue;
          if (scene.physics.overlap(sprite, mapObject)) {
            hitBarrier = true;
            break;
          }
        }
        if (!hitBarrier) {
          for (const wall of wallBodies.values()) {
            const zone = wall?.zone;
            if (!zone?.body) continue;
            if (scene.physics.overlap(sprite, zone)) {
              hitBarrier = true;
              break;
            }
          }
        }
        if (hitBarrier) {
          turretProjectileLocallyDestroyed.add(shot.id);
          sprite.setVisible(false);
          continue;
        }
      } else {
        sprite.setPosition(serverX, serverY);
        sprite.setRotation(targetAngle);
      }
      sprite.clearTint();
      if (ownerTeam === "team1") sprite.setTint(0x93c5fd);
      if (ownerTeam === "team2") sprite.setTint(0xfca5a5);
    }
    for (const [id, sprite] of turretProjectileSprites.entries()) {
      if (activeIds.has(id)) continue;
      sprite.destroy();
      turretProjectileSprites.delete(id);
      turretProjectileVisualState.delete(id);
      turretProjectileLocallyDestroyed.delete(id);
    }
  }

  function processModeEvents(modeState) {
    // One ledger drives every piece of coin feedback, so a gain and a loss are
    // always shown the same way whatever caused them.
    for (const event of Array.isArray(modeState?.coinEvents)
      ? modeState.coinEvents
      : []) {
      const at = Number(event?.at) || 0;
      if (!at || at < state.lastCoinEventAt) continue;
      if (at > state.lastCoinEventAt) {
        state.lastCoinEventAt = at;
        state.coinEventsAtLast.clear();
      }
      const eventKey = `${event?.team}:${event?.coins}`;
      if (state.coinEventsAtLast.has(eventKey)) continue;
      state.coinEventsAtLast.add(eventKey);
      const team = event?.team;
      if (team !== "team1" && team !== "team2") continue;
      const delta = Number(event?.delta) || 0;
      const eventVault = getLayoutVault(team, modeState?.vaults?.[team]);
      if (delta > 0) vaultFx.deposit(team, eventVault);
      const from =
        Number.isFinite(Number(event?.x)) && Number.isFinite(Number(event?.y))
          ? { x: Number(event.x), y: Number(event.y) }
          : getPlayerPositionByName(event?.actor) ||
            getObjectPositionById(event?.source);

      switch (String(event?.reason)) {
        case "pickup":
          safePlaySfx("sfx-coin-pickup", { volume: 0.14 });
          if (from) flyCoinsToVault({ ...from, team, amount: delta });
          break;
        case "mine":
          safePlaySfx("sfx-bankbust-mine-collect", { volume: 0.15 });
          if (event?.source) state.mineOwnerById.set(event.source, team);
          if (from) flyCoinsToVault({ ...from, team, amount: delta });
          break;
        case "deathDrop":
          safePlaySfx("sfx-coin-pickup", { volume: 0.12 });
          if (from) flyCoinsToVault({ ...from, team, amount: delta });
          break;
        case "centerGold":
          safePlaySfx("sfx-bankbust-mine-collect", { volume: 0.22 });
          if (from) flyCoinsToVault({ ...from, team, amount: delta, big: true });
          break;
        case "enemyAttack":
          vaultFx.hit(team, eventVault, -delta, getPlayerPositionByName(event?.actor));
          break;
        case "purchase-turret":
        case "purchase-wall":
          // Spending shows the coins leaving the vault for the thing bought,
          // so the cost is felt in the same currency as the damage.
          if (from) flyCoinsFromVault({ ...from, team, amount: -delta });
          break;
        default:
          break;
      }
    }

    const nextStates = new Map();
    for (const entry of Array.isArray(modeState?.objects)
      ? modeState.objects
      : []) {
      const prev = state.previousObjectStates.get(entry.id) || {};
      const cur = entry?.state || {};
      if (
        entry?.type === "claimableTurret" &&
        !prev?.claimedByTeam &&
        cur?.claimedByTeam
      ) {
        safePlaySfx("sfx-bankbust-turret-claim", { volume: 0.35 });
      }
      if (
        entry?.type === "wallSlot" &&
        !prev?.builtByTeam &&
        cur?.builtByTeam
      ) {
        safePlaySfx("sfx-bankbust-wall-claim", { volume: 0.35 });
      }
      nextStates.set(entry.id, cloneJson(cur) || {});
    }
    state.previousObjectStates = nextStates;

    const nextProjectileIds = new Set(
      (Array.isArray(modeState?.turretProjectiles)
        ? modeState.turretProjectiles
        : []
      ).map((entry) => entry.id),
    );
    for (const shot of Array.isArray(modeState?.turretProjectiles)
      ? modeState.turretProjectiles
      : []) {
      if (state.recentProjectileIds.has(shot.id)) continue;
      safePlaySfx("sfx-bankbust-turret-shoot", { volume: 0.16 });
      playTurretMuzzle(shot);
    }
    state.recentProjectileIds = nextProjectileIds;
  }

  function render() {
    objectiveGraphics.clear();
    uiGraphics.clear();
    objectGraphics.clear();

    const modeState = getModeState?.() || null;
    if (modeState?.type !== "bank-bust") {
      setPrompt("");
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
      for (const sprite of turretProjectileSprites.values())
        sprite.setVisible(false);
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
    vaultFx.destroy();
    try {
      objectiveGraphics.destroy();
      uiGraphics.destroy();
      objectGraphics.destroy();
    } catch (_) {}
    for (const entry of vaultSprites.values()) {
      destroyContainer(entry?.body);
      destroyContainer(entry?.accent);
    }
    for (const glow of vaultGlows.values()) {
      destroyContainer(glow?.halo);
      destroyContainer(glow?.core);
    }
    for (const label of vaultCoinLabels.values()) destroyContainer(label);
    destroyContainer(crate?.body);
    destroyContainer(crate?.shadow);
    destroyContainer(crate?.glow);
    crate = null;
    for (const visual of pickupSprites.values()) destroyPickupVisual(visual);
    for (const entry of objectContainers.values()) destroyContainer(entry);
    for (const sprite of turretBaseSprites.values()) destroyContainer(sprite);
    for (const sprite of turretHeadSprites.values()) destroyContainer(sprite);
    turretMotion.clear();
    for (const sprite of mineSprites.values()) destroyContainer(sprite);
    for (const sprite of wallSprites.values()) destroyContainer(sprite);
    for (const sprite of turretProjectileSprites.values())
      destroyContainer(sprite);
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

  return {
    render,
    destroy,
  };
}
