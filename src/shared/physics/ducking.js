const { duckFrameCells: DUCK_FRAME_CELLS } = require('../characters');

// Ducking rules shared by the client, server validation, and bots.
const DUCK_HEIGHT_RATIO = 0.55; // hitbox height while ducking, as a fraction of standing
const DUCK_SPEED_RATIO = 0.25; // move speed while ducking, as a fraction of normal
const DUCK_DAMAGE_TAKEN_RATIO = 0.8; // damage taken while ducking (0.8 = 20% less)
const DUCK_MIN_HOLD_MS = 50; // minimum duration for an accepted duck press
const DUCK_REENTRY_DELAY_MS = 100; // wait after standing up before ducking again
const DUCK_GROUND_SLACK_PX = 8; // per-step platform travel the duck edge guard follows (480 px/s)

// Called before applying the local duck pose. Only accepted entries start a hold;
// continuing to hold the key must not extend the minimum duration.
function updateDuckRequest(player, pressed, eligible, now) {
  if (!eligible) {
    player._duckHoldUntil = 0;
    return false;
  }
  if (!player._ducking) {
    player._duckHoldUntil = 0;
    if (!pressed || now < (player._duckAvailableAt || 0)) return false;
    player._duckHoldUntil = now + DUCK_MIN_HOLD_MS;
  }
  return pressed || now < (player._duckHoldUntil || 0);
}

function reduceDuckDamage(player, damage) {
  const raw = Math.max(0, Number(damage) || 0);
  return player?.ducking ? raw * DUCK_DAMAGE_TAKEN_RATIO : raw;
}

function collidablePlatformBodies(objects = []) {
  return objects.map((object) => object?.body).filter((body) =>
    body && body.enable !== false && body.width > 0 && body.height > 0 &&
    body.checkCollision?.none !== true && body.checkCollision?.up !== false);
}

// The ground under a body's centre: merged collinear platform tops within
// `tolerance` of its feet, as { span: [left, right], top }. With `slack`, ground
// whose edge is that close to the centre also counts.
function findGround(body, objects = [], tolerance = 4, slack = 0) {
  if (!body) return null;
  const feet = body.y + body.height;
  const centerX = body.x + body.width / 2;
  const platforms = collidablePlatformBodies(objects)
    .filter((platform) => Math.abs(platform.y - feet) <= tolerance)
    .sort((a, b) => a.x - b.x);
  const merged = [];
  for (const platform of platforms) {
    const previous = merged[merged.length - 1];
    if (previous && platform.x <= previous.span[1] + 1) {
      previous.span[1] = Math.max(previous.span[1], platform.x + platform.width);
      previous.platforms.push(platform);
    } else {
      merged.push({ span: [platform.x, platform.x + platform.width], platforms: [platform] });
    }
  }
  const distance = ({ span }) => Math.max(span[0] - centerX, centerX - span[1], 0);
  const ground = merged.filter((g) => distance(g) <= slack).sort((a, b) => distance(a) - distance(b))[0];
  if (!ground) return null;
  const under = ground.platforms.find((p) => centerX >= p.x && centerX <= p.x + p.width) || ground.platforms[0];
  return { span: ground.span, top: under.y };
}

function findGroundSpan(body, objects = [], tolerance = 4) {
  return findGround(body, objects, tolerance)?.span || null;
}

// Keeps a ducking body from walking off the ground it ducked on. The ground is
// re-read from the live platforms every step at the body's current feet, so a
// moving platform carries the guard with it and ground that has moved away
// releases the body instead of holding it in the air. The remembered span is
// one physics step old, so a platform may have moved DUCK_GROUND_SLACK_PX.
// Returns the ground now held, or null when there is none.
function holdDuckGround(body, span, objects = []) {
  if (!body || !span) return null;
  const centerX = Math.max(span[0], Math.min(span[1], body.x + body.width / 2));
  const ground = findGround({ x: centerX - body.width / 2, y: body.y, width: body.width, height: body.height },
    objects, 4, DUCK_GROUND_SLACK_PX);
  if (ground) clampBodyToGroundSpan(body, ground.span, ground.top);
  return ground;
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
  DUCK_REENTRY_DELAY_MS,
  DUCK_MIN_HOLD_MS,
  updateDuckRequest,
  reduceDuckDamage,
  findGround,
  findGroundSpan,
  holdDuckGround,
  hasStandingClearance,
  clampBodyToGroundSpan,
};
