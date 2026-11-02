const MOVEMENT_PHYSICS = require('./movementPhysics.json');

// A stair riser is a wall to the collision code, but sliding on one stalls a climb
// and kicking off one throws the body away from it. A side counts as a step when
// the ground under the body sits less than wallMinFaceHeight below that side's top.
// Collider height says nothing here: stacked stairs are tall rects that only show
// a short face.
// `surfaces` are { left, right, top, up } edge rects; `up` is whether the top
// can be stood on.
function isStepFace(faceTop, body, surfaces) {
  let ground = Infinity;
  for (const s of surfaces) {
    if (!s.up || s.right <= body.left || s.left >= body.right) continue;
    if (s.top >= body.bottom - 1 && s.top < ground) ground = s.top;
  }
  return ground - faceTop < MOVEMENT_PHYSICS.wallMinFaceHeight;
}

module.exports = { isStepFace };
