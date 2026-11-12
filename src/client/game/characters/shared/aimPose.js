// Picks the baked pose for an aimed attack. Characters with directional art
// (ninja throws, huntress shots) list poses by elevation: degrees above level,
// whichever way the attack faces.

// Aim above level in degrees for a screen angle (radians, +y down).
function aimElevation(angle) {
  return (Math.atan2(-Math.sin(angle), Math.abs(Math.cos(angle))) * 180) / Math.PI;
}

// The pose whose elevation is closest to `angle`, or null without poses or aim.
function nearestAimPose(angle, poses) {
  if (!poses?.length || !Number.isFinite(Number(angle))) return null;
  const elevation = aimElevation(Number(angle));
  return poses.reduce((best, pose) =>
    (Math.abs(pose.elevation - elevation) < Math.abs(best.elevation - elevation) ? pose : best));
}

module.exports = { aimElevation, nearestAimPose };
