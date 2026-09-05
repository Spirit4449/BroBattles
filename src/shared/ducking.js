const DUCK_FRAME_CELLS = Object.freeze({
  draven: [1, 1],
  gloop: [8, 2],
  ninja: [1, 3],
  huntress: [5, 2],
  wizard: [3, 7],
  thorg: [4, 4],
});

const DUCK_HEIGHT_RATIO = 0.55;
const DUCK_SPEED_RATIO = 0.25;
const DUCK_DAMAGE_TAKEN_RATIO = 0.8;

function reduceDuckDamage(player, damage) {
  const raw = Math.max(0, Number(damage) || 0);
  return player?.ducking ? raw * DUCK_DAMAGE_TAKEN_RATIO : raw;
}

function collidablePlatformBodies(objects = []) {
  return objects.map((object) => object?.body).filter((body) =>
    body && body.enable !== false && body.width > 0 && body.height > 0 &&
    body.checkCollision?.none !== true && body.checkCollision?.up !== false);
}

function findGroundSpan(body, objects = [], tolerance = 4) {
  if (!body) return null;
  const feet = body.y + body.height;
  const centerX = body.x + body.width / 2;
  const spans = collidablePlatformBodies(objects)
    .filter((platform) => Math.abs(platform.y - feet) <= tolerance)
    .map((platform) => [platform.x, platform.x + platform.width])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous && span[0] <= previous[1] + 1) {
      previous[1] = Math.max(previous[1], span[1]);
    } else {
      merged.push([...span]);
    }
  }
  return merged.find(([left, right]) => centerX >= left && centerX <= right) || null;
}

function hasStandingClearance(body, objects = [], extraHeight = 0) {
  const raisedTop = body.y - Math.max(0, extraHeight);
  return !collidablePlatformBodies(objects).some((platform) =>
    body.x < platform.x + platform.width &&
    body.x + body.width > platform.x &&
    raisedTop < platform.y + platform.height && body.y > platform.y);
}

function clampBodyToGroundSpan(body, span, feet) {
  if (!body || !span || body.velocity.y < 0) return false;
  const centerX = body.x + body.width / 2;
  const clampedCenter = Math.max(span[0], Math.min(span[1], centerX));
  const movedHorizontally = centerX !== clampedCenter;
  const movedVertically = Math.abs(body.y + body.height - feet) > 0.01;
  if (movedHorizontally) {
    body.position.x += clampedCenter - centerX;
    body.velocity.x = 0;
  }
  body.position.y = feet - body.height;
  body.velocity.y = 0;
  body.touching.down = true;
  body.updateCenter?.();
  return movedHorizontally || movedVertically;
}

module.exports = {
  DUCK_FRAME_CELLS,
  DUCK_HEIGHT_RATIO,
  DUCK_SPEED_RATIO,
  DUCK_DAMAGE_TAKEN_RATIO,
  reduceDuckDamage,
  findGroundSpan,
  hasStandingClearance,
  clampBodyToGroundSpan,
};
