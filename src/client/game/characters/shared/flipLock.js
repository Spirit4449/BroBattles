export function lockPlayerFlip(player) {
  if (!player) {
    return () => {};
  }
  player._lockFlip = true;
  player._lockedFlipX = player.flipX;
  return () => {
    if (!player) return;
    player._lockFlip = false;
    delete player._lockedFlipX;
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
