// Sparrow's Seraph aim poses. The art script (scripts/art/sparrow-pixel/
// seraph.cjs) draws the held draw in 13 directions, every 15 deg from straight
// up to straight down on the side she faces, each a 4-frame wing flutter
// (`seraphAim<DD><FF>`); anim.js registers each as `sparrow-seraph-aim-<DD>`.
const STEP_DEG = 15;
const SERAPH_FLUTTER_FPS = 8;
const SERAPH_DIRECTIONS = Array.from({ length: 13 }, (_, i) => ({
  index: i,
  elevation: 90 - i * STEP_DEG,
  frame: `seraphAim${String(i).padStart(2, '0')}`,
  logical: `seraph-aim-${String(i).padStart(2, '0')}`,
}));
const LEVEL_INDEX = 6;

// The direction for a world aim angle (radians, y down), and which way she
// faces for it. Straight up or down keeps the current facing.
function seraphAimPose(angle, flipX = false) {
  const a = Number(angle);
  if (!Number.isFinite(a)) return { direction: SERAPH_DIRECTIONS[LEVEL_INDEX], flipX: !!flipX };
  const dx = Math.cos(a), dy = Math.sin(a);
  const faceLeft = Math.abs(dx) < 1e-3 ? !!flipX : dx < 0;
  const elevation = (Math.atan2(-dy, Math.abs(dx)) * 180) / Math.PI;
  const index = Math.max(0, Math.min(12, Math.round((90 - elevation) / STEP_DEG)));
  return { direction: SERAPH_DIRECTIONS[index], flipX: faceLeft };
}

// The world aim angle a remote pose shows (its direction and facing).
function seraphPoseAngle(logical, flipX = false) {
  const match = /^(?:sparrow-)?seraph-aim-(\d{2})$/.exec(String(logical || ''));
  const direction = match && SERAPH_DIRECTIONS[Number(match[1])];
  if (!direction) return null;
  const elevation = direction.elevation * Math.PI / 180;
  return flipX ? Math.PI + elevation : -elevation;
}

module.exports = { SERAPH_DIRECTIONS, SERAPH_FLUTTER_FPS, seraphAimPose, seraphPoseAngle };
