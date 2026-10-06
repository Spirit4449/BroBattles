// Moving platforms. A platform's position is a pure function of server
// monotonic time, so the browser, the server and bots agree on where it is
// without replicating it. The document stores the rest position; `motion`
// travels `distance` pixels along one axis and back, forever.
//
//   motion: { axis: 'x' | 'y', distance, speed, ease, pauseMs, phase }
//
// distance is signed world pixels from the rest position (positive is right or
// down), speed is the average speed of one leg in pixels per second, pauseMs
// is the dwell at each end and phase (0 to 1) staggers platforms that share
// a rhythm.
const EASES = {
  linear: t => t,
  sine: t => (1 - Math.cos(Math.PI * t)) / 2,
  quad: t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
  cubic: t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2,
  quart: t => t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2,
  expo: t => t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
};
const MOTION_EASES = Object.keys(EASES);
const MOTION_AXES = ['x', 'y'];
const MOTION_LIMITS = { distance: [8, 20000], speed: [5, 2000], pauseMs: [0, 60000], phase: [0, 1] };
const MOTION_DEFAULTS = { axis: 'y', distance: 160, speed: 80, ease: 'sine', pauseMs: 400, phase: 0 };
// A body that ends up inside a moving platform is put on top only when its
// feet are this close to the top (about one dash step); otherwise it leaves
// out a side or below, as at any wall.
const PLATFORM_STEP_UP_PX = 10;

function validateMotion(motion, path, fail, num) {
  if (motion === undefined) return;
  if (!motion || typeof motion !== 'object' || Array.isArray(motion)) { fail(path, 'must be an object'); return; }
  if (!MOTION_AXES.includes(motion.axis)) fail(`${path}.axis`, 'use x (left and right) or y (up and down)');
  if (!MOTION_EASES.includes(motion.ease)) fail(`${path}.ease`, `use one of ${MOTION_EASES.join(', ')}`);
  num(motion.speed, `${path}.speed`, ...MOTION_LIMITS.speed);
  num(motion.distance, `${path}.distance`, -MOTION_LIMITS.distance[1], MOTION_LIMITS.distance[1]);
  if (Math.abs(motion.distance) < MOTION_LIMITS.distance[0]) fail(`${path}.distance`, `must travel at least ${MOTION_LIMITS.distance[0]} pixels`);
  if (motion.pauseMs !== undefined) num(motion.pauseMs, `${path}.pauseMs`, ...MOTION_LIMITS.pauseMs);
  if (motion.phase !== undefined) num(motion.phase, `${path}.phase`, ...MOTION_LIMITS.phase);
}

// 0 at the rest position, 1 at the far end.
function motionProgress(motion, timeMs) {
  const legMs = Math.abs(motion.distance) / motion.speed * 1000;
  const pauseMs = motion.pauseMs || 0;
  const period = 2 * (legMs + pauseMs);
  const ease = EASES[motion.ease] || EASES.linear;
  const raw = (timeMs / period + (motion.phase || 0)) % 1;
  const u = (raw < 0 ? raw + 1 : raw) * period;
  if (u < legMs) return ease(u / legMs);
  if (u < legMs + pauseMs) return 1;
  if (u < 2 * legMs + pauseMs) return 1 - ease((u - legMs - pauseMs) / legMs);
  return 0;
}

function motionOffset(motion, timeMs) {
  const travel = motionProgress(motion, timeMs) * motion.distance + 0; // never -0
  return motion.axis === 'x' ? { x: travel, y: 0 } : { x: 0, y: travel };
}

// Fastest instantaneous speed (pixels per second); eases exceed the average.
function motionPeakSpeed(motion) {
  const ease = EASES[motion.ease] || EASES.linear;
  let slope = 0;
  for (let i = 0; i < 200; i++) slope = Math.max(slope, (ease((i + 1) / 200) - ease(i / 200)) * 200);
  return motion.speed * slope;
}

// Moves the moving colliders of a geometryFromMap result to `timeMs` in place,
// so every consumer holding the geometry sees current positions. Returns the
// displacement of each collider since the previous call.
function advanceGeometry(geometry, timeMs) {
  const moved = [];
  if (geometry) geometry.motionTime = timeMs;
  for (const collider of geometry?.movingColliders || []) {
    const offset = motionOffset(collider.motion, timeMs), base = collider.base;
    const dx = base.left + offset.x - collider.left, dy = base.top + offset.y - collider.top;
    collider.left = base.left + offset.x; collider.right = base.right + offset.x;
    collider.top = base.top + offset.y; collider.bottom = base.bottom + offset.y;
    collider.x = base.x + offset.x; collider.y = base.y + offset.y;
    if (dx || dy) moved.push({ collider, dx, dy });
  }
  return moved;
}

// Bots plan routes over surfaces that stay put; moving ones still collide.
const staticGeometries = new WeakMap();
function staticGeometry(geometry) {
  if (!geometry?.movingColliders?.length) return geometry;
  let result = staticGeometries.get(geometry);
  if (!result) {
    result = { ...geometry, colliders: geometry.colliders.filter(c => !c.motion), movingColliders: [] };
    staticGeometries.set(geometry, result);
  }
  return result;
}

module.exports = { MOTION_EASES, MOTION_AXES, MOTION_LIMITS, MOTION_DEFAULTS, PLATFORM_STEP_UP_PX, validateMotion, motionProgress,
  motionOffset, motionPeakSpeed, advanceGeometry, staticGeometry };
