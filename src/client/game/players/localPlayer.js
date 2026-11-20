import { getMatchSession } from "../../lib/globals.cjs";
import { isSiteDialogOpen } from "../../site/dialog";
import { createLocalPointerAttack, serializeAimContext } from "./localPointerAttack";
import { createLocalHud } from "./localHud";
import { standingBodyHeight, applyBodyFlipOffset, hudTopY } from "./playerBodyGeometry";
import { createLocalAmmo } from "./localAmmo";
import { SOCKET_EVENTS } from "../../../shared/net/socketEvents.js";
import { updateDash, endDash, drawDashCooldown, protectDashMotion, applyDashCoast } from '../scene/dash';
import { integrateLikeReferenceStep } from '../scene/displayRatePhysics';
import { spritePresentation, sizePlayerBody } from '../characters/shared/spritePresentation';
import { bindPlayerOrigin } from "../characters/shared/rig";
import { attachTeamFootRing } from './teamFootRing';
import { applyTeamVisual } from "../../../shared/projectilePresentation";
import { getSettings, subscribeSettings } from "../../site/preferences";
import {
  resolveWallContact,
  applyWallSlide,
  resolveWallSlideFlipX,
} from './wallMovement';
import { predictCharacterSpecial } from '../characters/networkRegistry';
import { withShotView } from '../characters/shared/shotPrediction';
import socket from "../../lib/socket";
import {
  createFor as createCharacterFor,
  getTextureKey,
  getCharacterClassByKey,
  resolveAnimKey,
  getStats,
  getEffectsClass,
} from "../characters";
import {
  spawnChromaReveal,
  spawnHealthMarker,
  spawnJumpTakeoff,
  spawnSpawnBurst,
  spawnWallKickCloud, wallContactPoint, MOVEMENT_VFX_CONFIG,
} from "../scene/effects";
import { bindLocalSocketEvents } from "./localSocketEvents";
import { INVISIBLE_ALPHA, invisibleAttackAlpha } from "../powerups/invisibilityReveal.js";
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
  playSpriteAnimation,
  activeAction,
  resetAirborneJumpAnimation,
  markWallJumpAnimation,
  holdWallSlidePose,
} from "../characters/shared/animationState.js";
import { createMobileControlsController } from "../scene/mobileControls";
import { releaseMovementForFocus } from "./focusMomentum.mjs";
import { RENDER_LAYERS } from "../scene/renderLayers";
import { triggerWallJumpCameraKick } from "../scene/cameraDynamics";
import MOVEMENT_PHYSICS from "../../../shared/physics/movementPhysics.json";
import {
  DUCK_HEIGHT_RATIO,
  DUCK_SPEED_RATIO,
  DUCK_REENTRY_DELAY_MS,
  updateDuckRequest,
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

let dead = false; // Live export also consumed by the Phaser scene.
const localStats = {
  currentHealth: 1000, maxHealth: 1000, superCharge: 0, maxSuperCharge: 100,
  get dead() { return dead; },
  set dead(value) {
    if (dead !== value) {
      endDash(player, false);
      if (player) { player._dashReadyAt = 0; player._dashHud?.hide(); }
    }
    dead = value;
    mobileControlsController?.setHidden?.(!!value);
  },
};

// Ammo/Cooldown bar (client-side only)
let localHud = null;
const ammo = createLocalAmmo();
let ammoBarShakeUntil = 0;
let lastNoAmmoSfxAt = 0;
let lastNoSuperSfxAt = 0;

let keyI;
let keyE;
let _specialNotReadyFlash = 0; // timestamp until "not ready" red flash expires
let movementSpeedMult = 1;
let movementJumpMult = 1;
let powerupInvisible = false;

let username;

let scene;
// Persist the selected character so movement helpers can resolve anim keys
let currentCharacter;
let currentSkinId = "";

let opponentPlayersRef; // injected from game.js to avoid circular import

// Body config and flip-offset applier hoisted for use across functions
let bodyConfig = null;
let applyFlipOffsetLocal = null;
let resizeForDuckLocal = null;
let charEffects = null; // per-character, per-player effects handler (e.g., Draven fire)
let charCtrl = null; // active character controller instance
let localSocketEvents = null;
let disposePlayerLifetime = null;
export function getLocalFighterEvents() { return localSocketEvents; }
let flushLocalNetState = null;
let pointerAttack = null;
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
    player._jumpConsumed = false;
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

  networkInputState = buildNetworkInputState({
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
  }, { derive: false });
}

const idleNetworkInputState = {
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
let networkInputState = { ...idleNetworkInputState };
let chatInputActive = false;

const localStateSync = createLocalStateSync({
  getPlayer: () => player,
  stats: localStats,
  ammo,
  setMovementSpeedMult: (value) => {
    movementSpeedMult = value;
  },
  setMovementJumpMult: (value) => {
    movementJumpMult = value;
  },
  updateHealthBar: () => updateHealthBar(),
});

export function createPlayer(sceneParam, {
  username: name,
  getPlayerEffects,
  character,
  opponentPlayers,
  isSystemNoticeOpen,
  skinId = "",
}) {
  disposePlayerLifetime?.();
  canWallJump = true;
  canAttack = true;
  isMoving = false;
  isAttacking = false;
  chatInputActive = false;
  powerupInvisible = false;
  setPowerupMobility();
  networkInputState = { ...idleNetworkInputState };
  latestMovementFxEvent = { seq: movementFxSequence, type: null, direction: 0, wallSide: null, fallDistance: 0, impactVelocity: 0 };
  resetMovementVfxTracking();
  pointerAttack = createLocalPointerAttack(sceneParam, character, opponentPlayers, localStats, {
    getAmmoCharges: () => ammo.state.charges, getMobileControls: () => mobileControlsController,
    isUiCapturingInput, isSystemNoticeOpen, isControlLocked, triggerSpecialNotReadyFeedback,
    fireBasicAttack, fireSpecialAttack, resetMovementInputState,
  });
  if (!mobileControlsController) {
    mobileControlsController = createMobileControlsController({
      getPlayer: () => player,
      getPointerAimActive: () => !!pointerAttack?.active,
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
      resolveQuickContext: (family) => pointerAttack?.quick(family),
      getSuperChargeRatio: () => (localStats.maxSuperCharge > 0 ? localStats.superCharge / localStats.maxSuperCharge : 0),
      onBasicFire: (context) => fireBasicAttack(context?.direction, context),
      onSpecialFire: (context) => fireSpecialAttack(context),
      onSpecialNotReady: () => triggerSpecialNotReadyFeedback(),
      onClearReticle: () => pointerAttack?.clearReticle(),
    });
  }
  mobileControlsController.ensure(sceneParam);

  username = name;
  scene = sceneParam;
  opponentPlayersRef = opponentPlayers;
  // Remember the chosen character for animation resolution in update loop
  currentCharacter = character;
  currentSkinId = String(skinId || "").trim();
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

  movementAudio.attach(scene);

  // Animations are registered globally in game.js via setupAll(scene)

  player = scene.physics.add.sprite(-100, -100, getTextureKey(character, currentSkinId));
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

  // Apply character stats (health, ammo, sprite/body sizing)
  const stats = getStats(character);
  // Prefer server-provided per-match stats when available
  const sessionStats = getMatchSession()?.stats || null;
  if (sessionStats && typeof sessionStats.health === "number") {
    localStats.maxHealth = sessionStats.health;
  } else if (typeof stats.baseHealth === "number") {
    localStats.maxHealth = stats.baseHealth;
  }
  localStats.currentHealth = localStats.maxHealth;
  localStats.dead = false;
  localStats.superCharge = 0;
  localStats.maxSuperCharge = 100;
  ammoBarShakeUntil = lastNoAmmoSfxAt = lastNoSuperSfxAt = _specialNotReadyFlash = 0;
  ammo.reset(stats);
  const presentation = spritePresentation(character, player.texture);
  player.setScale(presentation.scale);
  attachTeamFootRing(scene, player, { isAlly: true, isSelf: true, hidden: () => dead });
  player.setOrigin(presentation.originX, presentation.originY);
  bindPlayerOrigin(player, presentation);
  player._bbHudTopOffset = presentation.hudTopOffset;

  // Establish frame/body sizing BEFORE computing spawn so height math is correct
  frame = player.frame;
  bodyConfig = presentation.body;
  sizePlayerBody(player, frame, bodyConfig);
  player._ducking = false;
  player._duckRequested = false;
  player._duckAvailableAt = 0;
  player._duckHoldUntil = 0;
  player._duckGroundSpan = null;
  // Helper to adjust body offset when flipping
  applyFlipOffsetLocal = () => applyBodyFlipOffset(player, frame, bodyConfig);
  applyFlipOffsetLocal();

  resizeForDuckLocal = (ducking) => {
    if (!player?.body || player._ducking === !!ducking) return;
    const body = player.body;
    const standingHeight = standingBodyHeight(player, frame, bodyConfig);
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
  // Jumps and falls follow the same path at every refresh rate.
  const restoreIntegration = integrateLikeReferenceStep(player.body);
  // Arcade writes the frame's step back to the sprite in postupdate, after
  // the scene's update. Placing the name, bars and icons there keeps them on
  // the sprite drawn this frame instead of one frame behind it.
  const syncUiAfterPhysics = () => { if (!dead && player?.visible) syncLocalUiPosition(); };
  scene.events.on("postupdate", syncUiAfterPhysics);

  // Falling out of the world is detected by the server from position packets.

  // Keep the local player hidden until the scene finishes spawn placement and any
  // reconnect position restore. That removes the first-frame pop from -100,-100.
  player.setVisible(false);

  // Set depth so player renders above all map objects (bank bust graphics are at depths 7-24)
  player.setDepth(RENDER_LAYERS.PLAYER);

  localHud?.destroy();
  localHud = createLocalHud(scene, player, {
    username, getPlayerEffects, stats: localStats, ammo, getStableLocalUiTop,
    isInvisible: () => powerupInvisible, clearAttackAimReticle: () => pointerAttack?.clearReticle(),
    superFlashActive: () => Date.now() < _specialNotReadyFlash,
    ammoShakeActive: () => Date.now() < ammoBarShakeUntil,
  });

  // Character controller wiring (centralized per character)
  const fighter = player;
  const ammoHooks = {
    // stats
    getAmmoCapacity: () => ammo.state.capacity,
    getAmmoCooldownMs: () => ammo.state.cooldownMs,
    getAmmoReloadMs: () => ammo.state.reloadMs,
    // state
    getCharges: () => ammo.state.charges,
    getNextFireTime: () => ammo.nextFireAt,
    // actions
    triggerNoAmmoFeedback: (playSound = true) => {
      if (player !== fighter) return;
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
      if (player !== fighter || fighter._dash) return false;
      const now = Date.now();
      if (!canAttack) {
        if (ammo.state.charges <= 0) ammoHooks.triggerNoAmmoFeedback(true);
        else if (now < ammo.nextFireAt) ammoHooks.triggerNoAmmoFeedback(false);
        return false;
      }
      if (now < ammo.nextFireAt) {
        ammoHooks.triggerNoAmmoFeedback(false);
        return false;
      }
      if (ammo.state.charges <= 0) {
        ammoHooks.triggerNoAmmoFeedback(true);
        return false;
      }
      return ammo.consume(now);
    },
    grantCharge: (n = 1) => {
      if (player !== fighter) return;
      ammo.grant(n);
      localHud?.drawAmmoBar();
    },
    setCanAttack: (v) => {
      if (player === fighter) canAttack = v;
    },
    setIsAttacking: (v) => {
      if (player !== fighter) return;
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
      if (player !== fighter) return;
      try {
        flushLocalNetState?.({
          dead,
          gameEnded: false,
          handlePlayerMovement,
        });
      } catch (_) {}
    },
    // view
    drawAmmoBar: () => { if (player === fighter) localHud?.drawAmmoBar(); },
  };

  const ctrl = createCharacterFor(character, {
    scene,
    player,
    username,
    opponentPlayersRef,
    ammoHooks,
  });
  charCtrl = ctrl;

  pointerAttack.bind(player);

  // Per-character effects: instantiate if the character provides an Effects class
  const EffectsCls = getEffectsClass(currentCharacter);
  charEffects = EffectsCls ? new EffectsCls(scene, player) : null;

  localSocketEvents = bindLocalSocketEvents({
    socket,
    getUsername: () => username,
    getScene: () => scene,
    getPlayer: () => player,
    getCurrentCharacter: () => currentCharacter,
    getOpponentPlayersRef: () => opponentPlayersRef,
    spawnHealthMarker,
    updateHealthBar,
    stats: localStats,
    stopWallSlideAudio: () => movementAudio.stopWallSlide(),
    onLocalDeath: () => {
      pointerAttack?.mouse?.endDrag();
      resetMovementInputState();
      resetMovementVfxTracking();
      pointerAttack?.reset();
      updateHealthBar();
      localHud?.setLocalUiVisible(false);
    },
    onLocalRespawn: () => {
      resetMovementInputState();
      resetMovementVfxTracking();
      resizeForDuckLocal?.(false);
      applyFlipOffsetLocal?.();
      player.body?.updateFromGameObject?.();
      localHud?.setLocalUiVisible(true);
      syncLocalUiPosition();
      try {
        localHud?.showIndicator();
      } catch (_) {}
    },
    removeLocalCorpse: () => {
      try {
        player?.setVisible(false);
      } catch (_) {}
    },
    onDuckBlocked: () => playDuckBlockSound(scene),
    onAttackInterrupted: () => {
      isAttacking = false;
      pointerAttack?.mouse?.endDrag();
      pointerAttack?.reset();
    },
  });

  const dispose = () => {
    sceneParam.events.off("shutdown", dispose);
    sceneParam.events.off("destroy", dispose);
    if (disposePlayerLifetime !== dispose) return;
    disposePlayerLifetime = null;
    stopKeyUpdates();
    sceneParam.physics.world.off("worldstep", protectDuckEdge);
    sceneParam.physics.world.off("worldstep", protectDash);
    sceneParam.events.off("postupdate", syncUiAfterPhysics);
    restoreIntegration();
    localHud?.destroy();
    localHud = null;
    localSocketEvents?.dispose();
    localSocketEvents = null;
    destroyMobileControls();
    movementAudio.dispose();
    charEffects?.destroy?.();
    charEffects = null;
    charCtrl = null;
    sceneParam._localPlayerAudioSprite = null;
    player = null;
    scene = null;
  };
  disposePlayerLifetime = dispose;
  sceneParam.events.once("shutdown", dispose);
  sceneParam.events.once("destroy", dispose);
}

function updateHealthBar() { localHud?.updateHealthBar(); }
export function syncLocalUiPosition() { localHud?.syncLocalUiPosition(); }

function getStableLocalUiTop() {
  return hudTopY(player, frame, bodyConfig);
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
  localHud?.setLocalUiVisible(!dead);
  if (!dead) {
    try {
      localHud?.showIndicator();
    } catch (_) {}
  }
  syncLocalUiPosition();
}

function fireBasicAttack(direction, context = null) {
  if (player?.scene?._modeRuntime?.goalPaused || dead || player?._dash || Date.now() < (player?._attackInterruptedUntil || 0)) return;
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
  if (player?.scene?._modeRuntime?.goalPaused || dead || player?._dash || Date.now() < (player?._attackInterruptedUntil || 0)) return;
  if (localStats.superCharge < localStats.maxSuperCharge) {
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
  // Gameplay only: some casts (the ozzy's) block dashing for a while. The
  // pose is the special action below, which lasts as long as its animation.
  const castLockMs = characterPresentation(resolveCharacterKey(currentCharacter)).specialAnimationLockMs;
  if (castLockMs && player) {
    player._specialCastLockUntil = Date.now() + castLockMs;
  }
  // Start the pose on the press; the server's `player:special` continues it.
  if (player?.scene) {
    playSpriteAnimation({ scene: player.scene, sprite: player, character: currentCharacter,
      logical: "special", fallback: "throw" });
  }
  try {
    if (player?.scene) {
      player.scene._localAttackPrecisionUntil = performance.now() + 520;
    }
  } catch (_) {}
  noteClientActionSent("special", { type: "special" });
  const specialRequest = predictCharacterSpecial(
    currentCharacter, player?.scene, player, username, { aim: serializeAimContext(context) },
  );
  const rally = player?.scene?._modeRuntime?.rally;
  if (rally != null) specialRequest.broBallRally = rally;
  socket.emit(SOCKET_EVENTS.GAME_SPECIAL, withShotView(specialRequest));
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

// ---------------------------------------------------------------------------
// Per-frame local movement
// ---------------------------------------------------------------------------
// handlePlayerMovement runs every frame as an ordered pipeline. Each step
// reads the state produced by the previous ones, so the order matters:
// input gating -> dash -> physics limits -> input -> control locks -> actions
// -> ducking -> horizontal motion -> jumps -> wall slide -> airborne state ->
// presentation (effects, animation) -> replicated input state.

export function handlePlayerMovement(activeScene) {
  if (activeScene !== scene || !player) return;
  mobileControlsController?.update?.(scene);
  updateInvisibleAttackAlpha();
  // Touch players read the cooldown from the dash button instead.
  drawDashCooldown(scene, player, dead || !!mobileControlsController?.isEnabled?.());
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

  pointerAttack?.update();
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

function isUiCapturingInput() {
  return chatInputActive || isSiteDialogOpen();
}

function isLocalInputInactive(scene) {
  const desktopInputInactive =
    !!pointerAttack?.mouse &&
    !mobileControlsController?.isEnabled?.() &&
    !pointerAttack.mouse.isActive();
  return (
    scene?.input?.keyboard?.enabled === false ||
    desktopInputInactive ||
    isUiCapturingInput()
  );
}

function isControlLocked(now = Date.now()) {
  if (player?.scene?._modeRuntime?.goalPaused) return true;
  return Math.max(
    Number(player?._movementLockedUntil || 0),
    Number(player?._externalControlLockUntil || 0),
  ) > now;
}

function isLoadedForNetwork() {
  return !dead && Number.isFinite(player?.x) && Number.isFinite(player?.y) && player?.visible !== false;
}

// Replicated input snapshot; physics/facing fields always come from the body.
function buildNetworkInputState(fields, { derive = true, includeDucking = true } = {}) {
  if (!derive) return fields;
  return {
    grounded: !!player?.body?.touching?.down,
    ...(includeDucking ? { ducking: !!player?._ducking } : {}),
    vx: Number(player?.body?.velocity?.x) || 0,
    vy: Number(player?.body?.velocity?.y) || 0,
    facing: player?.flipX ? -1 : 1,
    ...getMovementFxNetworkState(),
    loaded: isLoadedForNetwork(),
    ...fields,
  };
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
    fallback: getPresentedAnimation(player, "idle"),
  });
  // While a throw or special is showing, the controller keeps it.
  playCharacterAnimation({
    scene,
    sprite: player,
    character: currentCharacter,
    skinId: currentSkinId,
    resolveAnimKey,
    logical: desiredMovementAnimation,
    fallback: "idle",
    force: true,
  });
  // Input can be inactive while Arcade Physics still advances the body; the
  // postupdate sync keeps world-space HUD elements attached meanwhile.
  networkInputState = buildNetworkInputState({
    left: false,
    right: false,
    direction: 0,
    jumpHeld: false,
    jumpPressed: false,
    grounded,
    animation: getPresentedAnimation(player, desiredMovementAnimation),
    wallSliding: false,
    wallSide: null,
    movementLocked: true,
  }, { includeDucking: false });
}

// Advances the dash and ammo reload. Returns true while a dash owns movement.
function updateDashAndAmmo(scene) {
  const now = Date.now();
  const mobileDashPressed = !!mobileControlsController?.consumeDashFreshPress?.();
  const dashing = updateDash(scene, player, {
    pressed: (!!keySpace && Phaser.Input.Keyboard.JustDown(keySpace)) || mobileDashPressed,
    left: cursors.left.isDown || movementKeys.left.isDown || !!mobileControlsController?.isMovingLeft?.(),
    right: cursors.right.isDown || movementKeys.right.isDown || !!mobileControlsController?.isMovingRight?.(),
    up: cursors.up.isDown || movementKeys.up.isDown || !!mobileControlsController?.isAimingUp?.(),
    down: cursors.down.isDown || movementKeys.down.isDown || !!mobileControlsController?.isAimingDown?.(),
    blocked: dead || isAttacking || Number(movementSpeedMult) <= 0 ||
      Math.max(player._movementLockedUntil || 0, player._externalControlLockUntil || 0,
        player._specialCastLockUntil || 0, player._shockwaveUntil || 0,
        player._knockbackUntil || 0) > now,
    now,
    showEffect: !powerupInvisible,
  });
  ammo.tick(scene.game.loop.delta);
  if (!dead) localHud?.drawAmmoBar();
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
  networkInputState = buildNetworkInputState({
    direction: player._dash.inputX || 0,
    jumpHeld: false,
    jumpPressed: false,
    grounded: !!player.body.touching.down,
    vx: player.body.velocity.x,
    vy: player.body.velocity.y,
    animation: "dashing",
    wallSliding: false,
    wallSide: null,
    movementLocked: false,
    loaded: !dead && player.visible !== false,
  });
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
    down: cursors.down.isDown || movementKeys.down.isDown || !!mobileControlsController?.isDuckHeld?.(),
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
      const context = pointerAttack?.quick("basic");
      fireBasicAttack(context.direction, context);
    }
    if (pressed(keyI) && !isControlLocked()) {
      fireSpecialAttack(pointerAttack?.quick("special"));
    }
    if (pressed(keyE) && !isControlLocked()) {
      noteClientActionSent("mode-interact", { type: "mode-interact" });
      socket.emit(SOCKET_EVENTS.GAME_ACTION, { type: "mode-interact" });
    }
  } catch (_) {}
}

function updateAimReticleVisibility() {
  if (mobileControlsController?.isEnabled?.()) {
    mobileControlsController.updateReticle(pointerAttack?.reticle);
  } else if (!pointerAttack?.active) {
    pointerAttack?.clearReticle();
  }
}

// Ducking holds only on a supported ground span and cannot stand up into a
// ceiling. May cancel this frame's jump input. Returns whether ducking.
function updateDucking(scene, input, movementLocked) {
  const grounded = !!(player.body.touching.down || player.body.blocked.down);
  const groundSpan = grounded ? findGroundSpan(player.body, scene._mapObjects || []) : null;
  const wantsToDuck = updateDuckRequest(player, input.down,
    !input.up && !movementLocked && !dead && grounded && !!groundSpan, Date.now());
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
    const standingHeight = standingBodyHeight(player, frame, bodyConfig);
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
    localHud?.hideSpawnIndicator();
    accelerate(-1);
    setFacingLeft(true);
    isMoving = true;
  } else if (input.right) {
    localHud?.hideSpawnIndicator();
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
  // A jump during an attack does not restart the jump frames once it ends.
  if (isAttacking || activeAction(player)) return;
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
  // One ground/coyote jump per landing. Floor contact and the coyote window
  // both outlive takeoff, so only a settled landing re-arms the jump.
  if (body.touching.down && (body.velocity.y || 0) >= 0) player._jumpConsumed = false;
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
    wall.bufferedJumpPressActive && !shockwaveActive && !movementLocked && !player._jumpConsumed &&
    (body.touching.down || now - (player._lastGroundTime || 0) <= tuning.coyoteTimeMs) &&
    !dead
  ) {
    localHud?.hideSpawnIndicator();
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
  player._jumpConsumed = true;
  player._jumpLaunch = { startedAt: Date.now(), vy: -jumpSpeed * MOVEMENT_PHYSICS.jumpLaunchSpeedMult };
  player.setVelocityY(player._jumpLaunch.vy * MOVEMENT_PHYSICS.jumpStartSpeedRatio);
  isMoving = true;
}

// Physics-impulse wall jump away from `wallSide`, with a short re-jump
// cooldown and an input lock so the kick carries.
function performWallJump(scene, wallSide, tuning) {
  player._dashCoastUntil = 0;
  player._wallSlideSuppressedUntil = Date.now() + tuning.wallSlideReentryDelayMs;
  player._jumpLaunch = null;
  player._jumpConsumed = true;
  movementAudio.updateWallSlide(false);
  canWallJump = false;
  const fromLeft = wallSide === "left";
  const vertKick = Math.max(tuning.jumpSpeed + tuning.wallKickVerticalBonus, tuning.wallKickMinVerticalSpeed) * Math.max(0.1, tuning.wallKickVerticalMult);

  // Face away from the wall (or reinforce a locked facing).
  if (!player._lockFlip) setFacingLeft(!fromLeft);
  else enforceLockedFacing();
  playJumpAnimation(scene, true);

  // Visual-only kickback cloud at the wall contact point.
  try {
    const body = player.body;
    const { x: contactX, y: contactY } = wallContactPoint(body, wallSide, MOVEMENT_VFX_CONFIG.wallKickHeightFraction,
      player.x, player.y + player.height * 0.18, player.width * 0.5);
    if (!powerupInvisible) spawnWallKickCloud(scene, contactX, contactY, fromLeft ? 1 : -1, { follow: player });
  } catch (_) {}
  noteMovementFxEvent("wall-jump", { direction: fromLeft ? 1 : -1, wallSide: fromLeft ? "left" : "right" });
  triggerWallJumpCameraKick(scene, fromLeft ? 1 : -1);

  // Nudge away from the wall first so the body does not stay embedded.
  player.x += fromLeft ? 8 : -8;
  player.setVelocityX(fromLeft ? tuning.wallKickFull : -tuning.wallKickFull);
  player.setVelocityY(-vertKick);
  player.setDragX(tuning.dragAir);
  const jumpingPlayer = player;
  scene.time.delayedCall(tuning.wallJumpCooldownMs, () => {
    if (player === jumpingPlayer) canWallJump = true;
  });
  player._wallKickLockUntil = Date.now() + tuning.wallKickLockMs;
}

function updateWallSlide(scene, wall, tuning, movementLocked) {
  const sliding = applyWallSlide(player, {
    dead, movementLocked, wallSlideContact: wall.wallSlideContact, wallSide: wall.wallSide,
    wallBrakeHeld: wall.wallBrakeHeld, drivingIntoWall: wall.drivingIntoWall,
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

// Clear the jump state once its animation ends in the air.
function updateAirborneState(isWallSliding) {
  if (!player.anims.isPlaying && !player.body.touching.down && !isWallSliding && !isAttacking) {
    movementAudio.updateWallSlide(false);
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
    // A throw or special that is showing keeps the sprite (animationState.js).
    logical: desired,
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
    health: Number(localStats.currentHealth) || 0,
    maxHealth: Math.max(1, Number(localStats.maxHealth) || 1),
    healthRatio: Math.max(
      0,
      Math.min(1, (Number(localStats.currentHealth) || 0) / Math.max(1, Number(localStats.maxHealth) || 1)),
    ),
    superCharge: Number(localStats.superCharge) || 0,
    maxSuperCharge: Math.max(1, Number(localStats.maxSuperCharge) || 1),
    superRatio: Math.max(
      0,
      Math.min(1, (Number(localStats.superCharge) || 0) / Math.max(1, Number(localStats.maxSuperCharge) || 1)),
    ),
  };
}

export function setLocalNetStateFlusher(fn) {
  flushLocalNetState = typeof fn === "function" ? fn : null;
}

export function setChatInputActive(active) {
  chatInputActive = !!active;
  if (isUiCapturingInput()) {
    pointerAttack?.mouse?.release();
    pointerAttack?.reset();
    resetMovementInputState({ preserveVelocity: true });
  }
}

export function isChatInputActive() {
  return chatInputActive;
}

// Keep browser focus on the arena during the pre-fight countdown without
// enabling movement before the HUD declares the fight live.
export function focusBattleInput() {
  return pointerAttack?.mouse?.prepareForBattle?.() || false;
}

export function setPowerupMobility(speedMult = 1, jumpMult = 1) {
  return localStateSync.setPowerupMobility(speedMult, jumpMult);
}

// Attacking while invisible shows others a faded silhouette, so the local
// ghost brightens to match and settles back (see invisibilityReveal).
function updateInvisibleAttackAlpha() {
  if (!powerupInvisible || !player?.active) return;
  player.setAlpha(invisibleAttackAlpha(player._invisibleAttackFlashAt, INVISIBLE_ALPHA.local));
}

export function setPowerupInvisible(active = false) {
  const nextInvisible = active === true;
  const changed = nextInvisible !== powerupInvisible;
  powerupInvisible = nextInvisible;
  if (player?.active) {
    player._powerupInvisible = powerupInvisible;
    if (powerupInvisible || changed) {
      player.setAlpha(
        powerupInvisible
          ? invisibleAttackAlpha(player._invisibleAttackFlashAt, INVISIBLE_ALPHA.local)
          : 1,
      );
    }
    if (changed && !powerupInvisible && !dead) {
      try {
        spawnChromaReveal(scene, player, { depth: 28 });
      } catch (_) {}
    }
  }
  if (changed) {
    localHud?.setLocalUiVisible(!dead);
    localHud?.setLocalUiAlpha(powerupInvisible ? 0.42 : 1);
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
  pointerAttack?.destroy();
  pointerAttack = null;
  try {
    mobileControlsController?.destroy?.();
  } catch (_) {}
  mobileControlsController = null;
}

export { player, dead };
