// Pulls the local player along a Gloop hook when the server reports a catch
// targeting them. Movement input is locked for the pull, and the pull keeps
// tracking the hook owner so the player stops just in front of them.
export function pullLocalPlayerByHook(action, {
  scene,
  localPlayer,
  username,
  findSprite,
  setExternalControlLockUntil,
} = {}) {
  if (!username || String(action?.target || "") !== username) return false;
  if (!scene?.tweens || !localPlayer?.body || !localPlayer?.active) return false;

  const endX = Number(action?.end?.x);
  const endY = Number(action?.end?.y);
  if (!Number.isFinite(endX) || !Number.isFinite(endY)) return false;

  const pullDurationMs = Math.max(100, Number(action?.pullDurationMs) || 640);
  try {
    setExternalControlLockUntil?.(Date.now() + pullDurationMs + 120);
  } catch (_) {}

  const startX = Number.isFinite(Number(localPlayer.x)) ? Number(localPlayer.x) : endX;
  const startY = Number.isFinite(Number(localPlayer.y)) ? Number(localPlayer.y) : endY;
  const sourceName = String(action?.sourceName || action?.playerName || "").trim() || null;
  const stopDistance = Math.max(1, Number(action?.pulledStopDistance) || 54);

  try {
    if (localPlayer._gloopHookPullTween?.isPlaying?.()) {
      localPlayer._gloopHookPullTween.stop();
    }
  } catch (_) {}

  const motion = { x: startX, y: startY };
  localPlayer._gloopHookPullTween = scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration: pullDurationMs,
    ease: "Linear",
    onUpdate: () => {
      if (!localPlayer?.active || !localPlayer?.body) return;
      let targetX = endX;
      let targetY = endY;
      const sourceSprite = sourceName
        ? sourceName === username ? localPlayer : findSprite?.(sourceName)
        : null;
      if (sourceSprite?.active) {
        const ax = Number(sourceSprite.x);
        const ay = Number(sourceSprite.y);
        if (Number.isFinite(ax) && Number.isFinite(ay)) {
          const dx = Number(localPlayer.x) - ax;
          const dy = Number(localPlayer.y) - ay;
          const dist = Math.hypot(dx, dy) || 1;
          targetX = ax + (dx / dist) * stopDistance;
          targetY = ay + (dy / dist) * stopDistance;
        }
      }
      motion.x += (targetX - motion.x) * 0.3;
      motion.y += (targetY - motion.y) * 0.3;
      localPlayer.body.reset(motion.x, motion.y);
      localPlayer.setVelocity?.(0, 0);
    },
    onComplete: () => {
      if (!localPlayer?.active || !localPlayer?.body) return;
      localPlayer.body.reset(motion.x, motion.y);
      localPlayer.setVelocity?.(0, 0);
    },
  });
  return true;
}
