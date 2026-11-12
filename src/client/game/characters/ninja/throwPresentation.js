// Directional throw poses and the hand-to-flight handoff of the basic shuriken.
// Presentation only: the flight itself (when it fires, its aim, path, hits and
// damage) is untouched. `throw` in animation-settings.json describes the baked
// poses; sheets without it keep the single forward throw and show the star at once.
const settings = require('../../../../../public/assets/ninja/animation-settings.json');
const { aimElevation, nearestAimPose } = require('../shared/aimPose');

// The baked pose whose wrist points closest to `angle`.
function throwPose(angle, config = settings.throw) {
  return nearestAimPose(angle, config?.directions);
}

// Starts a directional throw on `sprite`. Returns the clip variant to play (see
// playSpriteAnimation's `variant`), or null for art without directional poses.
// The sprite remembers the throw so its flight can leave from the hand.
function beginThrow(sprite, angle, now = performance.now(), config = settings.throw) {
  if (!sprite) return null;
  delete sprite._ninjaThrow;
  const pose = throwPose(angle, config);
  // Every player carries its texture key, the default skin's being 'ninja'
  // itself; only other skins keep their own single throw.
  const texture = sprite._bbSkinTextureKey || sprite.texture?.key;
  if (!pose || (texture && texture !== 'ninja')) return null;
  sprite._ninjaThrow = { startedAt: now, releaseMs: config.releaseMs, blendMs: config.blendMs,
    startScale: config.startScale, hand: pose.hand };
  return pose.key;
}

// The flight that a just-started throw releases. Each throw feeds one flight.
function claimThrow(sprite) {
  const thrown = sprite?._ninjaThrow;
  if (!thrown || thrown.claimed) return null;
  thrown.claimed = true;
  return { ...thrown };
}

// Fingertips of the release pose in world space; `hand` is measured facing right.
function handPoint(owner, hand) {
  return { x: owner.x + (owner.flipX ? -hand[0] : hand[0]), y: owner.y + hand[1] };
}

// Where to draw a flight that is really at `flight`. Until the release beat the
// star is still in the hand (drawn by the pose) and the flight is hidden. On the
// beat it appears at the fingertips, small, and eases onto its true path.
function presentRelease(thrown, flight, owner, now) {
  if (now - thrown.startedAt < thrown.releaseMs) return { visible: false, x: flight.x, y: flight.y, scale: 1 };
  if (!thrown.offset) {
    // First drawn after the blend would have finished (a late or hidden frame):
    // show the true flight, so every client draws the same place.
    const late = now - thrown.startedAt >= thrown.releaseMs + thrown.blendMs;
    const hand = owner && !late ? handPoint(owner, thrown.hand) : flight;
    thrown.offset = { x: hand.x - flight.x, y: hand.y - flight.y, at: now };
  }
  const t = Math.min(1, (now - thrown.offset.at) / Math.max(1, thrown.blendMs));
  const left = (1 - t) ** 3;
  return { visible: true, x: flight.x + thrown.offset.x * left, y: flight.y + thrown.offset.y * left,
    scale: 1 - (1 - thrown.startScale) * left };
}

module.exports = { aimElevation, throwPose, beginThrow, claimThrow, handPoint, presentRelease };
