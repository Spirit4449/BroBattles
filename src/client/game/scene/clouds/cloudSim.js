// cloudSim.js
// Pure simulation for movement clouds. No Phaser: it only moves numbers, so it
// runs (and is tested) in Node.
//
// A cloud is not a sprite. It is a handful of soft round blobs that the
// rasterizer melts into one silhouette. Each blob lives through three phases:
//
//   puff   - radius eases out toward its target, like air pushed out of a gap
//   break  - at `splitAt` it bursts into 2-3 smaller blobs that drift apart
//            along its path (leading pieces keep more speed than trailing ones)
//   erode  - after `erodeAt` the radius wears away until the piece is gone
//
// Movement is plain physics: exponential drag, a little buoyancy, a slow
// sideways wobble and optional curl (the velocity turning at `curl` rad/s,
// so a kicked puff rolls up into a little swirl). Nothing is scaled; the shape changes because the blobs do.

export const CLOUD_SIM_LIMITS = Object.freeze({
  maxBlobs: 520,
  maxSplitDepth: 2,
  minSplitRadius: 5,
  minRadius: 1.4,
  maxAgeMs: 2200,
});

const DEFAULT_BLOB = Object.freeze({
  vx: 0,
  vy: 0,
  drag: 4.2, // 1/s; velocity halves every ~165ms
  rise: 22, // px/s^2 upward
  growRate: 11, // 1/s toward targetRadius
  splitAt: Infinity,
  erodeAt: 260,
  erodeRate: 12, // px/s at full size
  wobble: 18, // px/s^2 sideways turbulence
  curl: 0, // rad/s the velocity turns; + is clockwise on screen
  depth: 0,
  layer: "back",
  tone: 0, // 0 = fresh white, 1 = spent grey
  opacity: 0.82, // heavier actions emit more solid clouds
});

const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/**
 * @param {object} [options]
 * @param {() => number} [options.random] Injectable RNG for deterministic tests.
 */
export function createCloudSim({ random = Math.random } = {}) {
  /** @type {object[]} */
  let blobs = [];
  const between = (min, max) => min + (max - min) * random();

  /**
   * Add one blob. `radius` is the starting radius and `targetRadius` what it
   * puffs out to (defaults to 1.35x the start).
   */
  function add(spec) {
    if (blobs.length >= CLOUD_SIM_LIMITS.maxBlobs) return null;
    const radius = Math.max(CLOUD_SIM_LIMITS.minRadius, finite(spec.radius, 6));
    const blob = {
      ...DEFAULT_BLOB,
      ...spec,
      x: finite(spec.x, 0),
      y: finite(spec.y, 0),
      radius,
      targetRadius: Math.max(radius, finite(spec.targetRadius, radius * 1.35)),
      age: 0,
      seed: finite(spec.seed, random() * 1000),
    };
    blobs.push(blob);
    return blob;
  }

  function split(parent, out) {
    const speed = Math.hypot(parent.vx, parent.vy);
    // Pieces separate along the direction of travel so a breaking cloud
    // stretches into a trail of smaller puffs, not a symmetric pop.
    const dirX = speed > 1 ? parent.vx / speed : Math.cos(parent.seed);
    const dirY = speed > 1 ? parent.vy / speed : Math.sin(parent.seed);
    const count = parent.radius > 11 && random() < 0.55 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      if (blobs.length + out.length >= CLOUD_SIM_LIMITS.maxBlobs) break;
      const along = count === 2 ? (i === 0 ? 1 : -1) : i - 1; // lead / trail / middle
      const angle = Math.atan2(dirY, dirX) + along * 0.35 + between(-0.9, 0.9);
      const offset = parent.radius * between(0.25, 0.55);
      const radius = parent.radius * between(0.55, 0.78);
      const keep = along > 0 ? between(0.85, 1.05) : between(0.35, 0.65);
      const kick = between(10, 34);
      out.push({
        ...parent,
        x: parent.x + Math.cos(angle) * offset,
        y: parent.y + Math.sin(angle) * offset,
        vx: parent.vx * keep + Math.cos(angle) * kick,
        vy: parent.vy * keep + Math.sin(angle) * kick,
        radius,
        targetRadius: radius * between(1.05, 1.25),
        age: 0,
        depth: parent.depth + 1,
        splitAt: parent.depth + 1 < CLOUD_SIM_LIMITS.maxSplitDepth
          ? between(160, 280)
          : Infinity,
        erodeAt: between(110, 220),
        erodeRate: parent.erodeRate * between(0.85, 1.15),
        tone: Math.min(1, parent.tone + 0.25),
        seed: random() * 1000,
      });
    }
  }

  /** Advance every blob by `deltaMs`. */
  function step(deltaMs) {
    const dt = Math.min(0.05, Math.max(0, finite(deltaMs, 16)) / 1000);
    if (!dt || !blobs.length) return;
    const born = [];
    const next = [];
    for (const blob of blobs) {
      blob.age += dt * 1000;
      if (blob.curl) {
        const turn = blob.curl * dt;
        const cos = Math.cos(turn);
        const sin = Math.sin(turn);
        const vx = blob.vx;
        blob.vx = vx * cos - blob.vy * sin;
        blob.vy = vx * sin + blob.vy * cos;
      }
      const damping = Math.exp(-blob.drag * dt);
      blob.vx *= damping;
      blob.vy *= damping;
      blob.vy -= blob.rise * dt;
      blob.vx += Math.sin(blob.age * 0.006 + blob.seed) * blob.wobble * dt;
      blob.x += blob.vx * dt;
      blob.y += blob.vy * dt;

      if (blob.age < blob.erodeAt) {
        blob.radius += (blob.targetRadius - blob.radius) * (1 - Math.exp(-blob.growRate * dt));
      } else {
        // Big blobs wear faster in absolute terms but slower relative to size,
        // so large clouds linger and small scraps vanish quickly.
        const sizeFactor = 0.55 + 0.45 * Math.min(1, blob.radius / 12);
        blob.radius -= blob.erodeRate * sizeFactor * dt;
        blob.tone = Math.min(1, blob.tone + dt * 1.4);
      }

      if (
        blob.age >= blob.splitAt &&
        blob.depth < CLOUD_SIM_LIMITS.maxSplitDepth &&
        blob.radius >= CLOUD_SIM_LIMITS.minSplitRadius
      ) {
        split(blob, born);
        continue;
      }
      if (blob.radius < CLOUD_SIM_LIMITS.minRadius || blob.age > CLOUD_SIM_LIMITS.maxAgeMs) continue;
      next.push(blob);
    }
    blobs = born.length ? next.concat(born) : next;
  }

  return {
    add,
    step,
    clear: () => { blobs = []; },
    get blobs() { return blobs; },
    get size() { return blobs.length; },
    random,
    between,
  };
}
