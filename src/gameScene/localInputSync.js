// gameScene/localInputSync.js
// Emits both game:input (position) and game:input-intent (direction/jump/action)
// for dual-path server movement simulation (Phase 2).

import {
  noteClientInputSent,
  noteClientIntentSent,
} from "../lib/netTestLogger.js";

export function createLocalInputSync({
  socket,
  getAmmoSyncState,
  getNetworkInputState,
  throttleMs = 20,
}) {
  let lastMovementSent = 0;
  let lastPlayerState = { x: 0, y: 0, flip: false, animation: null };
  let lastIntentState = {
    direction: 0,
    jumpHeld: false,
    jumpPressed: false,
    facing: 1,
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
    Number(a.facing) === Number(b.facing);

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
      sequence: inputIntentSeq++,
    };
    const intentChanged = !sameIntentState(inputIntent, lastIntentState);
    if (!force && !intentChanged && now - lastMovementSent < throttleMs) return;

    const ammoState = getAmmoSyncState();
    const animation = player.anims?.currentAnim?.key || null;
    const includeAmmoState =
      !sameAmmoState(ammoState, lastAmmoState) ||
      now - lastAmmoStateSentAt >= 250;
    const includeAnimation =
      animation !== lastAnimationSent || now - lastAnimationSentAt >= 180;

    const currentState = {
      x: quantizePosition(player.x),
      y: quantizePosition(player.y),
      flip: player.flipX,
      vx: quantizeVelocity(player.body?.velocity?.x),
      vy: quantizeVelocity(player.body?.velocity?.y),
      grounded: !!player.body?.touching?.down,
      loaded: true,
    };
    if (includeAnimation) currentState.animation = animation;
    if (includeAmmoState) currentState.ammoState = ammoState;
    const movementEmitter = reliable
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
    lastIntentState = {
      direction: inputIntent.direction,
      jumpHeld: inputIntent.jumpHeld,
      jumpPressed: inputIntent.jumpPressed,
      facing: inputIntent.facing,
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
