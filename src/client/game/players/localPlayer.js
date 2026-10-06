import { updateDash, endDash, drawDashCooldown, protectDashMotion, applyDashCoast } from '../scene/dash';
import { spritePresentation } from '../characters/shared/spritePresentation';
import { applyTeamVisual } from "../../../shared/projectilePresentation";
import { getSettings, bindCanvasName, subscribeSettings } from "../../site/preferences";
import {
  resolveWallContact,
  applyWallSlide,
  resolveWallSlideFlipX,
} from './wallMovement';
import { predictCharacterSpecial } from '../characters/networkRegistry';
// player.js
// NOTE: Refactored to remove circular dependency on game.js.
// socket now comes from standalone socket.js and opponentPlayers are passed into createPlayer.
import socket from "../../lib/socket";
import { drawSuperChargeBar, resetSuperBarAnimation } from "../scene/superBarRenderer";
import { drawHealthBar, resetHealthBarAnimation } from "../scene/healthBarRenderer";
import {
  setStatusIconStackAlpha,
  setStatusIconStackVisible,
  syncStatusIconStack,
} from "../scene/statusIconStack";
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
} from "../characters";
import {
  spawnHealthMarker,
  spawnJumpTakeoff,
  spawnSpawnBurst,
  spawnWallKickCloud,
} from "../scene/effects";
import { bindLocalSocketEvents } from "./localSocketEvents";
import { createLocalMovementAudio } from "./localMovementAudio";
import { createLocalMovementFx } from "./localMovementFx";
import { createLocalStateSync } from "./localStateSync";
import {
  getPlayerAimBasePoint,
  resolveAttackAimContext,
  getNearestOpponentDirection,
} from "../characters/shared/attackAim";
import {
  deriveMovementAnimation,
  getAnimationDurationMs,
  getPresentedAnimation,
  markOneShotAnimation,
  noteAnimationPlayed,
  playCharacterAnimation,
  resetAirborneJumpAnimation,
  markWallJumpAnimation,
  holdWallSlidePose,
} from "../characters/shared/animationState.js";
import { createAttackAimReticleController } from "../scene/attackAimReticle";
import { createCombatMouseController } from "../scene/combatMouse";
import { createMobileControlsController } from "../scene/mobileControls";
import { releaseMovementForFocus } from "./focusMomentum.mjs";
import { RENDER_LAYERS } from "../scene/renderLayers";
import { triggerWallJumpCameraKick } from "../scene/cameraDynamics";
import MOVEMENT_PHYSICS from "../../../shared/physics/movementPhysics.json";
import {
  DUCK_HEIGHT_RATIO,
  DUCK_SPEED_RATIO,
  DUCK_REENTRY_DELAY_MS,
  findGroundSpan,
  hasStandingClearance,
  holdDuckGround,
} from "../../../shared/physics/ducking.js";
import { noteClientActionSent } from "../../lib/netTestLogger.js";
import {
  playDuckTransitionSound,
  playDuckBlockSound,
} from "../audio/movementAudio.js";
import { resolveCharacterKey } from "../../../shared/characters/characterStats.js";
import { characterPresentation } from "../../../shared/characters/index.js";
// Globals
let player;
let cursors;
let movementKeys;
let keySpace; // Spacebar for dash
let keyJ; // J for basic attack
let canWallJump = true;
let isMoving = false;
let isJumping = false;
let isAttacking = false;
let canAttack = true;
// SFX state
let movementFxSequence = 0;
let latestMovementFxEvent = {
  seq: 0,
  type: null,
  direction: 0,
  wallSide: null,
  fallDistance: 0,
  impactVelocity: 0,
};

let frame;

let maxHealth = 8000;
let currentHealth = 8000; // Client-side copy (display only)
let dead = false;

let healthBarWidth = 60;
let healthBar;
let healthText;
let duckShieldIcon;
let duckShieldGlow;
let powerupStatusIcons = [];
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
let lastNoSuperSfxAt = 0;

let superBar;
let superBarBack;
let superCharge = 0;
let maxSuperCharge = 100;
let keyI;
let keyE;
let _specialNotReadyFlash = 0; // timestamp until "not ready" red flash expires
let movementSpeedMult = 1;
let movementJumpMult = 1;
let powerupInvisible = false;

let playerName;

let indicatorTriangle;

let username;
let gameId = window.location.pathname.split("/").filter(Boolean).pop();

let scene;
// Persist the selected character so movement helpers can resolve anim keys
let currentCharacter;
let currentSkinId = "";

let playersInTeam;
let mapObjects;
let opponentPlayersRef; // injected from game.js to avoid circular import

// Body config and flip-offset applier hoisted for use across functions
let bodyConfig = null;
let applyFlipOffsetLocal = null;
let resizeForDuckLocal = null;
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

function noteMovementFxEvent(type, details = {}) {
  movementFxSequence = (movementFxSequence + 1) % 2147483647;
  latestMovementFxEvent = {
    seq: movementFxSequence,
    type,
    direction: Math.sign(Number(details.direction) || 0),
    wallSide:
      details.wallSide === "left" || details.wallSide === "right"
        ? details.wallSide
        : null,
    fallDistance: Math.max(0, Math.round(Number(details.fallDistance) || 0)),
    impactVelocity: Math.max(
      0,
      Math.round(Number(details.impactVelocity) || 0),
    ),
  };
}

const movementAudio = createLocalMovementAudio();
const movementFx = createLocalMovementFx({ audio: movementAudio, noteEvent: noteMovementFxEvent });

function getMovementFxNetworkState() {
  return {
    movementFxSeq: latestMovementFxEvent.seq,
    movementFxType: latestMovementFxEvent.type,
    movementFxDirection: latestMovementFxEvent.direction,
    movementFxWallSide: latestMovementFxEvent.wallSide,
    movementFxFallDistance: latestMovementFxEvent.fallDistance,
    movementFxImpactVelocity: latestMovementFxEvent.impactVelocity,
  };
}

function resetMovementVfxTracking() {
  movementAudio.stopLoops();
  movementFx.reset();
}

function resetMovementInputState({ preserveVelocity = false } = {}) {
  const resetKeyState = (key) => {
    try {
      key?.reset?.();
      if (key) {
        key.isDown = false;
        key.isUp = true;
      }
    } catch (_) {}
  };

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
  mobileControlsController?.resetInput?.();

  if (player?.body) {
    player._lastJumpPressTime = 0;
    player._lastWallKickAwayInputTs = 0;
    if (preserveVelocity) {
      releaseMovementForFocus(player, {
        dragGround: MOVEMENT_PHYSICS.dragGround,
        dragAir: MOVEMENT_PHYSICS.dragAir,
        shockwaveActive: (player._shockwaveUntil || 0) > Date.now(),
      });
    } else {
      player._jumpLaunch = null;
      player.setVelocity?.(0, 0);
      player.setAcceleration?.(0, 0);
    }
  }

  networkInputState = {
    ...networkInputState,
    left: false,
    right: false,
    direction: 0,
    jumpHeld: false,
    jumpPressed: false,
    vx: Number(player?.body?.velocity?.x) || 0,
    vy: Number(player?.body?.velocity?.y) || 0,
    wallSliding: false,
    wallSide: null,
    movementLocked: preserveVelocity,
  };
}

let combatMouseController = null;

const attackAimState = {
  active: false,
  pointerId: null,
  family: "basic",
  button: 0,
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

const localStateSync = createLocalStateSync({
  Phaser,
  getPlayer: () => player,
  getDead: () => dead,
  setDead: (value) => {
    if (dead !== value) {
      endDash(player, false);
      if (player) { player._dashReadyAt = 0; player._dashHud?.hide(); }
    }
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
  combatMouseController?.endDrag();
  attackAimState.active = false;
  attackAimState.pointerId = null;
  attackAimState.family = "basic";
  attackAimState.button = 0;
  attackAimState.currentContext = null;
  clearAttackAimReticle();
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
  combatMouseController?.destroy();
  combatMouseController = null;
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
  if (combatMouseController?.shouldShowReticle()) return resolveDirectionalAttackContext(family);
  return resolveAttackAimContext({
    character: currentCharacter,
    player,
    family,
    quick: true,
    quickFacingDirection: getNearestOpponentDirection(player, opponentPlayersRef),
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

function resolveDirectionalAttackContext(family = "basic") {
  if (!player || !combatMouseController) return null;
  if (combatMouseController.isDefaultAim()) {
    return resolveAttackAimContext({ character: currentCharacter, player, family, quick: true,
      quickFacingDirection: getNearestOpponentDirection(player, opponentPlayersRef) });
  }
  const base = getAimBasePoint(family);
  const direction = combatMouseController.getDirection();
  const defaultRange = Number(base.config?.defaultRange) || 120;
  const minRange = Number(base.config?.minRange) || defaultRange;
  const maxRange = Number(base.config?.maxRange) || defaultRange;
  const range = base.config?.kind === "throw"
    ? minRange + (maxRange - minRange) * combatMouseController.getDistanceRatio()
    : defaultRange;
  return resolveAttackAimContext({
    character: currentCharacter, player, family, quick: false,
    pointerWorldX: base.baseX + direction.x * range,
    pointerWorldY: base.baseY + direction.y * range,
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

function startPointerAttackAim(pointer, family = "basic", button = 0) {
  if (!pointer || dead) return;
  resetPointerAttackAim();
  combatMouseController?.beginDrag(player?.flipX ? -1 : 1, getAimBasePoint(family).config?.kind === "throw");
  attackAimState.active = true;
  attackAimState.family = family;
  attackAimState.button = button;
  attackAimState.pointerId = pointer.id;
  updatePointerAttackAimState();
}

function updatePointerAttackAimState() {
  if (mobileControlsController?.isEnabled?.()) return;
  if (!player || dead || !combatMouseController?.shouldShowReticle()) {
    clearAttackAimReticle();
    return;
  }
  const family = attackAimState.active ? attackAimState.family : "basic";
  attackAimState.currentContext = resolveDirectionalAttackContext(family);
  attackAimReticleController?.update({ ...attackAimState.currentContext,
    previewStrength: combatMouseController.getStrength(),
    centerCue: combatMouseController.getCenterCue() });
}

function finishPointerAttackAim(pointer) {
  if (!attackAimState.active ||
      (pointer && pointer.id !== attackAimState.pointerId)) return null;
  // Resolve from the current player position with the same direction as the preview.
  const context = combatMouseController?.isAiming()
    ? resolveDirectionalAttackContext(attackAimState.family)
    : resolveQuickAttackContext(attackAimState.family);
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
  selectedSkinIdParam = "",
) {
  resetMovementVfxTracking();
  resetPointerAttackAim();
  detachPointerAttackBindings();
  mobileControlsController?.destroy?.();
  if (attackAimReticleController) {
    try {
      attackAimReticleController.destroy();
    } catch (_) {}
    attackAimReticleController = null;
  }
  attackAimReticleController = createAttackAimReticleController(sceneParam, {
    getAmmoCharges: () => ammoCharges,
  });
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
          quickFacingDirection: quick ? getNearestOpponentDirection(player, opponentPlayersRef) : null,
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
  playersInTeam = playersInTeamParam;
  opponentPlayersRef = opponentPlayersParam;
  // Remember the chosen character for animation resolution in update loop
  currentCharacter = character;
  currentSkinId = String(selectedSkinIdParam || "").trim();
  pdbg();
  let bindingSignature='';
  const bindKeys = settings => {
    const signature=JSON.stringify(settings.keys);if(signature===bindingSignature)return;
    bindingSignature=signature;
    for(const key of Object.values(movementKeys || {})) key?.reset?.();
    for(const key of [keySpace,keyJ,keyI,keyE,...Object.values(cursors || {})]) key?.reset?.();
    const key = slot => scene.input.keyboard.addKey(settings.keys[slot]);
    movementKeys={left:key('left'),right:key('right'),up:key('up'),down:key('down')};
    cursors={left:key('leftAlt'),right:key('rightAlt'),up:key('upAlt'),down:key('downAlt')};
    keySpace=key('dash');keyJ=key('attack');keyI=key('special');keyE=key('interact');
  };
  bindKeys(getSettings());
  const stopKeyUpdates=subscribeSettings(bindKeys);
  scene.events.once('shutdown',stopKeyUpdates);

  movementAudio.attach(scene);

  // Animations are registered globally in game.js via setupAll(scene)

  // Create player sprite using the character class factory so each class
  // owns its own texture key without duplicating it here.
  const CharCls = getCharacterClassByKey(character);
  player = CharCls
    ? scene.physics.add.sprite(
        -100,
        -100,
        getTextureKey(character, currentSkinId),
      )
    : scene.physics.add.sprite(
        -100,
        -100,
        getTextureKey(character, currentSkinId),
      );
  scene._localPlayerAudioSprite = player;
  player._bbCharacter = String(currentCharacter || "").toLowerCase();
  player._bbSkinId = currentSkinId;
  player._bbSkinTextureKey = getTextureKey(character, currentSkinId);
  applyTeamVisual(player, null);
  player.username = username; // Attach username for collision detection
  player._suppressSpawnLandingSound = true;
  player.setCollideWorldBounds(true);
  player.anims.play(
    resolveAnimKey(scene, currentCharacter, "idle", "idle", currentSkinId),
    true,
  ); // Play idle animation
  noteAnimationPlayed(player, "idle");
  // Hide until we've configured frame/body and spawn to avoid a mid-air first render
  player.setVisible(false);
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
  const presentation = spritePresentation(character, player.texture);
  player.setScale(presentation.scale);
  player.setOrigin(presentation.originX, presentation.originY);
  player._bbHudTopOffset = presentation.hudTopOffset;

  // Establish frame/body sizing BEFORE computing spawn so height math is correct
  frame = player.frame;
  const bs = presentation.body;
  bodyConfig = bs; // persist for use in movement function
  const widthShrink = bs.widthShrink;
  const heightShrink = bs.heightShrink;
  const bw = Math.max(4, frame.realWidth - widthShrink);
  const bh = Math.max(4, frame.realHeight - heightShrink);
  player.body.setSize(bw, bh);
  player.body.updateFromGameObject?.();
  player._ducking = false;
  player._duckRequested = false;
  player._duckAvailableAt = 0;
  player._duckGroundSpan = null;
  // Helper to adjust body offset when flipping
  applyFlipOffsetLocal = () => {
    if (!player || !player.body) return;
    const cfg = bodyConfig || {};
    const flipOffset = cfg.flipOffset || 0; // falsy -> 0
    const extra = player.flipX ? flipOffset : 0;
    const frameW = frame ? frame.realWidth : player.width;
    const bodyW = cfg.sourceUnits ? player.body.sourceWidth : player.body.width;
    const ox = frameW / 2 - bodyW / 2 + (cfg.offsetXFromHalf ?? 0) + extra;
    const standingHeight = Math.max(4, frame.realHeight - cfg.heightShrink);
    const currentSourceHeight = player.body.sourceHeight || standingHeight;
    const oy = cfg.offsetY + standingHeight - currentSourceHeight;
    player.body.setOffset(ox, oy);
  };
  applyFlipOffsetLocal();

  resizeForDuckLocal = (ducking) => {
    if (!player?.body || player._ducking === !!ducking) return;
    const body = player.body;
    const standingHeight = Math.max(4, frame.realHeight - bodyConfig.heightShrink);
    const nextHeight = ducking
      ? Math.max(4, standingHeight * DUCK_HEIGHT_RATIO)
      : standingHeight;
    const previousWorldHeight = body.height;
    body.setSize(body.sourceWidth, nextHeight, false);
    body.setOffset(body.offset.x, bodyConfig.offsetY + standingHeight - nextHeight);
    const heightDelta = previousWorldHeight - body.height;
    body.position.y += heightDelta;
    if (body.prev) body.prev.y += heightDelta;
    if (body.prevFrame) body.prevFrame.y += heightDelta;
    if (body.autoFrame) body.autoFrame.y += heightDelta;
    body.updateCenter?.();
    player._ducking = !!ducking;
    body.touching.down = true;
    body.wasTouching.down = true;
    movementFx.markGrounded();
    movementAudio.stopFallAir();
    playDuckTransitionSound(scene, !!ducking);
  };

  const protectDuckEdge = () => {
    if (
      !player?._ducking ||
      !player._duckRequested ||
      !player._duckGroundSpan ||
      dead
    ) return;
    if (player.body.velocity.y < 0) return;
    // Re-read live ground so moving platforms carry the edge guard with them.
    player._duckGroundSpan = holdDuckGround(player.body, player._duckGroundSpan, scene._mapObjects || [])?.span || null;
  };
  const protectDash = delta => { if (!dead) protectDashMotion(scene, player, Date.now(), delta); };
  scene.physics.world.on("worldstep", protectDash);
  scene.physics.world.on("worldstep", protectDuckEdge);
  scene.events.once("shutdown", () => {
    scene.physics.world.off("worldstep", protectDuckEdge);
    scene.physics.world.off("worldstep", protectDash);
  });

  // Listener to detect if player leaves the world bounds. One request is in
  // flight at a time; otherwise every frame below the world queues another.
  let fallOutTimer = null;
  scene.events.on("update", () => {
    if (fallOutTimer || dead) return;
    if (player.y > scene.physics.world.bounds.bottom + 50) {
      fallOutTimer = setTimeout(() => {
        fallOutTimer = null;
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
  scene.events.once("shutdown", () => {
    clearTimeout(fallOutTimer);
    fallOutTimer = null;
  });

  // Keep the local player hidden until the scene finishes spawn placement and any
  // reconnect position restore. That removes the first-frame pop from -100,-100.
  player.setVisible(false);

  // Set depth so player renders above all map objects (bank bust graphics are at depths 7-24)
  player.setDepth(RENDER_LAYERS.PLAYER);

  // Player name text anchored to physics body top (not frame height)
  const bodyTop = player.body ? player.body.y : player.y - player.height / 2;
  playerName = scene.add.text(player.x, bodyTop - 40, username);
  bindCanvasName(playerName, username);
  playerName.setStyle({
    fontFamily: "LilitaOne-Regular",
    fontSize: "10px",
    fontStyle: "bold",
    fill: "#ffffff",
    stroke: "#000000",
    strokeThickness: 3,
  });
  playerName.setShadow(1, 1, "rgba(0, 0, 0, 0.65)", 1, true, true);
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
  healthBar.setDepth(RENDER_LAYERS.PLAYER_HUD + 1);
  duckShieldGlow = scene.add.image(0, 0, "pu-icon-shield-webp");
  duckShieldGlow
    .setDisplaySize(20, 23)
    .setTint(0xff8d32)
    .setAlpha(0.4)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setDepth(RENDER_LAYERS.PLAYER_HUD + 1.5)
    .setVisible(false);
  duckShieldIcon = scene.add.image(0, 0, "pu-icon-shield-webp");
  duckShieldIcon
    .setDisplaySize(13, 15)
    .setDepth(RENDER_LAYERS.PLAYER_HUD + 3)
    .setVisible(false);
  scene.tweens.add({
    targets: duckShieldGlow,
    displayWidth: { from: 18, to: 22 },
    displayHeight: { from: 21, to: 26 },
    duration: 520,
    ease: "Sine.InOut",
    yoyo: true,
    repeat: -1,
  });
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
      if (player?._dash) return false;
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
    setIsAttacking: (v) => {
      isAttacking = v;
      if (v && player) {
        const throwKey = resolveAnimKey(
          scene,
          currentCharacter,
          "throw",
          "idle",
          currentSkinId,
        );
        markOneShotAnimation(
          player,
          "throw",
          getAnimationDurationMs(scene, throwKey, 420),
        );
      }
    },
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

  // Mouse movement selects direction; left-click releases the basic attack.
  // Right-click mirrors that for supers using the special reticle theme.
  const pointerDownHandler = (pointer) => {
    if (dead || player?._dash || Date.now() < (player?._attackInterruptedUntil || 0)) return;
    if (chatInputActive || window.__BB_SITE_DIALOG_OPEN) return;
    if (
      Math.max(
        Number(player?._movementLockedUntil || 0),
        Number(player?._externalControlLockUntil || 0),
      ) > Date.now()
    ) {
      return;
    }
    const mobilePointerHandled =
      !!mobileControlsController?.handlePointerDown?.(pointer);
    if (mobilePointerHandled) return;
    if (
      mobileControlsController?.isEnabled?.() &&
      pointer?.pointerType === "touch"
    )
      return;
    if (!combatMouseController?.beginInput()) return;
    if (pointer.button === 0) {
      startPointerAttackAim(pointer, "basic", 0);
      return;
    }
    if (pointer.button === 2) {
      if (superCharge >= maxSuperCharge) {
        startPointerAttackAim(pointer, "special", 2);
      } else {
        triggerSpecialNotReadyFeedback();
      }
    }
  };

  const pointerMoveHandler = (pointer) => {
    if (chatInputActive || window.__BB_SITE_DIALOG_OPEN) return;
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
    updatePointerAttackAimState();
  };

  const pointerUpHandler = (pointer) => {
    if (chatInputActive || window.__BB_SITE_DIALOG_OPEN) return;
    const mobilePointerHandled =
      !!mobileControlsController?.handlePointerUp?.(pointer);
    if (mobilePointerHandled) return;
    if (
      mobileControlsController?.isEnabled?.() &&
      pointer?.pointerType === "touch"
    )
      return;
    const movementLockedNow =
      Math.max(
        Number(player?._movementLockedUntil || 0),
        Number(player?._externalControlLockUntil || 0),
      ) > Date.now();
    const context = finishPointerAttackAim(pointer);
    if (!context || dead || movementLockedNow || Date.now() < (player?._attackInterruptedUntil || 0)) return;
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
  combatMouseController = createCombatMouseController({
    getPreferences: getSettings,
    scene: sceneParam,
    canPrepare: () => !!player && !sceneParam._battleEnded && !chatInputActive && !window.__BB_SITE_DIALOG_OPEN &&
      !mobileControlsController?.isEnabled?.() && sceneParam.sys.isActive(),
    canCapture: () => !!player && !sceneParam._battleEnded && !chatInputActive && !window.__BB_SITE_DIALOG_OPEN &&
      !mobileControlsController?.isEnabled?.() &&
      sceneParam.input.keyboard?.enabled !== false && sceneParam.sys.isActive(),
    canPlay: () => !!player && !dead && !chatInputActive && !window.__BB_SITE_DIALOG_OPEN &&
      !mobileControlsController?.isEnabled?.() &&
      sceneParam.input.keyboard?.enabled !== false && sceneParam.sys.isActive(),
    onRelease: () => {
      resetPointerAttackAim();
      resetMovementInputState({ preserveVelocity: true });
    },
  });

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
      if (dead !== value) {
        endDash(player, false);
        if (player) { player._dashReadyAt = 0; player._dashHud?.hide(); }
      }
      dead = value;
    },
    getSuperCharge: () => superCharge,
    setSuperCharge: (value) => {
      superCharge = value;
    },
    setMaxSuperCharge: (value) => {
      maxSuperCharge = value;
    },
    stopWallSlideAudio: () => movementAudio.stopWallSlide(),
    onLocalDeath: () => {
      combatMouseController?.endDrag();
      resetMovementInputState();
      resetMovementVfxTracking();
      resetPointerAttackAim();
      updateHealthBar();
      setLocalUiVisible(false);
    },
    onLocalRespawn: () => {
      resetMovementInputState();
      resetMovementVfxTracking();
      resizeForDuckLocal?.(false);
      applyFlipOffsetLocal?.();
      player.body?.updateFromGameObject?.();
      setLocalUiVisible(true);
      syncLocalUiPosition();
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
    onDuckBlocked: () => playDuckBlockSound(scene),
    onAttackInterrupted: () => {
      isAttacking = false;
      combatMouseController?.endDrag();
      resetPointerAttackAim();
    },
  });

  if (!scene._localSocketEventsCleanupBound) {
    scene._localSocketEventsCleanupBound = true;
    const disposeLocalPlayerBindings = () => {
      scene.events.off("shutdown", disposeLocalPlayerBindings);
      scene.events.off("destroy", disposeLocalPlayerBindings);
      if (disposeLocalSocketEvents) {
        try {
          disposeLocalSocketEvents();
        } catch (_) {}
        disposeLocalSocketEvents = null;
      }
      resetPointerAttackAim();
      movementAudio.dispose();
      mobileControlsController?.destroy?.();
      detachPointerAttackBindings(sceneParam);
      clearGameCursor(sceneParam);
      try {
        attackAimReticleController?.destroy?.();
      } catch (_) {}
      attackAimReticleController = null;
      charEffects?.destroy?.();
      charEffects = null;
      scene._localSocketEventsCleanupBound = false;
    };
    scene.events.once("shutdown", disposeLocalPlayerBindings);
    scene.events.once("destroy", disposeLocalPlayerBindings);
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
  if (!shouldShow) {
    resetHealthBarAnimation(healthBar);
    resetSuperBarAnimation(superBar, player);
  }
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
    const showDuckShield = shouldShow && !dead && !!player?._ducking;
    duckShieldIcon?.setVisible(showDuckShield);
    duckShieldGlow?.setVisible(showDuckShield);
    if (!shouldShow) setStatusIconStackVisible(powerupStatusIcons, false);
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

function setLocalUiAlpha(alpha = 1) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  for (const item of [
    playerName,
    healthText,
    healthBar,
    duckShieldIcon,
    duckShieldGlow,
    ammoBar,
    ammoBarBack,
    superBar,
    superBarBack,
    indicatorTriangle,
  ]) {
    try {
      item?.setAlpha?.(safeAlpha);
    } catch (_) {}
  }
  setStatusIconStackAlpha(powerupStatusIcons, safeAlpha);
  try {
    const hudRoot = document.getElementById("hud");
    if (hudRoot) {
      hudRoot.style.transition = "opacity 180ms ease";
      hudRoot.style.opacity = powerupInvisible ? "0.48" : "";
    }
  } catch (_) {}
}

function drawIndicatorTriangle() {
  if (!indicatorTriangle || !player) return;
  indicatorTriangle.clear();
  const bodyTop = getStableLocalUiTop();
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

export function syncLocalUiPosition() {
  if (!player) return;
  const uiTop = getStableLocalUiTop();
  try {
    playerName?.setPosition(player.x, uiTop - 42);
  } catch (_) {}
  try {
    if (indicatorTriangle?.visible) drawIndicatorTriangle();
  } catch (_) {}
  updateHealthBar();
}

function getStableLocalUiTop() {
  if (Number.isFinite(player?._bbHudTopOffset)) return player.y + player._bbHudTopOffset;
  if (!player?.body) return player.y - player.height / 2;
  if (!player._ducking || !bodyConfig || !frame) return player.body.y;
  const standingHeight = Math.max(4, frame.realHeight - bodyConfig.heightShrink);
  return player.body.bottom - standingHeight * Math.abs(player.scaleY || 1) + 8;
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
  pdbg();

  const healthBarX = player.x - healthBarWidth / 2;
  const bodyTop = getStableLocalUiTop();
  // Always anchor to bodyTop so it doesn't jump when dead
  const y = bodyTop - 20; // just above body

  if (!dead) {
    healthText.setText(`${currentHealth}`);
  } else {
    // Show 0 instead of blank when dead
    healthText.setText(`0`);
  }

  drawHealthBar(healthBar, {
    x: healthBarX, y, width: healthBarWidth,
    health: currentHealth, maxHealth, color: 0xaebb50, teamGlowColor: 0x83dca6, isLocal: true,
  });
  healthBar.setDepth(RENDER_LAYERS.PLAYER_HUD + 1);

  const showDuckShield = !dead && !!player._ducking && healthBar.visible !== false;
  const shieldX = healthBarX + healthBarWidth + 1;
  const powerupX = healthBarX - 1;
  const shieldY = y + 4.5;
  duckShieldGlow?.setPosition(shieldX, shieldY).setVisible(showDuckShield);
  duckShieldIcon?.setPosition(shieldX, shieldY).setVisible(showDuckShield);
  syncStatusIconStack({
    scene,
    icons: powerupStatusIcons,
    effects: player?._powerupEffects,
    recentEffects: player?._recentPowerupEffects,
    x: powerupX,
    y: shieldY,
    visible: !dead && healthBar.visible !== false,
    startIndex: 0,
  });

  healthText.setPosition(player.x - healthText.width / 2, y - 8);
  healthText.setDepth(RENDER_LAYERS.PLAYER_HUD + 2);

  // Draw ammo bar underneath health (only for local player & when alive)
  drawAmmoBar(healthBarX, y + 11);
  drawSuperBar(healthBarX, y + 18);
}

function fireBasicAttack(direction, context = null) {
  if (dead || player?._dash || Date.now() < (player?._attackInterruptedUntil || 0)) return;
  try {
    if (player?.scene) {
      player.scene._localAttackPrecisionUntil = performance.now() + 420;
    }
  } catch (_) {}
  try {
    if (charCtrl && typeof charCtrl.attack === "function") {
      charCtrl.attack(direction, context);
    } else if (charCtrl && typeof charCtrl.handlePointerDown === "function") {
      charCtrl.handlePointerDown(context);
    }
  } catch (_) {}
}

function fireSpecialAttack(context = null) {
  if (dead || player?._dash || Date.now() < (player?._attackInterruptedUntil || 0)) return;
  if (superCharge < maxSuperCharge) {
    triggerSpecialNotReadyFeedback();
    return;
  }
  try {
    flushLocalNetState?.({
      dead,
      gameEnded: false,
      handlePlayerMovement,
    });
  } catch (_) {}
  const specialLockMs = characterPresentation(resolveCharacterKey(currentCharacter)).specialAnimationLockMs;
  if (specialLockMs && player) {
    player._specialAnimLockUntil = Date.now() + specialLockMs;
  }
  if (player) {
    markOneShotAnimation(player, "special", 1100);
  }
  try {
    if (player?.scene) {
      player.scene._localAttackPrecisionUntil = performance.now() + 520;
    }
  } catch (_) {}
  noteClientActionSent("special", { type: "special" });
  const specialRequest = { aim: serializeAimContext(context) };
  socket.emit("game:special", predictCharacterSpecial(
    currentCharacter, player?.scene, player, username, specialRequest,
  ));
}

function triggerSpecialNotReadyFeedback() {
  const now = Date.now();
  _specialNotReadyFlash = now + 500;
  if (now - lastNoSuperSfxAt < 120) return;
  lastNoSuperSfxAt = now;
  try {
    scene?.sound?.play("sfx-nosuper", { volume: 0.5 });
  } catch (_) {}
}

function drawSuperBar(x, y) {
  if (!superBar || !superBarBack) return;
  drawSuperChargeBar(superBar, superBarBack, {
    x, y, charge: superCharge, maxCharge: maxSuperCharge, player,
    notReady: Date.now() < _specialNotReadyFlash,
  });
}

function drawAmmoBar(forcedX, forcedY) {
  if (!ammoBar || !ammoBarBack) return;
  const shakeX =
    Date.now() < ammoBarShakeUntil ? Phaser.Math.Between(-3, 3) : 0;
  const x =
    (forcedX !== undefined ? forcedX : player.x - ammoBarWidth / 2) + shakeX;
  const bodyTop = getStableLocalUiTop();
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

// ---------------------------------------------------------------------------
// Per-frame local movement
// ---------------------------------------------------------------------------
// handlePlayerMovement runs every frame as an ordered pipeline. Each step
// reads the state produced by the previous ones, so the order matters:
// input gating -> dash -> physics limits -> input -> control locks -> actions
// -> ducking -> horizontal motion -> jumps -> wall slide -> airborne state ->
// presentation (effects, animation) -> replicated input state.

export function handlePlayerMovement(scene) {
  drawDashCooldown(scene, player, dead);
  mobileControlsController?.ensure?.(scene);
  mobileControlsController?.layout?.(scene);
  if (isLocalInputInactive(scene)) {
    applyInactiveInputFrame(scene);
    return;
  }
  const dashing = updateDashAndAmmo(scene);
  if (dashing) {
    applyDashFrame(scene);
    return;
  }

  enforceLockedFacing();
  const tuning = resolveMovementTuning();
  const shockwaveActive = (player._shockwaveUntil || 0) > Date.now();
  applyBodyLimits(tuning, shockwaveActive);

  const input = readMovementInput();
  const wall = resolveWallContact(player, scene._mapObjects || [], {
    left: input.left,
    right: input.right,
    upHeld: input.directionalUpHeld,
    jumpPressed: input.upFresh,
  });
  const locks = applyMovementLocks(scene, input);
  applyFastFallGravity(scene, wall, tuning);
  handleActionKeys();
  updateAimReticleVisibility();
  const ducking = updateDucking(scene, input, locks.movementLocked);
  applyHorizontalMovement(input, tuning, { ducking, shockwaveActive });

  const inputDirection = input.left && !input.right ? -1 : input.right && !input.left ? 1 : 0;
  applyDashCoast(player, inputDirection, tuning.maxSpeed);
  const groundSpeedRatio = movementFx.updateGroundMotion(scene, player, {
    inputDirection,
    maxSpeed: tuning.maxSpeed,
    dead,
    hidden: powerupInvisible,
    attacking: isAttacking,
  });
  updateJumping(scene, wall, tuning, {
    movementLocked: locks.movementLocked,
    shockwaveActive,
    groundSpeedRatio,
  });
  const isWallSliding = updateWallSlide(scene, wall, tuning, locks.movementLocked);
  movementFx.updateFalling(scene, player, { dead, sliding: isWallSliding, hidden: powerupInvisible });
  updateAirborneState(isWallSliding);

  updatePointerAttackAimState();
  syncLocalUiPosition();
  movementFx.updateLanding(scene, player, { dead, hidden: powerupInvisible });
  if (player.body.touching.down) player._lastGroundTime = Date.now();
  // Per-character effects update (e.g., Draven fire trail)
  if (charEffects && !powerupInvisible) {
    charEffects.update(scene.game.loop.delta, isMoving, dead);
  }
  movementFx.updateRunDust(scene, player, {
    dead,
    hidden: powerupInvisible,
    moving: isMoving,
    maxSpeed: tuning.maxSpeed,
  });

  presentMovementAnimation(scene, {
    wallSliding: isWallSliding,
    movementLocked: locks.movementLocked,
    lockedByAbility: locks.byAbility,
  });
  networkInputState = buildNetworkInputState({
    left: !!input.left,
    right: !!input.right,
    direction: inputDirection,
    jumpHeld: !!input.up,
    jumpPressed: !!input.upFresh,
    animation: getPresentedAnimation(player, "idle"),
    wallSliding: !!isWallSliding,
    wallSide: isWallSliding ? wall.wallSide || (player.flipX ? "left" : "right") : null,
    movementLocked: locks.movementLocked,
  });
}

function isLocalInputInactive(scene) {
  const desktopInputInactive =
    !!combatMouseController &&
    !mobileControlsController?.isEnabled?.() &&
    !combatMouseController.isActive();
  return (
    scene?.input?.keyboard?.enabled === false ||
    desktopInputInactive ||
    chatInputActive ||
    !!window.__BB_SITE_DIALOG_OPEN
  );
}

function isControlLocked(now = Date.now()) {
  return Math.max(
    Number(player?._movementLockedUntil || 0),
    Number(player?._externalControlLockUntil || 0),
  ) > now;
}

function isSpecialAnimationLocked() {
  return (player?._specialAnimLockUntil || 0) > Date.now();
}

function isLoadedForNetwork() {
  return !dead && Number.isFinite(player?.x) && Number.isFinite(player?.y) && player?.visible !== false;
}

// Replicated input snapshot; physics/facing fields always come from the body.
function buildNetworkInputState(fields) {
  return {
    grounded: !!player?.body?.touching?.down,
    ducking: !!player?._ducking,
    vx: Number(player?.body?.velocity?.x) || 0,
    vy: Number(player?.body?.velocity?.y) || 0,
    facing: player?.flipX ? -1 : 1,
    ...fields,
    ...getMovementFxNetworkState(),
    loaded: isLoadedForNetwork(),
  };
}

// Throw/special poses outrank the movement pose while they are playing.
function withActionPose(movementAnimation) {
  const presented = getPresentedAnimation(player, movementAnimation);
  return presented === "throw" || presented === "special" ? presented : movementAnimation;
}

// Controls are released (chat, dialogs, unfocused desktop window): drop
// input but keep animating and keep the HUD attached while physics continues.
function applyInactiveInputFrame(scene) {
  endDash(player);
  movementAudio.stopLoops();
  releaseMovementForFocus(player, {
    dragGround: MOVEMENT_PHYSICS.dragGround,
    dragAir: MOVEMENT_PHYSICS.dragAir,
    shockwaveActive: (player?._shockwaveUntil || 0) > Date.now(),
  });
  isMoving = false;
  const grounded = !!(player?.body?.touching?.down || player?.body?.blocked?.down);
  if (grounded) isJumping = false;
  const now = Date.now();
  const desiredMovementAnimation = deriveMovementAnimation({
    grounded,
    ducking: !!player?._ducking,
    moving: false,
    wallSliding: false,
    vx: Number(player?.body?.velocity?.x) || 0,
    vy: Number(player?.body?.velocity?.y) || 0,
    dead,
    movementLocked: isControlLocked(now),
    specialLocked: Number(player?._specialAnimLockUntil || 0) > now,
    fallback: getPresentedAnimation(player, "idle"),
  });
  const passiveAnimation = withActionPose(desiredMovementAnimation);
  playCharacterAnimation({
    scene,
    sprite: player,
    character: currentCharacter,
    skinId: currentSkinId,
    resolveAnimKey,
    logical: passiveAnimation,
    fallback: "idle",
    force: true,
  });
  // Input can be inactive while Arcade Physics still advances the body. Keep
  // all world-space HUD elements attached even while controls are released.
  syncLocalUiPosition();
  networkInputState = {
    left: false,
    right: false,
    direction: 0,
    jumpHeld: false,
    jumpPressed: false,
    grounded,
    vx: Number(player?.body?.velocity?.x) || 0,
    vy: Number(player?.body?.velocity?.y) || 0,
    facing: player?.flipX ? -1 : 1,
    animation: getPresentedAnimation(player, passiveAnimation),
    wallSliding: false,
    wallSide: null,
    ...getMovementFxNetworkState(),
    movementLocked: true,
    loaded: isLoadedForNetwork(),
  };
}

// Advances the dash and ammo reload. Returns true while a dash owns movement.
function updateDashAndAmmo(scene) {
  const now = Date.now();
  const dashing = updateDash(scene, player, {
    pressed: !!keySpace && Phaser.Input.Keyboard.JustDown(keySpace),
    left: cursors.left.isDown || movementKeys.left.isDown || !!mobileControlsController?.isMovingLeft?.(),
    right: cursors.right.isDown || movementKeys.right.isDown || !!mobileControlsController?.isMovingRight?.(),
    up: cursors.up.isDown || movementKeys.up.isDown,
    down: cursors.down.isDown || movementKeys.down.isDown,
    blocked: dead || isAttacking || Number(movementSpeedMult) <= 0 ||
      Math.max(player._movementLockedUntil || 0, player._externalControlLockUntil || 0,
        player._specialAnimLockUntil || 0, player._shockwaveUntil || 0,
        player._knockbackUntil || 0) > now,
    now,
    showEffect: !powerupInvisible,
  });
  if (ammoCharges < ammoCapacity) {
    reloadTimerMs += scene.game.loop.delta;
    if (reloadTimerMs >= ammoReloadMs) {
      reloadTimerMs = 0;
      ammoCharges = Math.min(ammoCapacity, ammoCharges + 1);
    }
  } else {
    reloadTimerMs = 0; // full, no reload progress
  }
  if (!dead) drawAmmoBar();
  return dashing;
}

function applyDashFrame(scene) {
  movementAudio.stopLoops();
  movementFx.clearWallSlide();
  isMoving = true;
  player._wallAttachSide = null;
  player._wallAttachStartedAt = null;
  applyFlipOffsetLocal?.();
  playCharacterAnimation({ scene, sprite: player, character: currentCharacter,
    skinId: currentSkinId, resolveAnimKey, logical: "dashing", fallback: "falling", force: true });
  syncLocalUiPosition();
  networkInputState = {
    direction: player._dash.inputX || 0, jumpHeld: false, jumpPressed: false,
    grounded: !!player.body.touching.down, ducking: !!player._ducking,
    vx: player.body.velocity.x, vy: player.body.velocity.y,
    facing: player.flipX ? -1 : 1, animation: "dashing",
    wallSliding: false, wallSide: null, ...getMovementFxNetworkState(),
    movementLocked: false, loaded: !dead && player.visible !== false,
  };
}

// Attacks such as Draven's splash lock facing; enforce it before movement
// logic can flip the sprite.
function enforceLockedFacing() {
  if (player._lockFlip && player._lockedFlipX !== undefined && player.flipX !== player._lockedFlipX) {
    player.flipX = player._lockedFlipX;
    applyFlipOffsetLocal?.();
  }
}

function setFacingLeft(left) {
  const wasFlip = player.flipX;
  if (!player._lockFlip) {
    player.flipX = left;
  } else if (player._lockedFlipX !== undefined) {
    player.flipX = player._lockedFlipX;
  }
  if (player.flipX !== wasFlip) applyFlipOffsetLocal?.();
}

// Shared movement constants (mirrored on the server for prediction) scaled
// by the current speed/jump effects.
function resolveMovementTuning() {
  const effectScale = (mult) =>
    Number(mult) <= 0 ? 0 : Math.max(MOVEMENT_PHYSICS.minSpeedMult, mult || 1);
  return {
    ...MOVEMENT_PHYSICS,
    maxSpeed: MOVEMENT_PHYSICS.maxSpeed * effectScale(movementSpeedMult),
    jumpScale: effectScale(movementJumpMult),
    wallKickVerticalMult: MOVEMENT_PHYSICS.wallKickVerticalMult,
    wallSlideReentryDelayMs: MOVEMENT_PHYSICS.wallSlideReentryDelayMs,
  };
}

function applyBodyLimits(tuning, shockwaveActive) {
  if (player.body) {
    player.setDragX(player.body.touching.down ? tuning.dragGround : tuning.dragAir);
    const coasting = shockwaveActive || (player._dashCoastUntil || 0) > Date.now();
    player.setMaxVelocity(
      coasting ? Math.max(tuning.maxSpeed, Math.abs(player.body.velocity.x)) : tuning.maxSpeed,
      shockwaveActive ? Math.max(tuning.maxVerticalSpeed, Math.abs(player.body.velocity.y)) : tuning.maxVerticalSpeed,
    );
  }
  // Track last grounded time for coyote jumping.
  player._lastGroundTime = player.body.touching.down ? Date.now() : player._lastGroundTime || 0;
}

// Arrow keys, WASD (or rebound keys) and mobile controls.
function readMovementInput() {
  const directionalUpHeld = cursors.up.isDown || movementKeys.up.isDown;
  const directionalUpFresh =
    Phaser.Input.Keyboard.JustDown(cursors.up) || Phaser.Input.Keyboard.JustDown(movementKeys.up);
  const jumpButtonFresh = !!mobileControlsController?.consumeJumpFreshPress?.();
  return {
    left: cursors.left.isDown || movementKeys.left.isDown || !!mobileControlsController?.isMovingLeft?.(),
    right: cursors.right.isDown || movementKeys.right.isDown || !!mobileControlsController?.isMovingRight?.(),
    up: directionalUpHeld || !!mobileControlsController?.isJumpHeld?.(),
    upFresh: directionalUpFresh || jumpButtonFresh,
    down: cursors.down.isDown || movementKeys.down.isDown,
    directionalUpHeld,
  };
}

// External locks (e.g. being pulled by a Gloop hook) and ability locks (e.g.
// Draven's Inferno) suppress movement input and gravity for their duration.
function applyMovementLocks(scene, input) {
  const now = Date.now();
  const byAbility = (player?._movementLockedUntil || 0) > now;
  const byExternal = (player?._externalControlLockUntil || 0) > now;
  const freeze = () => {
    input.left = false;
    input.right = false;
    input.up = false;
    if (player.body) {
      player.setAccelerationX(0);
      player.setVelocityX(0);
    }
  };
  if (byExternal) {
    freeze();
    if (player.body) {
      if (player._externalControlPrevGravity === undefined) {
        player._externalControlPrevGravity = !!player.body.allowGravity;
      }
      player.body.allowGravity = false;
    }
  } else if (player.body && player._externalControlPrevGravity !== undefined) {
    player.body.allowGravity =
      typeof player._externalControlPrevGravity === "boolean" ? player._externalControlPrevGravity : true;
    delete player._externalControlPrevGravity;
  }
  if (byAbility) {
    freeze();
    if (player.body) player.body.allowGravity = false;
  }
  getCharacterClassByKey(currentCharacter)?.updateMovementLock?.(scene, player, { locked: byAbility, now });
  return { byAbility, byExternal, movementLocked: byAbility || byExternal };
}

// Fast-fall: additive per-body gravity so total ~= world gravity * factor,
// only while falling freely (not wall sliding or dash coasting).
function applyFastFallGravity(scene, wall, tuning) {
  try {
    const worldG = scene.physics?.world?.gravity?.y || 0;
    const falling = !player.body.touching.down && (player.body.velocity.y || 0) > tuning.fallGravityMinSpeed;
    if (
      falling &&
      (!wall.wallSlideContact || wall.wallSlideSuppressed) &&
      tuning.fallGravityFactor > 1 &&
      Date.now() >= (player._dashCoastUntil || 0)
    ) {
      player.body.setGravityY(worldG * (tuning.fallGravityFactor - 1));
    } else {
      player.body.setGravityY(0);
    }
  } catch (_) {}
}

// Keyboard attack (J), special (I) and mode interaction (E).
function handleActionKeys() {
  try {
    const pressed = (key) => key && Phaser.Input.Keyboard.JustDown(key) && !dead;
    if (pressed(keyJ) && !isControlLocked()) {
      const context = resolveQuickAttackContext("basic");
      fireBasicAttack(context.direction, context);
    }
    if (pressed(keyI) && !isControlLocked()) {
      fireSpecialAttack(resolveQuickAttackContext("special"));
    }
    if (pressed(keyE) && !isControlLocked()) {
      noteClientActionSent("mode-interact", { type: "mode-interact" });
      socket.emit("game:action", { type: "mode-interact" });
    }
  } catch (_) {}
}

function updateAimReticleVisibility() {
  if (mobileControlsController?.isEnabled?.()) {
    mobileControlsController.updateReticle(attackAimReticleController);
  } else if (!attackAimState.active) {
    clearAttackAimReticle();
  }
}

// Ducking holds only on a supported ground span and cannot stand up into a
// ceiling. May cancel this frame's jump input. Returns whether ducking.
function updateDucking(scene, input, movementLocked) {
  const grounded = !!(player.body.touching.down || player.body.blocked.down);
  const groundSpan = grounded ? findGroundSpan(player.body, scene._mapObjects || []) : null;
  const wantsToDuck = input.down && !input.up && !movementLocked && !dead;
  player._duckRequested = wantsToDuck;
  let ducking = !!player._ducking;
  if (!ducking && wantsToDuck && Date.now() >= (player._duckAvailableAt || 0) && grounded && groundSpan) {
    ducking = true;
    player._duckGroundSpan = groundSpan;
  } else if (ducking && !player._duckGroundSpan && wantsToDuck && grounded && groundSpan) {
    player._duckGroundSpan = groundSpan;
  } else if (ducking && (!wantsToDuck || player.body.velocity.y < -5)) {
    ducking = false;
  } else if (ducking && !player._duckGroundSpan && !grounded) {
    ducking = false;
  }
  if (player._ducking && !ducking && grounded && !dead) {
    const standingHeight = Math.max(4, frame.realHeight - bodyConfig.heightShrink);
    const extraHeight = standingHeight * Math.abs(player.scaleY || 1) - player.body.height;
    if (!hasStandingClearance(player.body, scene._mapObjects || [], extraHeight)) {
      ducking = true;
      input.up = false;
      input.upFresh = false;
      player._lastJumpPressTime = 0;
    }
  }
  const wasDucking = !!player._ducking;
  resizeForDuckLocal?.(ducking);
  if (wasDucking && !ducking) {
    player._duckAvailableAt = Date.now() + DUCK_REENTRY_DELAY_MS;
  }
  if (!ducking) {
    player._duckGroundSpan = null;
  }
  return ducking;
}

function hideSpawnIndicator() {
  if (!indicatorTriangle) return;
  indicatorTriangle.clear();
  indicatorTriangle.setVisible(false);
}

function applyHorizontalMovement(input, tuning, { ducking, shockwaveActive }) {
  if (ducking && !shockwaveActive) {
    const duckMaxSpeed = tuning.maxSpeed * DUCK_SPEED_RATIO;
    player.setMaxVelocity(duckMaxSpeed, MOVEMENT_PHYSICS.maxVerticalSpeed);
    if (Math.abs(player.body.velocity.x) > duckMaxSpeed) {
      player.setVelocityX(Math.sign(player.body.velocity.x) * duckMaxSpeed);
    }
  }
  const onGround = player.body.touching.down;
  const accelerate = (direction) => {
    // A wall kick briefly ignores input opposing its direction.
    const kickLocked = (player._wallKickLockUntil || 0) > Date.now();
    if (kickLocked && Math.sign(player.body.velocity.x || 0) === -direction) {
      player.setAccelerationX(0);
    } else {
      player.setAccelerationX(direction * (onGround ? tuning.accel : tuning.airAccel));
    }
    player.setDragX(onGround ? tuning.dragGround : tuning.dragAir);
  };
  if (input.left) {
    hideSpawnIndicator();
    accelerate(-1);
    setFacingLeft(true);
    isMoving = true;
  } else if (input.right) {
    hideSpawnIndicator();
    setFacingLeft(false);
    accelerate(1);
    isMoving = true;
  } else {
    // Stop applying acceleration and let drag slow the player naturally.
    player.setAccelerationX(0);
    player.setDragX(onGround ? tuning.dragGround : tuning.dragAir);
    if (player._lockFlip && player._lockedFlipX !== undefined) {
      player.flipX = player._lockedFlipX;
    }
    isMoving = false;
  }
  if (shockwaveActive) {
    player.setAccelerationX(0);
    player.setDragX(0);
  }
}

function playJumpAnimation(scene, wallJump = false) {
  if (isAttacking || isSpecialAnimationLocked()) return;
  if (wallJump) markWallJumpAnimation(player);
  else resetAirborneJumpAnimation(player);
  playCharacterAnimation({
    scene,
    sprite: player,
    character: currentCharacter,
    skinId: currentSkinId,
    resolveAnimKey,
    logical: "jumping",
    fallback: "idle",
    force: true,
  });
}

// Wall jumps take priority over ground/coyote jumps; a started jump ramps
// its launch speed over jumpRampMs.
function updateJumping(scene, wall, tuning, { movementLocked, shockwaveActive, groundSpeedRatio }) {
  const now = Date.now();
  const body = player.body;
  if (
    !dead && !movementLocked && wall.effectiveWallSide && !body.touching.down &&
    !shockwaveActive && canWallJump && wall.bufferedJumpPressActive
  ) {
    performWallJump(scene, wall.effectiveWallSide, tuning);
    scene.sound.play("sfx-walljump", {
      volume: 0.5,
      rate: 0.96 + Phaser.Math.Clamp(Math.abs(body.velocity.x) / 720, 0, 0.08),
    });
    player._lastJumpPressTime = 0;
  } else if (
    wall.bufferedJumpPressActive && !shockwaveActive && !movementLocked &&
    (body.touching.down || now - (player._lastGroundTime || 0) <= tuning.coyoteTimeMs) &&
    !dead
  ) {
    hideSpawnIndicator();
    // Slight jump boost when moving fast to feel snappier transitions.
    const boost = Phaser.Math.Clamp(
      (Math.abs(body.velocity.x || 0) / tuning.maxSpeed) * tuning.jumpBoost, 0, tuning.jumpBoost);
    performJump(scene, (tuning.jumpSpeed + boost) * tuning.jumpScale);
    scene.sound.play("sfx-jump", {
      volume: 0.36 + groundSpeedRatio * 0.1,
      rate: 0.96 + groundSpeedRatio * 0.08,
    });
    player._lastJumpPressTime = 0;
    if (wall.wallSlideContact || wall.effectiveWallSide) {
      player._wallSlideSuppressedUntil = Date.now() + tuning.wallSlideReentryDelayMs;
    }
  }
  const launch = player._jumpLaunch;
  if (launch) {
    // Floor contact can still be set on the first frame after takeoff.
    if (dead || movementLocked || body.blocked.up || body.touching.up || body.velocity.y >= 0) {
      player._jumpLaunch = null;
    } else {
      const t = Math.min(1, (Date.now() - launch.startedAt) / tuning.jumpRampMs);
      player.setVelocityY(launch.vy * (tuning.jumpStartSpeedRatio + (1 - tuning.jumpStartSpeedRatio) * t));
      if (t >= 1) player._jumpLaunch = null;
    }
  }
}

function performJump(scene, jumpSpeed) {
  player._dashCoastUntil = 0;
  if (player.body?.touching?.down && !powerupInvisible) {
    const body = player.body;
    spawnJumpTakeoff(
      scene,
      Number(body.center?.x) || player.x,
      (Number(body.bottom) || player.y + player.height * 0.5) - 2,
      { bodyWidth: Number(body.width) || player.displayWidth, velocityX: Number(body.velocity?.x) || 0 },
    );
    noteMovementFxEvent("jump", { direction: Math.sign(Number(body.velocity?.x) || 0) });
  }
  playJumpAnimation(scene);
  pdbg();
  player._jumpLaunch = { startedAt: Date.now(), vy: -jumpSpeed * MOVEMENT_PHYSICS.jumpLaunchSpeedMult };
  player.setVelocityY(player._jumpLaunch.vy * MOVEMENT_PHYSICS.jumpStartSpeedRatio);
  isMoving = true;
  isJumping = true;
}

// Physics-impulse wall jump away from `wallSide`, with a short re-jump
// cooldown and an input lock so the kick carries.
function performWallJump(scene, wallSide, tuning) {
  player._dashCoastUntil = 0;
  player._wallSlideSuppressedUntil = Date.now() + tuning.wallSlideReentryDelayMs;
  player._jumpLaunch = null;
  movementAudio.updateWallSlide(false);
  canWallJump = false;
  const fromLeft = wallSide === "left";
  const vertKick = Math.max(tuning.jumpSpeed + tuning.wallKickVerticalBonus, tuning.wallKickMinVerticalSpeed) * Math.max(0.1, tuning.wallKickVerticalMult);

  // Face away from the wall (or reinforce a locked facing).
  if (!player._lockFlip) setFacingLeft(!fromLeft);
  else enforceLockedFacing();
  playJumpAnimation(scene, true);
  pdbg();

  // Visual-only kickback cloud at the wall contact point.
  try {
    const body = player.body;
    const contactX = body
      ? body.x + (fromLeft ? 0 : body.width)
      : player.x + (fromLeft ? -player.width * 0.5 : player.width * 0.5);
    const contactY = body ? body.y + body.height * 0.62 : player.y + player.height * 0.18;
    if (!powerupInvisible) spawnWallKickCloud(scene, contactX, contactY, fromLeft ? 1 : -1);
  } catch (_) {}
  noteMovementFxEvent("wall-jump", { direction: fromLeft ? 1 : -1, wallSide: fromLeft ? "left" : "right" });
  triggerWallJumpCameraKick(scene, fromLeft ? 1 : -1);

  // Nudge away from the wall first so the body does not stay embedded.
  player.x += fromLeft ? 8 : -8;
  player.setVelocityX(fromLeft ? tuning.wallKickFull : -tuning.wallKickFull);
  player.setVelocityY(-vertKick);
  player.setDragX(tuning.dragAir);
  scene.time.delayedCall(tuning.wallJumpCooldownMs, () => {
    canWallJump = true;
  });
  player._wallKickLockUntil = Date.now() + tuning.wallKickLockMs;
}

function updateWallSlide(scene, wall, tuning, movementLocked) {
  const sliding = applyWallSlide(player, {
    dead, movementLocked, wallSlideContact: wall.wallSlideContact, wallSide: wall.wallSide,
    wallBrakeHeld: wall.wallBrakeHeld,
  });
  if (sliding && !player._lockFlip) {
    const wasFlip = player.flipX;
    player.flipX = resolveWallSlideFlipX(wall.wallSide, player.body.velocity.x, player.flipX);
    if (player.flipX !== wasFlip) applyFlipOffsetLocal?.();
  }
  movementFx.updateWallSlide(scene, player, {
    sliding,
    wallSide: wall.wallSide,
    maxFallSpeed: tuning.wallSlideMaxFallSpeed,
    hidden: powerupInvisible,
  });
  return sliding;
}

// Clears the jump state once the jump animation ends in the air, and stops
// the slide scrape when idle on the ground.
function updateAirborneState(isWallSliding) {
  if (!player.anims.isPlaying && !player.body.touching.down && !isWallSliding && !isAttacking) {
    movementAudio.updateWallSlide(false);
    pdbg();
    isJumping = false;
  }
  if (!isMoving && player.body.touching.down && !isJumping && !isAttacking && !dead) {
    movementAudio.updateWallSlide(false);
    pdbg();
  }
}

function presentMovementAnimation(scene, { wallSliding, movementLocked, lockedByAbility }) {
  const visualWallSliding = holdWallSlidePose(player, {
    sliding: wallSliding,
    grounded: !!player?.body?.touching?.down,
  });
  let desired = deriveMovementAnimation({
    grounded: !!player?.body?.touching?.down,
    ducking: !!player?._ducking,
    moving: !!isMoving,
    wallSliding: visualWallSliding,
    vx: Number(player?.body?.velocity?.x) || 0,
    vy: Number(player?.body?.velocity?.y) || 0,
    dead,
    movementLocked,
    specialLocked: isSpecialAnimationLocked(),
    fallback: getPresentedAnimation(player, "idle"),
  });
  const abilityLockAnimation = characterPresentation(resolveCharacterKey(currentCharacter)).abilityLockAnimation;
  if (lockedByAbility && abilityLockAnimation) desired = abilityLockAnimation;
  playCharacterAnimation({
    scene,
    sprite: player,
    character: currentCharacter,
    skinId: currentSkinId,
    resolveAnimKey,
    logical: withActionPose(desired),
    fallback: "idle",
    // Phaser's second play argument means "ignore if already playing".
    // Keep it enabled so the one-frame duck pose is not restarted every tick.
    force: true,
  });
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

export function getPlayerTutorialState() {
  return {
    health: Number(currentHealth) || 0,
    maxHealth: Math.max(1, Number(maxHealth) || 1),
    healthRatio: Math.max(
      0,
      Math.min(1, (Number(currentHealth) || 0) / Math.max(1, Number(maxHealth) || 1)),
    ),
    superCharge: Number(superCharge) || 0,
    maxSuperCharge: Math.max(1, Number(maxSuperCharge) || 1),
    superRatio: Math.max(
      0,
      Math.min(1, (Number(superCharge) || 0) / Math.max(1, Number(maxSuperCharge) || 1)),
    ),
  };
}

export function setLocalNetStateFlusher(fn) {
  flushLocalNetState = typeof fn === "function" ? fn : null;
}

export function setChatInputActive(active) {
  chatInputActive = !!active;
  if (chatInputActive || window.__BB_SITE_DIALOG_OPEN) {
    combatMouseController?.release();
    resetPointerAttackAim();
    resetMovementInputState({ preserveVelocity: true });
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

// Keep browser focus on the arena during the pre-fight countdown without
// enabling movement before the HUD declares the fight live.
export function focusBattleInput() {
  return combatMouseController?.prepareForBattle?.() || false;
}

export function setPowerupMobility(speedMult = 1, jumpMult = 1) {
  return localStateSync.setPowerupMobility(speedMult, jumpMult);
}

export function setPowerupInvisible(active = false) {
  const nextInvisible = active === true;
  const changed = nextInvisible !== powerupInvisible;
  powerupInvisible = nextInvisible;
  if (player?.active) {
    player._powerupInvisible = powerupInvisible;
    if (powerupInvisible || changed) {
      player.setAlpha(powerupInvisible ? 0.2 : 1);
    }
  }
  if (changed) {
    setLocalUiVisible(!dead);
    setLocalUiAlpha(powerupInvisible ? 0.42 : 1);
  }
}

export function setExternalControlLockUntil(untilMs = 0) {
  if (!player) return;
  const until = Number(untilMs);
  player._externalControlLockUntil = Number.isFinite(until)
    ? Math.max(0, until)
    : 0;
}

export function destroyMobileControls() {
  combatMouseController?.destroy();
  combatMouseController = null;
  try {
    mobileControlsController?.destroy?.();
  } catch (_) {}
  mobileControlsController = null;
}

export { player, frame, currentHealth, setCurrentHealth, dead };
