// Releasing controls should stop input acceleration, not the motion already in
// progress. Arcade Physics can then apply its ordinary ground/air drag and
// gravity while the player is looking elsewhere.
export function releaseMovementForFocus(
  player,
  { dragGround = 0, dragAir = 0, shockwaveActive = false } = {},
) {
  if (!player?.body) return false;
  const grounded = !!(
    player.body.touching?.down || player.body.blocked?.down
  );
  player._jumpLaunch = null;
  player.setAccelerationX?.(0);
  player.setDragX?.(shockwaveActive ? 0 : grounded ? dragGround : dragAir);
  return grounded;
}
