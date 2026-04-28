// gameScene/localInputSync.js
// Emits both game:input (position) and game:input-intent (direction/jump/action)
// for dual-path server movement simulation (Phase 2).

import {
  noteClientInputSent,
  noteClientIntentSent,
} from "../lib/netTestLogger.js";

const RELIABLE_KEYFRAME_INTERVAL_MS = 250;
const RELIABLE_KEYFRAME_DISTANCE_PX = 140;

export function createLocalInputSync({
  socket,
  getAmmoSyncState,
  getNetworkInputState,
  throttleMs = 20,
}) {
  let lastMovementSent = 0;
  let lastReliableMovementSent = 0;
  let lastPlayerState = { x: 0, y: 0, flip: false, animation: null };
  let lastReliablePlayerState = null;
  let lastIntentState = {
    direction: 0,
    jumpHeld: false,
    jumpPressed: false,
    facing: 1,
    grounded: false,
    movementLocked: false,
  };
  let inputIntentSeq = 0; // sequence number for intent tracking
  let lastAmmoState = null;
  let lastAmmoStateSentAt = 0;
  let lastAnimationSent = null;
  let lastAnimationSentAt = 0;

  const quantizePosition = (value) => Math.round((Number(value) || 0) * 2) / 2;
  const quantizeVelocity = (value) => Math.round(Number(value) || 0);
  const sameAmmoState = (a, b) =>
    !!a &&
    !!b &&
    a.capacity === b.capacity &&
    a.charges === b.charges &&
    a.cooldownMs === b.cooldownMs &&
    a.reloadMs === b.reloadMs &&
    a.reloadTimerMs === b.reloadTimerMs &&
    a.nextFireInMs === b.nextFireInMs;
  const sameIntentState = (a, b) =>
    !!a &&
    !!b &&
    Number(a.direction) === Number(b.direction) &&
    !!a.jumpHeld === !!b.jumpHeld &&
    !!a.jumpPressed === !!b.jumpPressed &&
    Number(a.facing) === Number(b.facing) &&
    !!a.grounded === !!b.grounded &&
    !!a.movementLocked === !!b.movementLocked;

  function sync(
    scene,
    player,
    { dead, gameEnded, handlePlayerMovement, force = false, reliable = false },
  ) {
    if (!player || dead || gameEnded) return;

    handlePlayerMovement(scene);

    const now = Date.now();
    const rawInput = getNetworkInputState ? getNetworkInputState() : null;
    const inputIntent = {
      direction: Number(rawInput?.direction) || 0,
      jumpHeld: !!rawInput?.jumpHeld,
      jumpPressed: !!rawInput?.jumpPressed,
      facing: Number(rawInput?.facing) === -1 ? -1 : 1,
      grounded: !!rawInput?.grounded,
      vx: quantizeVelocity(rawInput?.vx),
      vy: quantizeVelocity(rawInput?.vy),
      animation:
        typeof rawInput?.animation === "string" ? rawInput.animation : null,
      movementLocked: !!rawInput?.movementLocked,
      timestamp: now,
    };
    const intentChanged = !sameIntentState(inputIntent, lastIntentState);
    if (!force && !intentChanged && now - lastMovementSent < throttleMs) return;
    const packetSequence = inputIntentSeq++;
    inputIntent.sequence = packetSequence;

    const ammoState = getAmmoSyncState();
    const animation = inputIntent.animation || null;
    const includeAmmoState =
      !sameAmmoState(ammoState, lastAmmoState) ||
      now - lastAmmoStateSentAt >= 250;
    const includeAnimation =
      animation !== lastAnimationSent || now - lastAnimationSentAt >= 180;

    const body = player.body || null;
    const bodyHalfWidth = body?.width ? Math.round(body.width / 2) : null;
    const bodyHalfHeight = body?.height ? Math.round(body.height / 2) : null;
    const bodyCenterOffsetX =
      body?.center && Number.isFinite(player.x)
        ? Math.round((body.center.x - player.x) * 2) / 2
        : 0;
    const bodyCenterOffsetY =
      body?.center && Number.isFinite(player.y)
        ? Math.round((body.center.y - player.y) * 2) / 2
        : 0;
    const currentState = {
      x: quantizePosition(player.x),
      y: quantizePosition(player.y),
      flip: player.flipX,
      vx: quantizeVelocity(player.body?.velocity?.x),
      vy: quantizeVelocity(player.body?.velocity?.y),
      grounded: !!player.body?.touching?.down,
      loaded: true,
      sequence: packetSequence,
      timestamp: now,
      width: quantizePosition(player.displayWidth || player.width || 0),
      height: quantizePosition(player.displayHeight || player.height || 0),
      bodyHalfWidth,
      bodyHalfHeight,
      bodyCenterOffsetX,
      bodyCenterOffsetY,
    };
    if (includeAnimation) currentState.animation = animation;
    if (includeAmmoState) currentState.ammoState = ammoState;

    const reliableDx =
      lastReliablePlayerState && Number.isFinite(lastReliablePlayerState.x)
        ? currentState.x - lastReliablePlayerState.x
        : 0;
    const reliableDy =
      lastReliablePlayerState && Number.isFinite(lastReliablePlayerState.y)
        ? currentState.y - lastReliablePlayerState.y
        : 0;
    const shouldSendReliable =
      reliable ||
      force ||
      now - lastReliableMovementSent >= RELIABLE_KEYFRAME_INTERVAL_MS ||
      !lastReliablePlayerState ||
      Math.hypot(reliableDx, reliableDy) >= RELIABLE_KEYFRAME_DISTANCE_PX;
    if (shouldSendReliable) currentState.keyframe = true;

    const movementEmitter = shouldSendReliable
      ? socket.compress(false)
      : socket.volatile.compress(false);

    // Disable per-message compression for movement for lower latency.
    // Send every throttle interval, not only on visible state deltas.
    movementEmitter.emit("game:input", currentState);
    noteClientInputSent({
      now,
      previousState: lastPlayerState,
      currentState,
      previousSentAt: lastMovementSent,
    });

    // Real control intent: based on live controls, not inferred from sampled position deltas.
    socket.compress(false).emit("game:input-intent", inputIntent);
    noteClientIntentSent(inputIntent);

    lastPlayerState = { ...currentState };
    if (shouldSendReliable) {
      lastReliablePlayerState = { ...currentState };
      lastReliableMovementSent = now;
    }
    lastIntentState = {
      direction: inputIntent.direction,
      jumpHeld: inputIntent.jumpHeld,
      jumpPressed: inputIntent.jumpPressed,
      facing: inputIntent.facing,
      grounded: inputIntent.grounded,
      movementLocked: inputIntent.movementLocked,
    };
    lastMovementSent = now;
    if (includeAmmoState) {
      lastAmmoState = { ...ammoState };
      lastAmmoStateSentAt = now;
    }
    if (includeAnimation) {
      lastAnimationSent = animation;
      lastAnimationSentAt = now;
    }
  }

  return {
    sync,
    flushNow(scene, player, state) {
      return sync(scene, player, {
        ...state,
        force: true,
        reliable: true,
      });
    },
  };
}
