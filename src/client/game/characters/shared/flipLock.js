// Holds a player's facing while an attack plays. Each lock replaces the one
// before it, and only the newest lock's unlock releases the facing, so a
// predicted attack's early unlock cannot cut short the server echo's lock.
export function lockPlayerFlip(player) {
  if (!player) {
    return () => {};
  }
  const token = {};
  player._lockFlip = true;
  player._lockedFlipX = player.flipX;
  player._lockFlipToken = token;
  return () => {
    if (!player || player._lockFlipToken !== token) return;
    player._lockFlip = false;
    delete player._lockedFlipX;
    delete player._lockFlipToken;
  };
}

export function enforceLockedFlip(player) {
  if (!player || !player._lockFlip || player._lockedFlipX === undefined) {
    return;
  }
  if (player.flipX !== player._lockedFlipX) {
    player.flipX = player._lockedFlipX;
  }
}

// An attack's aim angle (radians, +y down), or straight ahead the way `player`
// faces when the attack carries no aim.
export function aimAngle(angle, player) {
  const n = Number(angle);
  if (angle !== null && angle !== undefined && Number.isFinite(n)) return n;
  return player?.flipX ? Math.PI : 0;
}

// Whether an attack aimed with `aim` ({ direction, angle }) faces left. A
// mostly vertical aim keeps the current facing.
export function aimFacesLeft(aim, currentlyLeft = false) {
  const direction = Number(aim?.direction);
  if (direction === -1) return true;
  if (direction === 1) return false;
  const angle = Number(aim?.angle);
  if (Number.isFinite(angle)) {
    const x = Math.cos(angle);
    if (x <= -0.1) return true;
    if (x >= 0.1) return false;
  }
  return !!currentlyLeft;
}

// Turns the player toward an attack and holds that facing for `ms`, so
// movement input cannot turn them back mid-throw. Returns the unlock.
export function faceAttack(scene, player, left, ms) {
  if (!player) return () => {};
  player.flipX = !!left;
  const unlock = lockPlayerFlip(player);
  if (ms > 0 && scene?.time?.delayedCall) scene.time.delayedCall(ms, unlock);
  return unlock;
}
