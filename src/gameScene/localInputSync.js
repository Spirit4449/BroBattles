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
  throttleMs = 60,
}) {
  let lastMovementSent = 0;
  let lastPlayerState = { x: 0, y: 0, flip: false, animation: null };
  let inputIntentSeq = 0; // sequence number for intent tracking

  function sync(scene, player, { dead, gameEnded, handlePlayerMovement }) {
    if (!player || dead || gameEnded) return;

    handlePlayerMovement(scene);

    const now = Date.now();
    if (now - lastMovementSent < throttleMs) return;

    const currentState = {
      x: player.x,
      y: player.y,
      flip: player.flipX,
      animation: player.anims?.currentAnim?.key || null,
      vx: Number(player.body?.velocity?.x) || 0,
      vy: Number(player.body?.velocity?.y) || 0,
      grounded: !!player.body?.touching?.down,
      loaded: true,
      ammoState: getAmmoSyncState(),
    };
    const rawInput = getNetworkInputState ? getNetworkInputState() : null;
    const inputIntent = {
      left: !!rawInput?.left,
      right: !!rawInput?.right,
      direction: Number(rawInput?.direction) || 0,
      jumpHeld: !!rawInput?.jumpHeld,
      jumpPressed: !!rawInput?.jumpPressed,
      isJumping: !!rawInput?.jumpPressed,
      grounded:
        typeof rawInput?.grounded === "boolean"
          ? rawInput.grounded
          : !!currentState.grounded,
      facing:
        Number(rawInput?.facing) === -1 ? -1 : 1,
      vx:
        Number.isFinite(Number(rawInput?.vx)) ? Number(rawInput.vx) : currentState.vx,
      vy:
        Number.isFinite(Number(rawInput?.vy)) ? Number(rawInput.vy) : currentState.vy,
      movementLocked: !!rawInput?.movementLocked,
      animation: rawInput?.animation || currentState.animation,
      timestamp: now,
      sequence: inputIntentSeq++,
    };

    // Disable per-message compression for movement for lower latency.
    // Send every throttle interval, not only on visible state deltas.
    socket.volatile.compress(false).emit("game:input", currentState);
    noteClientInputSent({
      now,
      previousState: lastPlayerState,
      currentState,
      previousSentAt: lastMovementSent,
    });

    // Real control intent: based on live controls, not inferred from sampled position deltas.
    socket.volatile.compress(false).emit("game:input-intent", inputIntent);
    noteClientIntentSent(inputIntent);

    lastPlayerState = { ...currentState };
    lastMovementSent = now;
  }

  return {
    sync,
  };
}
