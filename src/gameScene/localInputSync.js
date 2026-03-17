// gameScene/localInputSync.js

export function createLocalInputSync({
  socket,
  getAmmoSyncState,
  throttleMs = 20,
  emitIntentV2 = true,
}) {
  let lastMovementSent = 0;
  let lastPlayerState = { x: 0, y: 0, flip: false, animation: null };
  let inputSeq = 0;

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

    if (emitIntentV2) {
      const intent =
        player &&
        player._lastInputIntent &&
        typeof player._lastInputIntent === "object"
          ? {
              left: !!player._lastInputIntent.left,
              right: !!player._lastInputIntent.right,
              up: !!player._lastInputIntent.up,
              down: !!player._lastInputIntent.down,
              jump: !!player._lastInputIntent.jump,
            }
          : {
              left: false,
              right: false,
              up: false,
              down: false,
              jump: false,
            };
      currentState.intent = intent;
      currentState.inputSeq = ++inputSeq;
      currentState.clientMonoTime =
        typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? performance.now()
          : now;
    }

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
