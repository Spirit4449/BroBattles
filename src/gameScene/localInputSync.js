// gameScene/localInputSync.js
// Emits both game:input (position) and game:input-intent (direction/jump/action)
// for dual-path server movement simulation (Phase 2).

export function createLocalInputSync({
  socket,
  getAmmoSyncState,
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
      loaded: true,
      ammoState: getAmmoSyncState(),
    };

    if (
      Math.abs(currentState.x - lastPlayerState.x) > 2 ||
      Math.abs(currentState.y - lastPlayerState.y) > 2 ||
      currentState.flip !== lastPlayerState.flip ||
      currentState.animation !== lastPlayerState.animation
    ) {
      // Disable per-message compression for movement for lower latency.
      socket.volatile.compress(false).emit("game:input", currentState);

      // NEW: Also emit input intent for Phase 2 server-side movement simulation
      // This is non-breaking; server currently ignores it, but will use it when flag enables
      const dx = currentState.x - lastPlayerState.x;
      const direction = dx > 0.9 ? 1 : dx < -0.9 ? -1 : 0;
      const airborne = !player.body?.touching?.down;
      const inputIntent = {
        direction,
        isJumping: airborne && (player.body?.velocity?.y || 0) < -60,
        timestamp: now,
        sequence: inputIntentSeq++,
      };
      socket.volatile.compress(false).emit("game:input-intent", inputIntent);

      lastPlayerState = { ...currentState };
      lastMovementSent = now;
    }
  }

  return {
    sync,
  };
}
