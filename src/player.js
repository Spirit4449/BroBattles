// player.js
// NOTE: Refactored to remove circular dependency on game.js.
// socket now comes from standalone socket.js and opponentPlayers are passed into createPlayer.
import socket from "./socket";
function pdbg() {
  /* logging disabled */
}
import {
  createFor as createCharacterFor,
  getTextureKey,
  getCharacterClassByKey,
  resolveAnimKey,
  getStats,
  getEffectsClass,
} from "./characters";
import {
  spawnDust,
  spawnHealthMarker,
  spawnSpawnBurst,
  spawnWallKickCloud,
} from "./effects";
import { bindLocalSocketEvents } from "./players/localSocketEvents";
import { createLocalStateSync } from "./players/localStateSync";
import {
  ATTACK_AIM_HOLD_ACTIVATE_MS,
  ATTACK_AIM_DRAG_ACTIVATE_PX,
  getPlayerAimBasePoint,
  resolveAttackAimContext,
} from "./characters/shared/attackAim";
import { getResolvedCharacterBodyConfig } from "./lib/characterTuning.js";
import { createAttackAimReticleController } from "./gameScene/attackAimReticle";
import { createMobileControlsController } from "./gameScene/mobileControls";
import MOVEMENT_PHYSICS from "./shared/movementPhysics.json";
import { noteClientActionSent } from "./lib/netTestLogger.js";
// Globals
let player;
let cursors;
let keySpace; // Spacebar for jump
let keyJ; // J for basic attack
let canWallJump = true;
let isMoving = false;
let isJumping = false;
let isAttacking = false;
let canAttack = true;
// SFX state
let sfxWalkCooldown = 0;
let wasOnGround = false;
let wallSlideLoopSfx = null;
let wallSlideLoopPlaying = false;

let frame;

let maxHealth = 8000;
let currentHealth = 8000; // Client-side copy (display only)
let dead = false;

let healthBarWidth = 60;
let healthBar;
let healthText;
// Ammo/Cooldown bar (client-side only)
let ammoBar; // graphics
let ammoBarBack; // background graphics
let ammoBarWidth = 60;
let ammoCooldownMs = 1200; // time between shots
let ammoReloadMs = 1200; // time to reload one charge
let ammoCapacity = 1; // number of segments
let ammoCharges = 1; // current charges available
let nextFireTime = 0; // timestamp (ms) when we can fire again
let reloadTimerMs = 0; // accumulates while reloading toward ammoReloadMs
let ammoBarShakeUntil = 0;
let lastNoAmmoSfxAt = 0;

let superBar;
let superBarBack;
let superCharge = 0;
let maxSuperCharge = 100;
let keyI;
let keyE;
let _specialNotReadyFlash = 0; // timestamp until "not ready" red flash expires
let movementSpeedMult = 1;
let movementJumpMult = 1;

let playerName;

let indicatorTriangle;

let username;
let gameId = window.location.pathname.split("/").filter(Boolean).pop();

let scene;
// Persist the selected character so movement helpers can resolve anim keys
let currentCharacter;

let spawn;
let playersInTeam;
let spawnPlatform;
let mapObjects;
let map;
let opponentPlayersRef; // injected from game.js to avoid circular import
let dustTimer = 0;
const dustInterval = 70; // ms between dust puffs when running

// Body config and flip-offset applier hoisted for use across functions
let bodyConfig = null;
let applyFlipOffsetLocal = null;
let charEffects = null; // per-character, per-player effects handler (e.g., Draven fire)
let charCtrl = null; // active character controller instance
let disposeLocalSocketEvents = null;
let flushLocalNetState = null;
let attackAimReticleController = null;
let pointerAttackHandlers = null;
let pointerAttackScene = null;
let pointerContextMenuCanvas = null;
let pointerContextMenuHandler = null;
let mobileControlsController = null;

const GAME_CROSSHAIR_CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5.1" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.94)" stroke-width="1.4"/><circle cx="12" cy="12" r="1.45" fill="rgba(255,255,255,0.97)"/><path d="M12 1.7v4.25M12 18.05v4.25M1.7 12h4.25M18.05 12h4.25" stroke="rgba(32,32,32,0.55)" stroke-width="3.4" stroke-linecap="round"/><path d="M12 1.7v4.25M12 18.05v4.25M1.7 12h4.25M18.05 12h4.25" stroke="rgba(255,255,255,0.97)" stroke-width="1.55" stroke-linecap="round"/></svg>`;
const GAME_CROSSHAIR_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  GAME_CROSSHAIR_CURSOR_SVG,
)}") 12 12, crosshair`;

const attackAimState = {
  active: false,
  pointerId: null,
  startedAt: 0,
  aiming: false,
  family: "basic",
  button: 0,
  startWorldX: 0,
  startWorldY: 0,
  pointerWorldX: 0,
  pointerWorldY: 0,
  relativePointerX: 0,
  relativePointerY: 0,
  pointerDirty: false,
  currentContext: null,
};

let networkInputState = {
  left: false,
  right: false,
  direction: 0,
  jumpHeld: false,
  jumpPressed: false,
  grounded: false,
  vx: 0,
  vy: 0,
  facing: 1,
  animation: null,
  movementLocked: false,
  loaded: false,
};
let chatInputActive = false;
let localMovementReconcileState = {
  lastAckSeq: -1,
  lastAckAt: 0,
};

const localStateSync = createLocalStateSync({
  Phaser,
  getPlayer: () => player,
  getDead: () => dead,
  setDead: (value) => {
    dead = value;
  },
  getMaxHealth: () => maxHealth,
  setMaxHealth: (value) => {
    maxHealth = value;
  },
  getCurrentHealth: () => currentHealth,
  setCurrentHealth: (value) => {
    currentHealth = value;
  },
  getSuperCharge: () => superCharge,
  setSuperCharge: (value) => {
    superCharge = value;
  },
  getMaxSuperCharge: () => maxSuperCharge,
  setMaxSuperCharge: (value) => {
    maxSuperCharge = value;
  },
  getAmmoCapacity: () => ammoCapacity,
  setAmmoCapacity: (value) => {
    ammoCapacity = value;
  },
  getAmmoCharges: () => ammoCharges,
  setAmmoCharges: (value) => {
    ammoCharges = value;
  },
  getAmmoCooldownMs: () => ammoCooldownMs,
  setAmmoCooldownMs: (value) => {
    ammoCooldownMs = value;
  },
  getAmmoReloadMs: () => ammoReloadMs,
  setAmmoReloadMs: (value) => {
    ammoReloadMs = value;
  },
  getReloadTimerMs: () => reloadTimerMs,
  setReloadTimerMs: (value) => {
    reloadTimerMs = value;
  },
  getNextFireTime: () => nextFireTime,
  setNextFireTime: (value) => {
    nextFireTime = value;
  },
  setMovementSpeedMult: (value) => {
    movementSpeedMult = value;
  },
  setMovementJumpMult: (value) => {
    movementJumpMult = value;
  },
  updateHealthBar: () => updateHealthBar(),
});

function clearAttackAimReticle() {
  try {
    attackAimReticleController?.hide?.();
  } catch (_) {}
}

function resetPointerAttackAim() {
  attackAimState.active = false;
  attackAimState.pointerId = null;
  attackAimState.startedAt = 0;
  attackAimState.aiming = false;
  attackAimState.family = "basic";
  attackAimState.button = 0;
  attackAimState.startWorldX = 0;
  attackAimState.startWorldY = 0;
  attackAimState.pointerWorldX = 0;
  attackAimState.pointerWorldY = 0;
  attackAimState.relativePointerX = 0;
  attackAimState.relativePointerY = 0;
  attackAimState.pointerDirty = false;
  attackAimState.currentContext = null;
  clearAttackAimReticle();
}

function applyGameCursor(nextScene) {
  try {
    const canvas = nextScene?.game?.canvas;
    if (canvas?.style) {
      canvas.style.cursor = GAME_CROSSHAIR_CURSOR;
    }
  } catch (_) {}
}

function clearGameCursor(targetScene = pointerAttackScene || scene) {
  try {
    const canvas = targetScene?.game?.canvas;
    if (canvas?.style) {
      canvas.style.cursor = "";
    }
  } catch (_) {}
}

function detachPointerAttackBindings(
  targetScene = pointerAttackScene || scene,
) {
  const sceneToDetach = targetScene || pointerAttackScene || scene;
  if (!sceneToDetach) return;
  const isTrackedScene =
    !pointerAttackScene || pointerAttackScene === sceneToDetach;
  clearGameCursor(sceneToDetach);
  if (!isTrackedScene) return;
  try {
    if (pointerAttackHandlers?.down) {
      sceneToDetach?.input?.off?.("pointerdown", pointerAttackHandlers.down);
    }
    if (pointerAttackHandlers?.move) {
      sceneToDetach?.input?.off?.("pointermove", pointerAttackHandlers.move);
    }
    if (pointerAttackHandlers?.up) {
      sceneToDetach?.input?.off?.("pointerup", pointerAttackHandlers.up);
      sceneToDetach?.input?.off?.("pointerupoutside", pointerAttackHandlers.up);
    }
    if (pointerAttackHandlers?.gameout) {
      sceneToDetach?.input?.off?.("gameout", pointerAttackHandlers.gameout);
    }
  } catch (_) {}
  try {
    pointerContextMenuCanvas?.removeEventListener?.(
      "contextmenu",
      pointerContextMenuHandler,
    );
  } catch (_) {}
  pointerAttackHandlers = null;
  pointerAttackScene = null;
  pointerContextMenuCanvas = null;
  pointerContextMenuHandler = null;
}

function resolveQuickAttackContext(family = "basic") {
  return resolveAttackAimContext({
    character: currentCharacter,
    player,
    family,
    quick: true,
  });
}

function resolvePointerReleaseContext(family = "basic") {
  return resolveAttackAimContext({
    character: currentCharacter,
    player,
    family,
    pointerWorldX: Number(attackAimState.pointerWorldX),
    pointerWorldY: Number(attackAimState.pointerWorldY),
    quick: true,
    quickUsesPointerAngle: true,
  });
}

function getAimBasePoint(family = attackAimState.family || "basic") {
  return (
    getPlayerAimBasePoint({
      character: currentCharacter,
      player,
      family,
    }) || { baseX: Number(player?.x) || 0, baseY: Number(player?.y) || 0 }
  );
}

function syncPointerAttackRelativeOffset(
  family = attackAimState.family || "basic",
) {
  const base = getAimBasePoint(family);
  const pointerX = Number(attackAimState.pointerWorldX);
  const pointerY = Number(attackAimState.pointerWorldY);
  if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return;
  attackAimState.relativePointerX = pointerX - Number(base.baseX || 0);
  attackAimState.relativePointerY = pointerY - Number(base.baseY || 0);
}

function buildStickyAimPointerWorld() {
  const base = getAimBasePoint();
  return {
    x: Number(base.baseX || 0) + Number(attackAimState.relativePointerX || 0),
    y: Number(base.baseY || 0) + Number(attackAimState.relativePointerY || 0),
  };
}

function resolveActiveAimContext(forceQuick = false) {
  if (!player) return null;
  if (forceQuick || !attackAimState.aiming) {
    return resolveQuickAttackContext(attackAimState.family || "basic");
  }
  const pointerTarget = attackAimState.pointerDirty
    ? {
        x: Number(attackAimState.pointerWorldX),
        y: Number(attackAimState.pointerWorldY),
      }
    : buildStickyAimPointerWorld();
  return resolveAttackAimContext({
    character: currentCharacter,
    player,
    family: attackAimState.family || "basic",
    pointerWorldX: Number(pointerTarget?.x),
    pointerWorldY: Number(pointerTarget?.y),
    quick: false,
  });
}

function serializeAimContext(context) {
  if (!context || typeof context !== "object") return null;
  const out = {
    family: String(context.family || "basic").toLowerCase(),
    kind: String(context.kind || "line").toLowerCase(),
    direction: Number(context.direction) === -1 ? -1 : 1,
  };
  if (Number.isFinite(Number(context.angle))) out.angle = Number(context.angle);
  if (Number.isFinite(Number(context.range))) out.range = Number(context.range);
  if (Number.isFinite(Number(context.speedScale))) {
    out.speedScale = Number(context.speedScale);
  }
  if (
    Number.isFinite(Number(context.targetX)) &&
    Number.isFinite(Number(context.targetY))
  ) {
    out.target = {
      x: Number(context.targetX),
      y: Number(context.targetY),
    };
  }
  if (Number.isFinite(Number(context.coneRadius))) {
    out.coneRadius = Number(context.coneRadius);
  }
  if (Number.isFinite(Number(context.coneSpreadDeg))) {
    out.coneSpreadDeg = Number(context.coneSpreadDeg);
  }
  if (Number.isFinite(Number(context.coneInnerRadius))) {
    out.coneInnerRadius = Number(context.coneInnerRadius);
  }
  if (Number.isFinite(Number(context.roundRadius))) {
    out.roundRadius = Number(context.roundRadius);
  }
  return out;
}

function updatePointerAttackAimPointer(pointer = null) {
  if (!attackAimState.active || !scene?.cameras?.main) return;
  const livePointer =
    pointer ||
    scene?.input?.activePointer ||
    scene?.input?.mousePointer ||
    null;
  if (!livePointer) return;
  try {
    livePointer.updateWorldPoint?.(scene.cameras.main);
  } catch (_) {}
  const nextX = Number(livePointer.worldX);
  const nextY = Number(livePointer.worldY);
  if (Number.isFinite(nextX)) {
    attackAimState.pointerWorldX = nextX;
  }
  if (Number.isFinite(nextY)) {
    attackAimState.pointerWorldY = nextY;
  }
  syncPointerAttackRelativeOffset();
  attackAimState.pointerDirty = true;
}

function startPointerAttackAim(pointer, family = "basic", button = 0) {
  if (!pointer || dead) return;
  resetPointerAttackAim();
  attackAimState.active = true;
  attackAimState.family = family;
  attackAimState.button = button;
  attackAimState.pointerId = pointer.id;
  attackAimState.startedAt = Date.now();
  updatePointerAttackAimPointer(pointer);
  attackAimState.startWorldX = attackAimState.pointerWorldX;
  attackAimState.startWorldY = attackAimState.pointerWorldY;
}

function updatePointerAttackAimState() {
  if (!attackAimState.active) {
    clearAttackAimReticle();
    return;
  }
  if (!player || dead || window.__BB_MAP_EDIT_ACTIVE) {
    resetPointerAttackAim();
    return;
  }
  const elapsed = Math.max(0, Date.now() - attackAimState.startedAt);
  const dragDist = Math.hypot(
    attackAimState.pointerWorldX - attackAimState.startWorldX,
    attackAimState.pointerWorldY - attackAimState.startWorldY,
  );
  if (
    !attackAimState.aiming &&
    (elapsed >= ATTACK_AIM_HOLD_ACTIVATE_MS ||
      dragDist >= ATTACK_AIM_DRAG_ACTIVATE_PX)
  ) {
    attackAimState.aiming = true;
  }
  if (!attackAimState.aiming) {
    attackAimState.currentContext = null;
    clearAttackAimReticle();
    return;
  }

  attackAimState.currentContext = resolveActiveAimContext(false);
  attackAimState.pointerDirty = false;
  try {
    attackAimReticleController?.update?.(attackAimState.currentContext);
  } catch (_) {}
}

function finishPointerAttackAim(pointer) {
  if (!attackAimState.active) return null;
  if (
    attackAimState.pointerId !== null &&
    pointer &&
    pointer.id !== attackAimState.pointerId
  ) {
    return null;
  }
  updatePointerAttackAimPointer(pointer);
  const elapsed = Math.max(0, Date.now() - attackAimState.startedAt);
  const dragDist = Math.hypot(
    attackAimState.pointerWorldX - attackAimState.startWorldX,
    attackAimState.pointerWorldY - attackAimState.startWorldY,
  );
  if (
    !attackAimState.aiming &&
    (elapsed >= ATTACK_AIM_HOLD_ACTIVATE_MS ||
      dragDist >= ATTACK_AIM_DRAG_ACTIVATE_PX)
  ) {
    attackAimState.aiming = true;
  }
  const context = attackAimState.aiming
    ? resolveAttackAimContext({
        character: currentCharacter,
        player,
        family: attackAimState.family || "basic",
        pointerWorldX: Number(attackAimState.pointerWorldX),
        pointerWorldY: Number(attackAimState.pointerWorldY),
        quick: false,
      })
    : resolvePointerReleaseContext(attackAimState.family || "basic");
  if (context && typeof context === "object") {
    context.family = attackAimState.family || context.family || "basic";
  }
  resetPointerAttackAim();
  return context;
}

// Create player function
export function createPlayer(
  sceneParam,
  name,
  character,
  spawnPlatformParam,
  spawnParam,
  playersInTeamParam,
  mapParam,
  opponentPlayersParam,
) {
  resetPointerAttackAim();
  detachPointerAttackBindings();
  mobileControlsController?.destroy?.();
  if (attackAimReticleController) {
    try {
      attackAimReticleController.destroy();
    } catch (_) {}
    attackAimReticleController = null;
  }
  attackAimReticleController = createAttackAimReticleController(sceneParam);
  if (!mobileControlsController) {
    mobileControlsController = createMobileControlsController({
      Phaser,
      getScene: () => scene,
      getPlayer: () => player,
      getPointerAimActive: () => !!attackAimState.active,
      getAimBasePoint: (family = "basic") =>
        getPlayerAimBasePoint({
          character: currentCharacter,
          player,
          family,
        }),
      resolveAimContext: ({ family, pointerWorldX, pointerWorldY, quick }) =>
        resolveAttackAimContext({
          character: currentCharacter,
          player,
          family,
          pointerWorldX,
          pointerWorldY,
          quick,
        }),
      onBasicFire: (context) => fireBasicAttack(context?.direction, context),
      onSpecialFire: (context) => fireSpecialAttack(context),
      onClearReticle: () => clearAttackAimReticle(),
    });
  }
  mobileControlsController.ensure(sceneParam);

  if (disposeLocalSocketEvents) {
    try {
      disposeLocalSocketEvents();
    } catch (_) {}
    disposeLocalSocketEvents = null;
  }

  username = name;
  scene = sceneParam;
  spawn = spawnParam;
  playersInTeam = playersInTeamParam;
  spawnPlatform = spawnPlatformParam;
  map = mapParam;
  opponentPlayersRef = opponentPlayersParam;
  // Remember the chosen character for animation resolution in update loop
  currentCharacter = character;
  pdbg();
  cursors = scene.input.keyboard.createCursorKeys();
  // Bind additional keys once
  try {
    keySpace = scene.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE,
    );
    keyJ = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J);
  } catch (e) {
    // Fallback to string names if KeyCodes not available (shouldn't happen in Phaser 3)
    keySpace = scene.input.keyboard.addKey("SPACE");
    keyJ = scene.input.keyboard.addKey("J");
  }
  try {
    keyI = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.I);
  } catch (e) {
    keyI = scene.input.keyboard.addKey("I");
  }
  try {
    keyE = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
  } catch (e) {
    keyE = scene.input.keyboard.addKey("E");
  }

  try {
    wallSlideLoopSfx = scene.sound?.add("sfx-sliding", {
      loop: true,
      volume: 0.3,
    });
    wallSlideLoopPlaying = false;
  } catch (_) {
    wallSlideLoopSfx = null;
    wallSlideLoopPlaying = false;
  }

  // Animations are registered globally in game.js via setupAll(scene)

  // Create player sprite using the character class factory so each class
  // owns its own texture key without duplicating it here.
  const CharCls = getCharacterClassByKey(character);
  player = CharCls
    ? CharCls.createSprite(scene)
    : scene.physics.add.sprite(-100, -100, getTextureKey(character));
  player.username = username; // Attach username for collision detection
  player.setCollideWorldBounds(true);
  player.anims.play(resolveAnimKey(scene, currentCharacter, "idle"), true); // Play idle animation
  // Hide until we've configured frame/body and spawn to avoid a mid-air first render
  player.setVisible(false);
  localMovementReconcileState = {
    lastAckSeq: -1,
    lastAckAt: performance.now(),
  };
  pdbg();

  // Apply character stats (health, ammo, sprite/body sizing)
  const stats = getStats(character);
  // Prefer server-provided per-match stats when available
  const sessionStats =
    (typeof window !== "undefined" &&
      window.__MATCH_SESSION__ &&
      window.__MATCH_SESSION__.stats) ||
    null;
  if (sessionStats && typeof sessionStats.health === "number") {
    maxHealth = sessionStats.health;
  } else if (typeof stats.baseHealth === "number") {
    maxHealth = stats.baseHealth;
  }
  currentHealth = maxHealth;
  ammoCooldownMs = stats.ammoCooldownMs ?? ammoCooldownMs;
  ammoReloadMs = stats.ammoReloadMs ?? ammoReloadMs;
  ammoCapacity = Math.max(1, stats.ammoCapacity ?? ammoCapacity);
  ammoCharges = ammoCapacity;
  nextFireTime = 0;
  reloadTimerMs = 0;
  if (stats.spriteScale && stats.spriteScale !== 1) {
    player.setScale(stats.spriteScale);
  }

  // Establish frame/body sizing BEFORE computing spawn so height math is correct
  frame = player.frame;
  const bs = getResolvedCharacterBodyConfig(character);
  bodyConfig = bs; // persist for use in movement function
  const widthShrink = bs.widthShrink;
  const heightShrink = bs.heightShrink;
  const bw = Math.max(4, frame.width - widthShrink);
  const bh = Math.max(4, frame.height - heightShrink);
  player.body.setSize(bw, bh);
  // Helper to adjust body offset when flipping
  applyFlipOffsetLocal = () => {
    if (!player || !player.body) return;
    const cfg = bodyConfig || {};
    const flipOffset = cfg.flipOffset || 0; // falsy -> 0
    const extra = player.flipX ? flipOffset : 0;
    const frameW = frame ? frame.width : player.width;
    const bodyW = player.body.width;
    const ox = frameW / 2 - bodyW / 2 + (cfg.offsetXFromHalf ?? 0) + extra;
    const oy = cfg.offsetY;
    player.body.setOffset(ox, oy);
  };
  applyFlipOffsetLocal();

  // Listener to detect if player leaves the world bounds
  scene.events.on("update", () => {
    if (player.y > scene.physics.world.bounds.bottom + 50) {
      setTimeout(() => {
        // Request a suicide if player falls out (treat as self-hit to 99999)
        if (!dead) {
          socket.emit("hit", {
            attacker: username,
            target: username,
            damage: 99999,
            gameId,
          });
          pdbg();
        }
      }, 500);
    }
  });

  // Keep the local player hidden until the scene finishes spawn placement and any
  // reconnect position restore. That removes the first-frame pop from -100,-100.
  player.setVisible(false);

  // Set depth so player renders above all map objects (bank bust graphics are at depths 7-24)
  player.setDepth(25);

  // Player name text anchored to physics body top (not frame height)
  const bodyTop = player.body ? player.body.y : player.y - player.height / 2;
  playerName = scene.add.text(player.x, bodyTop - 40, username);
  playerName.setStyle({
    fontFamily: "LilitaOne-Regular",
    fontSize: "10px",
    fontStyle: "bold",
    fill: "#ffffff",
    stroke: "#000000",
    strokeThickness: 5,
  });
  playerName.setOrigin(0.5, 0);
  playerName.setDepth(42);

  // Health text
  healthText = scene.add.text(0, 0, "", {
    fontFamily: "LilitaOne-Regular",
    fontSize: "10px",
    color: "#FFFFFF", // White
    stroke: "#000000", // Black
    strokeThickness: 4,
  });

  // Health bar
  healthBar = scene.add.graphics();
  // Ammo bar background & fill (render order: background, fill)
  ammoBarBack = scene.add.graphics();
  ammoBar = scene.add.graphics();
  superBarBack = scene.add.graphics();
  superBar = scene.add.graphics();

  // Triangle to show which one is the user. Dissapears when the player moves
  indicatorTriangle = scene.add.graphics();
  setLocalUiVisible(false);

  // Arrow above the body top so it's consistent across different frame paddings
  const triangle = new Phaser.Geom.Triangle(
    player.x,
    bodyTop - 10, // Top point
    player.x - 13,
    bodyTop - 20, // Left point
    player.x + 13,
    bodyTop - 20, // Right point
  );
  indicatorTriangle.fillStyle(0x99ab2c); // Green color
  indicatorTriangle.fillTriangleShape(triangle);
  indicatorTriangle.setVisible(false);

  // Character controller wiring (centralized per character)
  const ammoHooks = {
    // stats
    getAmmoCapacity: () => ammoCapacity,
    getAmmoCooldownMs: () => ammoCooldownMs,
    getAmmoReloadMs: () => ammoReloadMs,
    // state
    getCharges: () => ammoCharges,
    getNextFireTime: () => nextFireTime,
    // actions
    triggerNoAmmoFeedback: (playSound = true) => {
      const now = Date.now();
      ammoBarShakeUntil = now + 180;
      if (!playSound) return;
      if (now - lastNoAmmoSfxAt < 120) return;
      lastNoAmmoSfxAt = now;
      try {
        scene?.sound?.play("sfx-noammo", { volume: 0.2, rate: 1.06 });
      } catch (_) {}
    },
    tryConsume: () => {
      const now = Date.now();
      if (!canAttack) {
        if (ammoCharges <= 0) ammoHooks.triggerNoAmmoFeedback(true);
        else if (now < nextFireTime) ammoHooks.triggerNoAmmoFeedback(false);
        return false;
      }
      if (now < nextFireTime) {
        ammoHooks.triggerNoAmmoFeedback(false);
        return false;
      }
      if (ammoCharges <= 0) {
        ammoHooks.triggerNoAmmoFeedback(true);
        return false;
      }
      ammoCharges -= 1;
      nextFireTime = now + ammoCooldownMs;
      // start/restart reloading if not full
      if (ammoCharges < ammoCapacity && reloadTimerMs <= 0) reloadTimerMs = 0;
      return true;
    },
    grantCharge: (n = 1) => {
      ammoCharges = Math.min(ammoCapacity, ammoCharges + n);
      if (ammoCharges >= ammoCapacity) reloadTimerMs = 0;
      drawAmmoBar();
    },
    setCanAttack: (v) => (canAttack = v),
    setIsAttacking: (v) => (isAttacking = v),
    flushNetState: () => {
      try {
        flushLocalNetState?.({
          dead,
          gameEnded: false,
          handlePlayerMovement,
        });
      } catch (_) {}
    },
    // view
    drawAmmoBar: () => drawAmmoBar(),
  };

  const ctrl = createCharacterFor(character, {
    scene,
    player,
    username,
    gameId,
    opponentPlayersRef,
    mapObjects,
    ammoHooks,
  });
  charCtrl = ctrl;
  if (ctrl && ctrl.attachInput) ctrl.attachInput();

  // Left-click supports quick-fire tap and hold-to-aim.
  // Right-click mirrors that for supers using the special reticle theme.
  const pointerDownHandler = (pointer) => {
    if (window.__BB_MAP_EDIT_ACTIVE) return;
    if (dead) return;
    if (chatInputActive) return;
    if ((player?._movementLockedUntil || 0) > Date.now()) return;
    const mobilePointerHandled =
      !!mobileControlsController?.handlePointerDown?.(pointer);
    if (mobilePointerHandled) return;
    if (
      mobileControlsController?.isEnabled?.() &&
      pointer?.pointerType === "touch"
    )
      return;
    if (pointer.button === 0) {
      startPointerAttackAim(pointer, "basic", 0);
      return;
    }
    if (pointer.button === 2) {
      if (superCharge >= maxSuperCharge) {
        startPointerAttackAim(pointer, "special", 2);
      } else {
        _specialNotReadyFlash = Date.now() + 500;
      }
    }
  };

  const pointerMoveHandler = (pointer) => {
    if (chatInputActive) return;
    const mobilePointerHandled =
      !!mobileControlsController?.handlePointerMove?.(pointer);
    if (mobilePointerHandled) return;
    if (
      mobileControlsController?.isEnabled?.() &&
      pointer?.pointerType === "touch"
    )
      return;
    if (!attackAimState.active) return;
    if (
      attackAimState.pointerId !== null &&
      pointer &&
      pointer.id !== attackAimState.pointerId
    ) {
      return;
    }
    updatePointerAttackAimPointer(pointer);
    updatePointerAttackAimState();
  };

  const pointerUpHandler = (pointer) => {
    if (chatInputActive) return;
    const mobilePointerHandled =
      !!mobileControlsController?.handlePointerUp?.(pointer);
    if (mobilePointerHandled) return;
    if (
      mobileControlsController?.isEnabled?.() &&
      pointer?.pointerType === "touch"
    )
      return;
    const movementLockedNow = (player?._movementLockedUntil || 0) > Date.now();
    const context = finishPointerAttackAim(pointer);
    if (!context || dead || movementLockedNow) return;
    if (String(context.family || "basic").toLowerCase() === "special") {
      fireSpecialAttack(context);
      return;
    }
    fireBasicAttack(context.direction, context);
  };

  const pointerGameOutHandler = () => {
    resetPointerAttackAim();
  };

  pointerAttackHandlers = {
    down: pointerDownHandler,
    move: pointerMoveHandler,
    up: pointerUpHandler,
    gameout: pointerGameOutHandler,
  };
  pointerAttackScene = sceneParam;
  scene.input.on("pointerdown", pointerDownHandler);
  scene.input.on("pointermove", pointerMoveHandler);
  scene.input.on("pointerup", pointerUpHandler);
  scene.input.on("pointerupoutside", pointerUpHandler);
  scene.input.on("gameout", pointerGameOutHandler);
  applyGameCursor(sceneParam);

  pointerContextMenuCanvas = scene.game?.canvas || null;
  pointerContextMenuHandler = (e) => e.preventDefault();
  pointerContextMenuCanvas?.addEventListener?.(
    "contextmenu",
    pointerContextMenuHandler,
  );

  // Per-character effects: instantiate if the character provides an Effects class
  const EffectsCls = getEffectsClass(currentCharacter);
  charEffects = EffectsCls ? new EffectsCls(scene, player) : null;

  disposeLocalSocketEvents = bindLocalSocketEvents({
    socket,
    getUsername: () => username,
    getScene: () => scene,
    getPlayer: () => player,
    getCurrentCharacter: () => currentCharacter,
    getGameId: () => gameId,
    getPlayersInTeam: () => playersInTeam,
    getOpponentPlayersRef: () => opponentPlayersRef,
    resolveAnimKey,
    spawnHealthMarker,
    updateHealthBar,
    getCurrentHealth: () => currentHealth,
    setCurrentHealthValue: (value) => {
      currentHealth = value;
    },
    getMaxHealth: () => maxHealth,
    setMaxHealth: (value) => {
      maxHealth = value;
    },
    getDead: () => dead,
    setDead: (value) => {
      dead = value;
    },
    getSuperCharge: () => superCharge,
    setSuperCharge: (value) => {
      superCharge = value;
    },
    setMaxSuperCharge: (value) => {
      maxSuperCharge = value;
    },
    getWallSlideLoopSfx: () => wallSlideLoopSfx,
    getWallSlideLoopPlaying: () => wallSlideLoopPlaying,
    setWallSlideLoopPlaying: (value) => {
      wallSlideLoopPlaying = value;
    },
    onLocalDeath: () => {
      resetPointerAttackAim();
      updateHealthBar();
      setLocalUiVisible(false);
    },
    onLocalRespawn: () => {
      setLocalUiVisible(true);
      try {
        indicatorTriangle?.setVisible(true);
        drawIndicatorTriangle();
      } catch (_) {}
    },
    removeLocalCorpse: () => {
      try {
        player?.setVisible(false);
      } catch (_) {}
    },
    onDebug: pdbg,
  });

  if (!scene._localSocketEventsCleanupBound) {
    scene._localSocketEventsCleanupBound = true;
    scene.events.once("shutdown", () => {
      if (disposeLocalSocketEvents) {
        try {
          disposeLocalSocketEvents();
        } catch (_) {}
        disposeLocalSocketEvents = null;
      }
      resetPointerAttackAim();
      mobileControlsController?.destroy?.();
      detachPointerAttackBindings(sceneParam);
      clearGameCursor(sceneParam);
      try {
        attackAimReticleController?.destroy?.();
      } catch (_) {}
      attackAimReticleController = null;
      scene._localSocketEventsCleanupBound = false;
    });
    scene.events.once("destroy", () => {
      if (disposeLocalSocketEvents) {
        try {
          disposeLocalSocketEvents();
        } catch (_) {}
        disposeLocalSocketEvents = null;
      }
      resetPointerAttackAim();
      mobileControlsController?.destroy?.();
      detachPointerAttackBindings(sceneParam);
      clearGameCursor(sceneParam);
      try {
        attackAimReticleController?.destroy?.();
      } catch (_) {}
      attackAimReticleController = null;
      scene._localSocketEventsCleanupBound = false;
    });
  }
}

// Function to set health of player from another file
function setCurrentHealth(damage) {
  // Deprecated: server authoritative. Kept for compatibility (no-op display update only)
  currentHealth -= damage;
  if (currentHealth < 0) currentHealth = 0;
  updateHealthBar();
}

function setLocalUiVisible(visible) {
  const shouldShow = visible !== false;
  try {
    playerName?.setVisible(shouldShow);
  } catch (_) {}
  try {
    healthText?.setVisible(shouldShow);
  } catch (_) {}
  try {
    healthBar?.setVisible(shouldShow);
  } catch (_) {}
  try {
    ammoBar?.setVisible(shouldShow);
  } catch (_) {}
  try {
    ammoBarBack?.setVisible(shouldShow);
  } catch (_) {}
  try {
    superBar?.setVisible(shouldShow);
  } catch (_) {}
  try {
    superBarBack?.setVisible(shouldShow);
  } catch (_) {}
  try {
    indicatorTriangle?.setVisible(shouldShow);
    if (!shouldShow) indicatorTriangle?.clear?.();
  } catch (_) {}
  if (!shouldShow) {
    clearAttackAimReticle();
  }
}

function drawIndicatorTriangle() {
  if (!indicatorTriangle || !player) return;
  indicatorTriangle.clear();
  const bodyTop = player.body ? player.body.y : player.y - player.height / 2;
  const triangle = new Phaser.Geom.Triangle(
    player.x,
    bodyTop - 10,
    player.x - 13,
    bodyTop - 20,
    player.x + 13,
    bodyTop - 20,
  );
  indicatorTriangle.fillStyle(0x99ab2c);
  indicatorTriangle.fillTriangleShape(triangle);
}

function syncLocalUiPosition() {
  if (!player) return;
  const uiTop = player.body ? player.body.y : player.y - player.height / 2;
  try {
    playerName?.setPosition(player.x, uiTop - 42);
  } catch (_) {}
  try {
    if (indicatorTriangle?.visible) drawIndicatorTriangle();
  } catch (_) {}
  updateHealthBar();
}

export function finalizeLocalSpawnPresentation() {
  if (!player) return;
  try {
    player.setVisible(true);
  } catch (_) {}
  if (!player._spawnIntroPresented) {
    try {
      spawnSpawnBurst(scene, player, {
        tint: 0xffffff,
        accent: 0xb8ecff,
        depth: 28,
      });
      player._spawnIntroPresented = true;
    } catch (_) {}
  }
  setLocalUiVisible(!dead);
  if (!dead) {
    try {
      indicatorTriangle?.setVisible(true);
      drawIndicatorTriangle();
    } catch (_) {}
  }
  syncLocalUiPosition();
}

function updateHealthBar() {
  if (currentHealth <= 0) currentHealth = 0;
  const healthPercentage = currentHealth / maxHealth;
  const displayedWidth = healthBarWidth * healthPercentage;
  pdbg();

  healthBar.clear(); // Clear the graphics before redrawing

  const healthBarX = player.x - healthBarWidth / 2;
  const bodyTop = player.body ? player.body.y : player.y - player.height / 2;
  // Always anchor to bodyTop so it doesn't jump when dead
  const y = bodyTop - 20; // just above body

  if (!dead) {
    healthText.setText(`${currentHealth}`);
  } else {
    // Show 0 instead of blank when dead
    healthText.setText(`0`);
  }

  // Draw the background rectangle with the default fill color
  healthBar.fillStyle(0x595959);
  healthBar.fillRect(healthBarX, y, healthBarWidth, 9);

  // Draw the health bar background (stroke)
  healthBar.lineStyle(3, 0x000000);
  healthBar.strokeRoundedRect(healthBarX, y, healthBarWidth, 9, 3);

  // Draw the filled part of the health bar (green)
  healthBar.fillStyle(0x99ab2c);
  healthBar.fillRoundedRect(healthBarX, y, displayedWidth, 9, 3);

  healthText.setPosition(player.x - healthText.width / 2, y - 8);
  healthText.setDepth(42);

  // Draw ammo bar underneath health (only for local player & when alive)
  drawAmmoBar(healthBarX, y + 11);
  drawSuperBar(healthBarX, y + 18);
}

function fireBasicAttack(direction, context = null) {
  if (dead) return;
  try {
    if (charCtrl && typeof charCtrl.attack === "function") {
      charCtrl.attack(direction, context);
    } else if (charCtrl && typeof charCtrl.handlePointerDown === "function") {
      charCtrl.handlePointerDown(context);
    }
  } catch (_) {}
}

function fireSpecialAttack(context = null) {
  if (dead) return;
  if (superCharge < maxSuperCharge) {
    _specialNotReadyFlash = Date.now() + 500;
    return;
  }
  try {
    flushLocalNetState?.({
      dead,
      gameEnded: false,
      handlePlayerMovement,
    });
  } catch (_) {}
  if (String(currentCharacter || "").toLowerCase() === "wizard" && player) {
    player._specialAnimLockUntil = Date.now() + 2100;
  }
  noteClientActionSent("special", { type: "special" });
  socket.emit("game:special", {
    aim: serializeAimContext(context),
  });
}

function drawSuperBar(x, y) {
  if (!superBar || !superBarBack) return;
  superBarBack.clear();
  superBar.clear();

  const width = 60;
  const height = 4;

  // Background
  superBarBack.fillStyle(0x222222, 0.65);
  superBarBack.fillRect(x, y, width, height);
  superBarBack.strokeRoundedRect(x, y, width, height, 3);

  // Fill
  const percent =
    maxSuperCharge > 0
      ? Phaser.Math.Clamp(superCharge / maxSuperCharge, 0, 1)
      : 0;
  const isFlashing = Date.now() < _specialNotReadyFlash;
  if (isFlashing && percent < 1) {
    // Red flash when right-clicked while special isn't charged
    const pulse = 0.65 + 0.35 * Math.abs(Math.sin(Date.now() / 75));
    superBar.fillStyle(0xff4444, pulse);
    superBar.fillRect(x, y, width * Math.max(percent, 0.18), height);
  } else if (percent > 0) {
    const isFull = percent >= 1;

    if (isFull) {
      const time = scene.time.now;
      // Cool pulse effect: Gold glow breathing
      const glowAlpha = 0.3 + 0.3 * Math.sin(time / 200);

      // Outer glow
      superBar.fillStyle(0xffd700, glowAlpha);
      superBar.fillRect(x - 2, y - 2, width + 4, height + 4);

      // Main bar solid gold
      superBar.fillStyle(0xffd700, 1);
      superBar.fillRect(x, y, width, height);

      // White rim pulse
      superBar.lineStyle(1, 0xffffff, glowAlpha + 0.2);
      superBar.strokeRect(x, y, width, height);
    } else {
      // Charging yellow
      superBar.fillStyle(0xffff00, 1);
      superBar.fillRect(x, y, width * percent, height);
    }
  }

  superBar.setDepth(41);
  superBarBack.setDepth(40);
}

function drawAmmoBar(forcedX, forcedY) {
  if (!ammoBar || !ammoBarBack) return;
  const shakeX =
    Date.now() < ammoBarShakeUntil ? Phaser.Math.Between(-3, 3) : 0;
  const x =
    (forcedX !== undefined ? forcedX : player.x - ammoBarWidth / 2) + shakeX;
  const bodyTop = player.body ? player.body.y : player.y - player.height / 2;
  const y = forcedY !== undefined ? forcedY : bodyTop - 9; // just under health bar
  ammoBarBack.clear();
  ammoBar.clear();

  // Background
  ammoBarBack.fillStyle(0x222222, 0.65);
  ammoBarBack.fillRoundedRect(x, y, ammoBarWidth, 6, 3);
  ammoBarBack.lineStyle(2, 0x000000, 0.9);
  ammoBarBack.strokeRoundedRect(x, y, ammoBarWidth, 6, 3);

  // Draw segmented charges (like Brawl Stars)
  const gap = 2;
  const segmentWidth = (ammoBarWidth - gap * (ammoCapacity - 1)) / ammoCapacity;
  for (let i = 0; i < ammoCapacity; i++) {
    const segX = x + i * (segmentWidth + gap);
    // Determine fill for this segment
    let percent = 0;
    if (i < ammoCharges) {
      percent = 1; // full charge
    } else if (i === ammoCharges) {
      // currently reloading this segment: percent based on reload progress
      percent = Phaser.Math.Clamp(reloadTimerMs / ammoReloadMs, 0, 1);
    } else {
      percent = 0; // future segments empty
    }
    // Colors
    const emptyColor = 0x333333;
    const readyColor = 0xff4040;
    const chargingColor = 0xb32121;
    const fillColor = percent >= 1 ? readyColor : chargingColor;
    // Fill base (empty)
    ammoBar.fillStyle(emptyColor, 0.5);
    ammoBar.fillRoundedRect(segX, y, segmentWidth, 6, 2);
    // Fill current percent
    if (percent > 0) {
      ammoBar.fillStyle(fillColor, 0.95);
      ammoBar.fillRoundedRect(segX, y, segmentWidth * percent, 6, 2);
    }
  }
  ammoBar.setDepth(41);
  ammoBarBack.setDepth(40);
}

export function handlePlayerMovement(scene) {
  applyGameCursor(scene);
  mobileControlsController?.ensure?.(scene);
  mobileControlsController?.layout?.(scene);
  if (chatInputActive) {
    try {
      if (player?.body) {
        player.setVelocityX(0);
        player.setAccelerationX(0);
        player.setDragX(0);
      }
    } catch (_) {}
    networkInputState = {
      left: false,
      right: false,
      direction: 0,
      jumpHeld: false,
      jumpPressed: false,
      grounded: !!player?.body?.touching?.down,
      vx: Number(player?.body?.velocity?.x) || 0,
      vy: Number(player?.body?.velocity?.y) || 0,
      facing: player?.flipX ? -1 : 1,
      animation: player?.anims?.currentAnim?.key || null,
      movementLocked: true,
      loaded:
        !dead &&
        Number.isFinite(player?.x) &&
        Number.isFinite(player?.y) &&
        player?.visible !== false,
    };
    return;
  }
  // Movement tuning knobs (edit to change the feel):
  // Enforce facing lock (e.g., Draven splash) BEFORE any movement logic mutates flip state
  if (player && player._lockFlip && player._lockedFlipX !== undefined) {
    if (player.flipX !== player._lockedFlipX) {
      player.flipX = player._lockedFlipX;
      if (applyFlipOffsetLocal) applyFlipOffsetLocal();
    }
  }
  // Shared movement constants are mirrored on the server for prediction.
  const maxSpeed =
    MOVEMENT_PHYSICS.maxSpeed *
    Math.max(MOVEMENT_PHYSICS.minSpeedMult, movementSpeedMult || 1);
  const accel = MOVEMENT_PHYSICS.accel;
  const airAccel = MOVEMENT_PHYSICS.airAccel;
  const dragGround = MOVEMENT_PHYSICS.dragGround;
  const dragAir = MOVEMENT_PHYSICS.dragAir;
  let jumpSpeed = MOVEMENT_PHYSICS.jumpSpeed;
  const jumpBoost = MOVEMENT_PHYSICS.jumpBoost;
  const coyoteTimeMs = MOVEMENT_PHYSICS.coyoteTimeMs;
  const wallJumpCooldownMs = MOVEMENT_PHYSICS.wallJumpCooldownMs;
  const wallSlideMaxFallSpeed = MOVEMENT_PHYSICS.wallSlideMaxFallSpeed;
  const wallKickLockMs = MOVEMENT_PHYSICS.wallKickLockMs;
  const wallKickFull = MOVEMENT_PHYSICS.wallKickFull;
  const wallKickVerticalMult =
    Number(MOVEMENT_PHYSICS.wallKickVerticalMult) || 1;
  const wallKickInputGraceMs = MOVEMENT_PHYSICS.wallKickInputGraceMs || 130;
  const wallContactGraceMs = MOVEMENT_PHYSICS.wallContactGraceMs || 130;
  const wallJumpHorizontalGracePx =
    MOVEMENT_PHYSICS.wallJumpHorizontalGracePx || 34;
  const wallSlideReentryDelayMs =
    MOVEMENT_PHYSICS.wallSlideReentryDelayMs || 220;
  const wallSlideSnapDistance = 10;
  const wallSlideVerticalPadding = 6;
  const wallJumpPressBufferMs = 120;
  // - fallGravityFactor: gravity multiplier while falling (fast-fall). 1.0 = off.
  const fallGravityFactor = MOVEMENT_PHYSICS.fallGravityFactor;
  // Ensure body uses our drag settings once
  if (player.body) {
    const onGround = player.body.touching.down;
    player.setDragX(onGround ? dragGround : dragAir);
    player.setMaxVelocity(maxSpeed, 1000);
  }
  // Track last grounded time for coyote jumping
  player._lastGroundTime = player.body.touching.down
    ? Date.now()
    : player._lastGroundTime || 0;

  // Keys. Player can use either arrow keys or WASD
  const keyA = scene.input.keyboard.addKey("A");
  const keyD = scene.input.keyboard.addKey("D");
  const keyW = scene.input.keyboard.addKey("W");
  const mobileMoveLeft = !!mobileControlsController?.isMovingLeft?.();
  const mobileMoveRight = !!mobileControlsController?.isMovingRight?.();
  let leftKey = cursors.left.isDown || keyA.isDown || mobileMoveLeft;
  let rightKey = cursors.right.isDown || keyD.isDown || mobileMoveRight;
  let upKey =
    cursors.up.isDown ||
    keyW.isDown ||
    (keySpace && keySpace.isDown) ||
    !!mobileControlsController?.isJumpHeld?.();
  let upKeyFreshPress =
    Phaser.Input.Keyboard.JustDown(cursors.up) ||
    Phaser.Input.Keyboard.JustDown(keyW) ||
    (!!keySpace && Phaser.Input.Keyboard.JustDown(keySpace));
  if (mobileControlsController?.consumeJumpFreshPress?.()) {
    upKeyFreshPress = true;
  }
  if (upKeyFreshPress) {
    player._lastJumpPressTime = Date.now();
  }

  const touchingWallNow =
    !!player.body.touching.left ||
    !!player.body.touching.right ||
    !!player.body.blocked.left ||
    !!player.body.blocked.right;
  const touchingLeftNow =
    !!player.body.touching.left || !!player.body.blocked.left;
  const touchingRightNow =
    !!player.body.touching.right || !!player.body.blocked.right;
  const playerBodyLeft = player.body.x;
  const playerBodyRight = player.body.x + player.body.width;
  const playerBodyTop = player.body.y;
  const playerBodyBottom = player.body.y + player.body.height;
  let nearLeftWall = false;
  let nearRightWall = false;
  let leftWallGap = Number.POSITIVE_INFINITY;
  let rightWallGap = Number.POSITIVE_INFINITY;
  if (Array.isArray(mapObjects)) {
    for (const obj of mapObjects) {
      const body = obj?.body;
      if (!body || body === player.body || body.enable === false) continue;
      const bodyWidth = Number(body.width) || 0;
      const bodyHeight = Number(body.height) || 0;
      if (bodyWidth <= 0 || bodyHeight <= 0) continue;

      const objLeft = Number(body.x) || 0;
      const objRight = objLeft + bodyWidth;
      const objTop = Number(body.y) || 0;
      const objBottom = objTop + bodyHeight;
      const verticallyAligned =
        playerBodyBottom > objTop + wallSlideVerticalPadding &&
        playerBodyTop < objBottom - wallSlideVerticalPadding;
      if (!verticallyAligned) continue;

      if (body.checkCollision?.right !== false && playerBodyLeft >= objRight) {
        const gap = playerBodyLeft - objRight;
        leftWallGap = Math.min(leftWallGap, gap);
        if (gap <= wallSlideSnapDistance) {
          nearLeftWall = true;
        }
      }
      if (body.checkCollision?.left !== false && objLeft >= playerBodyRight) {
        const gap = objLeft - playerBodyRight;
        rightWallGap = Math.min(rightWallGap, gap);
        if (gap <= wallSlideSnapDistance) {
          nearRightWall = true;
        }
      }
      if (nearLeftWall && nearRightWall) break;
    }
  }
  const nowWallTs = Date.now();
  const bufferedJumpPressActive =
    nowWallTs - (player._lastJumpPressTime || 0) <= wallJumpPressBufferMs;
  const horizontalKickReachPx =
    wallSlideSnapDistance +
    (bufferedJumpPressActive ? wallJumpHorizontalGracePx : 0);
  const bufferedNearLeftWall =
    Number.isFinite(leftWallGap) && leftWallGap <= horizontalKickReachPx;
  const bufferedNearRightWall =
    Number.isFinite(rightWallGap) && rightWallGap <= horizontalKickReachPx;
  const bufferedKickSide =
    bufferedNearLeftWall && !bufferedNearRightWall
      ? "left"
      : bufferedNearRightWall && !bufferedNearLeftWall
        ? "right"
        : bufferedNearLeftWall && bufferedNearRightWall
          ? leftWallGap <= rightWallGap
            ? "left"
            : "right"
          : null;
  const wallSlideLeft = touchingLeftNow || nearLeftWall;
  const wallSlideRight = touchingRightNow || nearRightWall;
  const wallSlideContact = wallSlideLeft || wallSlideRight;
  const wallSide = touchingLeftNow
    ? "left"
    : touchingRightNow
      ? "right"
      : nearLeftWall
        ? "left"
        : nearRightWall
          ? "right"
          : null;
  const wallJumpSide = wallSide || bufferedKickSide;
  if (wallJumpSide) {
    player._lastWallContactTs = nowWallTs;
    player._lastWallSide = wallJumpSide;
  }
  const effectiveWallSide =
    wallJumpSide ||
    nowWallTs - (player._lastWallContactTs || 0) <= wallContactGraceMs
      ? player._lastWallSide || wallJumpSide
      : null;
  const wallSlideSuppressed =
    (player._wallSlideSuppressedUntil || 0) > nowWallTs;
  const wallKickAwayNow =
    (effectiveWallSide === "left" && rightKey && !leftKey) ||
    (effectiveWallSide === "right" && leftKey && !rightKey);
  if (wallKickAwayNow) {
    player._lastWallKickAwayInputTs = nowWallTs;
  }
  const wallKickAwayRequested =
    wallKickAwayNow ||
    nowWallTs - (player._lastWallKickAwayInputTs || 0) <= wallKickInputGraceMs;

  const nowTs = Date.now();
  const movementLocked = (player?._movementLockedUntil || 0) > nowTs;
  const specialAnimLocked = () =>
    (player?._specialAnimLockUntil || 0) > Date.now();
  if (movementLocked) {
    leftKey = false;
    rightKey = false;
    upKey = false;
    if (player.body) {
      player.setAccelerationX(0);
      player.setVelocityX(0);
      player.body.allowGravity = false;
    }

    const startedAt = Number(player._dravenInfernoStartedAt || nowTs);
    const baseX = Number.isFinite(player._dravenInfernoBaseX)
      ? player._dravenInfernoBaseX
      : player.x;
    const baseY = Number.isFinite(player._dravenInfernoBaseY)
      ? player._dravenInfernoBaseY
      : player.y;
    const riseT = Phaser.Math.Clamp((nowTs - startedAt) / 320, 0, 1);
    const lift = Number(player._dravenInfernoLift || 125);
    const hoverY =
      baseY -
      lift * Phaser.Math.Easing.Cubic.Out(riseT) +
      Math.sin((nowTs - startedAt) / 120) * 8;
    player.x = baseX;
    player.y = hoverY;

    if (scene.anims?.exists("draven-special")) {
      try {
        if (player.anims?.currentAnim?.key !== "draven-special") {
          player.anims.play("draven-special", true);
        }
      } catch (_) {}
    }
  } else if (
    player &&
    player.body &&
    player._dravenInfernoPrevGravity !== undefined
  ) {
    const prevGravity =
      typeof player._dravenInfernoPrevGravity === "boolean"
        ? player._dravenInfernoPrevGravity
        : true;
    player.body.allowGravity = prevGravity;
    delete player._dravenInfernoPrevGravity;
  }

  // Fast-fall gravity: apply extra gravity only when falling (vy > 0) and airborne.
  try {
    const worldG = scene.physics?.world?.gravity?.y || 0;
    const isAirborne = !player.body.touching.down;
    const isFalling = (player.body.velocity.y || 0) > 5;
    if (
      isAirborne &&
      isFalling &&
      (!wallSlideContact || wallSlideSuppressed) &&
      fallGravityFactor > 1
    ) {
      // Additive per-body gravity so total ~= worldG * fallGravityFactor
      player.body.setGravityY(worldG * (fallGravityFactor - 1));
    } else {
      // Reset any extra gravity when not falling
      player.body.setGravityY(0);
    }
  } catch (_) {}

  // Handle basic attack on J
  try {
    if (keyJ && Phaser.Input.Keyboard.JustDown(keyJ) && !dead) {
      if (!((player?._movementLockedUntil || 0) > Date.now())) {
        const context = resolveQuickAttackContext("basic");
        fireBasicAttack(context.direction, context);
      }
    }
    // Handle special on I
    if (keyI && Phaser.Input.Keyboard.JustDown(keyI) && !dead) {
      if (!((player?._movementLockedUntil || 0) > Date.now())) {
        fireSpecialAttack(resolveQuickAttackContext("special"));
      }
    }
    if (keyE && Phaser.Input.Keyboard.JustDown(keyE) && !dead) {
      if (!((player?._movementLockedUntil || 0) > Date.now())) {
        noteClientActionSent("mode-interact", { type: "mode-interact" });
        socket.emit("game:action", { type: "mode-interact" });
      }
    }
  } catch (_) {}

  if (mobileControlsController?.isEnabled?.()) {
    mobileControlsController.updateReticle(attackAimReticleController);
  } else if (!attackAimState.active) {
    clearAttackAimReticle();
  }

  // Left movement
  if (leftKey) {
    if (indicatorTriangle) {
      indicatorTriangle.clear(); // Removes indicator triangle if the player has moved
      indicatorTriangle.setVisible(false);
    }
    // Apply acceleration left (respect wall-kick lock)
    const lockActive = (player._wallKickLockUntil || 0) > Date.now();
    const onGround = player.body.touching.down;
    const a = onGround ? accel : airAccel;
    if (lockActive && (player.body.velocity.x || 0) > 0) {
      // Currently being kicked to the right; ignore opposite input briefly
      player.setAccelerationX(0);
    } else {
      player.setAccelerationX(-a);
    }
    player.setDragX(onGround ? dragGround : dragAir);
    const wasFlip = player.flipX;
    if (!player._lockFlip) {
      player.flipX = true; // Mirrors the body of the player
    } else if (player._lockedFlipX !== undefined) {
      player.flipX = player._lockedFlipX; // enforce locked facing
    }
    if (player.flipX !== wasFlip && applyFlipOffsetLocal)
      applyFlipOffsetLocal();
    isMoving = true; // Sets the isMoving to true
    if (
      player.body.touching.down &&
      !isAttacking &&
      !dead &&
      !specialAnimLocked()
    ) {
      // If the player is not in the air or attacking or dead, it plays the running animation
      player.anims.play(
        resolveAnimKey(scene, currentCharacter, "running"),
        true,
      );
      // Footstep SFX throttled
      sfxWalkCooldown += scene.game.loop.delta;
      if (sfxWalkCooldown >= 280) {
        sfxWalkCooldown = 0;
        scene.sound.play("sfx-step", { volume: 2 });
      }
    }
    // Right movement
  } else if (rightKey) {
    if (indicatorTriangle) {
      indicatorTriangle.clear(); // Removes indicator triangle if the player has moved
      indicatorTriangle.setVisible(false);
    }
    const wasFlip = player.flipX;
    if (!player._lockFlip) {
      player.flipX = false; // Undo mirror
    } else if (player._lockedFlipX !== undefined) {
      player.flipX = player._lockedFlipX; // keep locked
    }
    if (player.flipX !== wasFlip && applyFlipOffsetLocal)
      applyFlipOffsetLocal();
    const onGroundRight = player.body.touching.down;
    const aRight = onGroundRight ? accel : airAccel;
    const lockActiveRight = (player._wallKickLockUntil || 0) > Date.now();
    if (lockActiveRight && (player.body.velocity.x || 0) < 0) {
      // Currently being kicked to the left; ignore opposite input briefly
      player.setAccelerationX(0);
    } else {
      player.setAccelerationX(aRight);
    }
    player.setDragX(onGroundRight ? dragGround : dragAir);
    isMoving = true; // Sets moving variable
    if (
      player.body.touching.down &&
      !isAttacking &&
      !dead &&
      !specialAnimLocked()
    ) {
      // If the player is not in the air or attacking or dead, it plays the running animation
      player.anims.play(
        resolveAnimKey(scene, currentCharacter, "running"),
        true,
      );
      // Footstep SFX throttled
      sfxWalkCooldown += scene.game.loop.delta;
      if (sfxWalkCooldown >= 280) {
        sfxWalkCooldown = 0;
        scene.sound.play("sfx-step", { volume: 2 });
      }
    }
  } else {
    stopMoving(); // If no key is being pressed, it calls the stop moving function
  }

  // Jumping
  const now = Date.now();
  if (
    !dead &&
    effectiveWallSide &&
    !player.body.touching.down &&
    canWallJump &&
    bufferedJumpPressActive &&
    wallKickAwayRequested
  ) {
    wallJump(effectiveWallSide); // Calls walljump
    scene.sound.play("sfx-walljump", { volume: 4 });
    player._lastJumpPressTime = 0;
  } else if (
    upKey &&
    (player.body.touching.down ||
      now - (player._lastGroundTime || 0) <= coyoteTimeMs) &&
    !dead
  ) {
    // If player is touching ground and jumping
    if (indicatorTriangle) {
      indicatorTriangle.clear(); // Removes indicator triangle if the player has jumped
      indicatorTriangle.setVisible(false);
    }
    // Slight jump boost when moving fast to feel snappier transitions
    const vx = Math.abs(player.body.velocity.x || 0);
    const boost = Phaser.Math.Clamp((vx / maxSpeed) * jumpBoost, 0, jumpBoost);
    jumpSpeed =
      (MOVEMENT_PHYSICS.jumpSpeed + boost) *
      Math.max(MOVEMENT_PHYSICS.minSpeedMult, movementJumpMult || 1);
    jump(); // Calls jump
    scene.sound.play("sfx-jump", { volume: 3 });
    if (wallSlideContact || effectiveWallSide) {
      player._wallSlideSuppressedUntil = Date.now() + wallSlideReentryDelayMs;
    }
  }
  if (
    !dead &&
    wallSlideContact &&
    !wallSlideSuppressed &&
    !isAttacking &&
    !specialAnimLocked()
  ) {
    player.anims.play(resolveAnimKey(scene, currentCharacter, "sliding"), true); // Plays sliding animation
  }

  const isWallSliding =
    !dead &&
    !player.body.touching.down &&
    wallSlideContact &&
    !wallSlideSuppressed &&
    (player.body.velocity.y || 0) > 20;
  updateWallSlideAudio(isWallSliding);

  // Wall slide: when touching a wall and airborne, limit fall speed for a slower slide
  if (!player.body.touching.down && wallSlideContact && !wallSlideSuppressed) {
    if (player.body.velocity.y > wallSlideMaxFallSpeed) {
      player.setVelocityY(wallSlideMaxFallSpeed);
    }
  }

  // Check if the jump animation has completed
  if (
    !player.anims.isPlaying &&
    !player.body.touching.down &&
    (!wallSlideContact || wallSlideSuppressed) &&
    !isAttacking
  ) {
    fall(); // Plays falling animation if the player is not touching a wall or if any other animation is playing
  }

  // If no movement animations are playing, play the 'idle' animation
  if (
    !isMoving &&
    player.body.touching.down &&
    !isJumping &&
    !isAttacking &&
    !dead
  ) {
    idle();
  }

  updatePointerAttackAimState();
  syncLocalUiPosition();

  // Landing detection (transition airborne -> grounded)
  const onGround = player.body.touching.down;
  if (!wasOnGround && onGround && !dead) {
    scene.sound.play("sfx-land", { volume: 4 });
  }
  wasOnGround = onGround;
  if (onGround) player._lastGroundTime = Date.now();

  // Ammo reload tick
  if (ammoCharges < ammoCapacity) {
    reloadTimerMs += scene.game.loop.delta;
    if (reloadTimerMs >= ammoReloadMs) {
      reloadTimerMs = 0;
      ammoCharges = Math.min(ammoCapacity, ammoCharges + 1);
    }
  } else {
    reloadTimerMs = 0; // full, no reload progress
  }
  // Redraw ammo bar periodically (cheap draw)
  if (!dead) drawAmmoBar();

  // Per-character effects update (e.g., Draven fire trail)
  if (charEffects) {
    charEffects.update(scene.game.loop.delta, isMoving, dead);
  }

  dustTimer += scene.game.loop.delta;

  // Ground running dust (only while on ground & moving)
  if (
    !dead &&
    isMoving &&
    player.body.touching.down &&
    dustTimer >= dustInterval
  ) {
    dustTimer = 0;
    // Spawn at the physics body's bottom to account for per-character frame sizing
    const bodyBottom = player.body
      ? player.body.y + player.body.height
      : player.y + player.height / 2;
    const dustY = bodyBottom - 2; // slight lift to avoid z-fighting
    const dustX = player.x + (player.flipX ? -18 : 18) * 0.3;
    spawnDust(scene, dustX, dustY);
    if (Math.random() < 0.3) {
      // occasional extra puff for variability
      spawnDust(
        scene,
        dustX + Phaser.Math.Between(-6, 6),
        dustY + Phaser.Math.Between(-2, 2),
      );
    }
  }

  networkInputState = {
    left: !!leftKey,
    right: !!rightKey,
    direction: rightKey && !leftKey ? 1 : leftKey && !rightKey ? -1 : 0,
    jumpHeld: !!upKey,
    jumpPressed: !!upKeyFreshPress,
    grounded: !!player?.body?.touching?.down,
    vx: Number(player?.body?.velocity?.x) || 0,
    vy: Number(player?.body?.velocity?.y) || 0,
    facing: player?.flipX ? -1 : 1,
    animation: player?.anims?.currentAnim?.key || null,
    movementLocked,
    loaded:
      !dead &&
      Number.isFinite(player?.x) &&
      Number.isFinite(player?.y) &&
      player?.visible !== false,
  };

  function stopMoving() {
    // Stop applying acceleration and let drag slow the player naturally
    player.setAccelerationX(0);
    const onGround = player.body.touching.down;
    player.setDragX(onGround ? dragGround : dragAir);
    // Maintain locked facing if an attack is forcing orientation
    if (player._lockFlip && player._lockedFlipX !== undefined) {
      player.flipX = player._lockedFlipX;
    }
    isMoving = false;
  }

  function jump() {
    if (!isAttacking && !specialAnimLocked()) {
      player.anims.play(
        resolveAnimKey(scene, currentCharacter, "jumping"),
        true,
      );
    }
    pdbg();
    player.setVelocityY(-jumpSpeed);
    isMoving = true;
    isJumping = true;
  }

  function wallJump(wallSideParam) {
    updateWallSlideAudio(false);
    // More powerful wall jump using physics impulses (no tween)
    canWallJump = false;
    const fromLeft = wallSideParam === "left";
    const horizKick = fromLeft ? wallKickFull : -wallKickFull;
    const vertKick =
      Math.max(jumpSpeed + 30, 220) * Math.max(0.1, wallKickVerticalMult); // slightly less vertical pop

    // Face away from the wall and fix body offset
    if (!player._lockFlip) {
      const wasFlip = player.flipX;
      player.flipX = !fromLeft;
      if (player.flipX !== wasFlip && applyFlipOffsetLocal)
        applyFlipOffsetLocal();
    } else if (player._lockedFlipX !== undefined) {
      // Reinforce locked facing
      if (player.flipX !== player._lockedFlipX) {
        player.flipX = player._lockedFlipX;
        if (applyFlipOffsetLocal) applyFlipOffsetLocal();
      }
    }

    // Play a jump-like animation
    if (!isAttacking && !specialAnimLocked()) {
      player.anims.play(
        resolveAnimKey(scene, currentCharacter, "jumping"),
        true,
      );
    }
    pdbg();

    // Apply velocity impulses
    // Nudge away from the wall first so we don't remain embedded and lose the kick
    const sep = 8;

    // Visual-only kickback cloud at wall contact point.
    try {
      const body = player.body;
      const contactX = body
        ? body.x + (fromLeft ? 0 : body.width)
        : player.x + (fromLeft ? -player.width * 0.5 : player.width * 0.5);
      const contactY = body
        ? body.y + body.height * 0.62
        : player.y + player.height * 0.18;
      // direction indicates kick direction away from wall.
      spawnWallKickCloud(scene, contactX, contactY, fromLeft ? 1 : -1);
    } catch (_) {}

    player.x += fromLeft ? sep : -sep;
    player.setVelocityX(horizKick);
    player.setVelocityY(-vertKick);
    player.setDragX(dragAir);

    // Small lockout to prevent immediate re-wall-jumping
    scene.time.delayedCall(wallJumpCooldownMs, () => {
      canWallJump = true;
    });
    // During a short lock window, ignore opposite input so the kick carries
    player._wallKickLockUntil = Date.now() + wallKickLockMs;
  }

  function fall() {
    updateWallSlideAudio(false);
    if (!isAttacking && !specialAnimLocked()) {
      player.anims.play(
        resolveAnimKey(scene, currentCharacter, "falling"),
        true,
      );
    }
    pdbg();
    isJumping = false;
  }

  function idle() {
    updateWallSlideAudio(false);
    if (specialAnimLocked()) return;
    player.anims.play(resolveAnimKey(scene, currentCharacter, "idle"), true);
    pdbg();
  }

  function updateWallSlideAudio(shouldPlay) {
    if (!wallSlideLoopSfx) return;
    if (shouldPlay) {
      if (!wallSlideLoopPlaying) {
        try {
          wallSlideLoopSfx.play();
          wallSlideLoopPlaying = true;
        } catch (_) {}
      }
      return;
    }
    if (wallSlideLoopPlaying) {
      try {
        wallSlideLoopSfx.stop();
      } catch (_) {}
      wallSlideLoopPlaying = false;
    }
  }
}

export function setSuperStats(charge, maxCharge) {
  return localStateSync.setSuperStats(charge, maxCharge);
}

export function applyAuthoritativeState(state) {
  return localStateSync.applyAuthoritativeState(state);
}

export function getAmmoSyncState() {
  return localStateSync.getAmmoSyncState();
}

export function getNetworkInputState() {
  return { ...networkInputState };
}

export function setLocalNetStateFlusher(fn) {
  flushLocalNetState = typeof fn === "function" ? fn : null;
}

export function setChatInputActive(active) {
  const resetKeyState = (key) => {
    try {
      key?.reset?.();
      if (key) {
        key.isDown = false;
        key.isUp = true;
      }
    } catch (_) {}
  };

  chatInputActive = !!active;
  if (chatInputActive) {
    resetPointerAttackAim();
    try {
      if (player?.body) {
        player.setVelocityX(0);
        player.setAccelerationX(0);
        player.setDragX(0);
      }
    } catch (_) {}
    try {
      scene?.input?.keyboard?.resetKeys?.();
    } catch (_) {}
    resetKeyState(cursors?.left);
    resetKeyState(cursors?.right);
    resetKeyState(cursors?.up);
    resetKeyState(cursors?.down);
    resetKeyState(keySpace);
    resetKeyState(keyJ);
    resetKeyState(keyI);
    resetKeyState(keyE);
    networkInputState = {
      ...networkInputState,
      left: false,
      right: false,
      direction: 0,
      jumpHeld: false,
      jumpPressed: false,
      movementLocked: true,
    };
  }
}

export function isChatInputActive() {
  return chatInputActive;
}

export function reconcileLocalMovement(snapshot = {}) {
  if (!player || !player.body || dead) return;
  if (snapshot?.isAlive === false || snapshot?.loaded !== true) return;

  const now = performance.now();
  const ackSeq = Number(snapshot?.inputSeq);
  if (
    Number.isFinite(ackSeq) &&
    ackSeq >= Number(localMovementReconcileState.lastAckSeq || -1)
  ) {
    localMovementReconcileState.lastAckSeq = ackSeq;
    localMovementReconcileState.lastAckAt = now;
  }
}

export function setPowerupMobility(speedMult = 1, jumpMult = 1) {
  return localStateSync.setPowerupMobility(speedMult, jumpMult);
}

export { player, frame, currentHealth, setCurrentHealth, dead };
