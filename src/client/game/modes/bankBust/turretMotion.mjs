// The artwork points left at zero rotation; server aim and bullet velocity use
// the usual right-facing zero. Keep claimed guns on that authoritative angle.
export function stepTurretAim(motion, aimAngle, ownerTeam, now, dt) {
  if (ownerTeam && Number.isFinite(aimAngle)) {
    motion.angle = aimAngle + Math.PI;
    return motion.angle;
  }

  const seconds = now / 1000;
  const target = ownerTeam
    ? motion.facing + Math.sin(seconds * 0.7 + motion.phase) * 0.42
    : motion.facing + (motion.facing ? -0.22 : 0.22)
      + Math.sin(seconds * 0.5 + motion.phase) * 0.03;
  const gap = Math.atan2(Math.sin(target - motion.angle), Math.cos(target - motion.angle));
  const turn = 4.2 * 0.35 * dt;
  motion.angle += Math.max(-turn, Math.min(turn, gap));
  return motion.angle;
}
