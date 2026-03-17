// gameScene/localInputSync.js

export function createLocalInputSync({
  socket,
  getAmmoSyncState,
  throttleMs = 20,
}) {
  let lastMovementSent = 0;
  let lastPlayerState = { x: 0, y: 0, flip: false, animation: null };

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
      Math.abs(currentState.x - lastPlayerState.x) > 1 ||
      Math.abs(currentState.y - lastPlayerState.y) > 1 ||
      currentState.flip !== lastPlayerState.flip ||
      currentState.animation !== lastPlayerState.animation
    ) {
      // Disable per-message compression for movement for lower latency.
      socket.volatile.compress(false).emit("game:input", currentState);

      lastPlayerState = { ...currentState };
      lastMovementSent = now;
    }
  }

  return {
    sync,
  };
}
