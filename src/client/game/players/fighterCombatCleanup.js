import { endDash } from "../scene/dash";

export function cancelHookPull(sprite) {
  sprite._gloopHookPullTween?.stop();
  sprite._gloopHookPullTween = null;
  delete sprite._gloopHookPullSource;
  sprite._externalControlLockUntil = 0;
  if (sprite.body && sprite._externalControlPrevGravity !== undefined) {
    sprite.body.allowGravity = sprite._externalControlPrevGravity;
  }
  delete sprite._externalControlPrevGravity;
}

export function cancelFighterCombat(sprite, { local = false } = {}) {
  if (!sprite) return;
  sprite.emit?.("combat:reset");
  sprite.emit?.("attack:interrupted");
  endDash(sprite, false);
  cancelHookPull(sprite);
  sprite._knockbackTrailStop?.();
  sprite._bbAnimationState = {};
  sprite._lockFlip = false;
  delete sprite._lockFlipToken;
  delete sprite._lockedFlipX;
  delete sprite._recentPowerupEffects;
  sprite._movementLockedUntil = 0;
  sprite._specialCastLockUntil = 0;
  sprite._attackInterruptedUntil = 0;
  sprite._knockbackUntil = 0;
  sprite._shockwaveUntil = 0;
  sprite._dashReadyAt = 0;
  sprite._stompArmedUntil = 0;
  sprite._stompStartBottom = null;
  sprite._wallKickLockUntil = 0;
  sprite._wallSlideSuppressedUntil = 0;
  sprite._wallAttachSide = null;
  sprite._wallAttachStartedAt = null;
  if (local && sprite.body) sprite.body.allowGravity = true;
}
