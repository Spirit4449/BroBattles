// cloudEmitters.js
// Shape vocabulary for movement clouds, built from cloudSim blobs. Pure: each
// emitter only adds blobs to a sim, so emitters run in Node tests.
//
//   puff    - an irregular clump: one main lobe and a few smaller ones
//   streak  - a tapering chain along a direction; the head is fast and fat,
//             the tail slow and thin, so it stretches as it flies
//   surface - every contact (floor, wall, skid) as two streaks racing along
//             the surface plus a small puff off it, scaled by impact strength
//             and skewed by incoming momentum
//   scrape  - a single blob laid against a wall during a slide
//   wake    - a single blob left behind a launching body
//
// Sizes are world pixels. Randomness comes from the sim so tests can seed it.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * An irregular clump of lobes sharing one velocity. `curl` (rad/s) makes the
 * clump swirl as it flies; `lifeScale` shortens (<1) or lengthens its life.
 */
export function emitPuff(sim, opts = {}) {
  const { between } = sim;
  const size = Math.max(2, Number(opts.size) || 8);
  const x = Number(opts.x) || 0;
  const y = Number(opts.y) || 0;
  const vx = Number(opts.vx) || 0;
  const vy = Number(opts.vy) || 0;
  const lobes = Math.max(1, Math.round(Number(opts.lobes) || 3));
  const layer = opts.layer || "back";
  const base = {
    layer,
    drag: opts.drag,
    rise: opts.rise,
    erodeRate: opts.erodeRate,
    curl: opts.curl,
    opacity: opts.opacity,
  };
  const life = Number(opts.lifeScale) > 0 ? Number(opts.lifeScale) : 1;
  // `pop` starts lobes near full size so an impact reads on its first frame.
  const start = opts.pop ? 0.9 : 0.65;
  for (const key of Object.keys(base)) if (base[key] === undefined) delete base[key];

  sim.add({
    ...base,
    x,
    y,
    vx: vx * between(0.92, 1.08),
    vy: vy * between(0.92, 1.08),
    radius: size * (opts.pop ? 0.9 : between(0.6, 0.75)),
    targetRadius: size,
    splitAt: Number.isFinite(opts.splitAt) ? opts.splitAt : between(200, 320) * life,
    erodeAt: Number.isFinite(opts.erodeAt) ? opts.erodeAt : between(300, 430) * life,
  });
  for (let i = 1; i < lobes; i++) {
    // Satellites sit around the top and sides, which reads as a cloud crown.
    const angle = between(-Math.PI * 1.05, 0.05);
    const distance = size * between(0.45, 0.9);
    const radius = size * between(0.42, 0.75);
    sim.add({
      ...base,
      x: x + Math.cos(angle) * distance,
      y: y + Math.sin(angle) * distance * 0.8,
      vx: vx * between(0.8, 1.1) + Math.cos(angle) * between(4, 16),
      vy: vy * between(0.8, 1.1) + Math.sin(angle) * between(4, 16),
      radius: radius * start,
      targetRadius: radius,
      splitAt: between(170, 280) * life,
      erodeAt: between(240, 360) * life,
    });
  }
}

/**
 * A tapering chain of blobs. (x, y) is the head; the tail trails back along
 * -dir. Velocity is the head's; the tail keeps a fraction of it.
 */
export function emitStreak(sim, opts = {}) {
  const { between } = sim;
  const size = Math.max(2, Number(opts.size) || 8);
  const length = Math.max(size, Number(opts.length) || size * 3);
  const rawX = Number(opts.dirX) || 0;
  const rawY = Number(opts.dirY) || 0;
  const dirLength = Math.hypot(rawX, rawY);
  const dirX = dirLength ? rawX / dirLength : 1;
  const dirY = dirLength ? rawY / dirLength : 0;
  const perpX = -dirY;
  const perpY = dirX;
  const taper = clamp(Number(opts.taper) || 0.4, 0.15, 1);
  const tailSpeed = clamp(Number(opts.tailSpeed) || 0.45, 0, 1);
  const count = Math.max(2, Math.min(9, Math.round(length / (size * 0.75))));
  const vx = Number(opts.vx) || 0;
  const vy = Number(opts.vy) || 0;
  const start = opts.pop ? 0.9 : 0.6;

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    // Alternate fat and thin lobes so the streak reads as a row of puffs.
    const radius = size * (1 - (1 - taper) * t) * (i % 2 ? between(0.7, 0.88) : between(0.95, 1.18));
    const wander = size * 0.28 * between(-1, 1);
    const speed = 1 - (1 - tailSpeed) * t;
    sim.add({
      layer: opts.layer || "back",
      x: (Number(opts.x) || 0) - dirX * length * t + perpX * wander,
      y: (Number(opts.y) || 0) - dirY * length * t + perpY * wander,
      vx: vx * speed * between(0.9, 1.1),
      vy: vy * speed * between(0.9, 1.1),
      radius: radius * start,
      targetRadius: radius,
      ...(Number.isFinite(opts.rise) ? { rise: opts.rise } : {}),
      ...(Number.isFinite(opts.drag) ? { drag: opts.drag } : {}),
      ...(Number.isFinite(opts.opacity) ? { opacity: opts.opacity } : {}),
      // The head breaks up last; the thin tail crumbles first.
      splitAt: between(170, 260) + (1 - t) * 110,
      erodeAt: between(230, 330) + (1 - t) * 140,
    });
  }

  // A crown of smaller lobes on the head's open side (crownX/Y, usually the
  // surface normal) gives the leading edge a billowing cartoon top.
  const crownLength = Math.hypot(Number(opts.crownX) || 0, Number(opts.crownY) || 0);
  if (crownLength) {
    const cx = opts.crownX / crownLength;
    const cy = opts.crownY / crownLength;
    const crowns = size > 12 ? 2 : 1;
    for (let i = 0; i < crowns; i++) {
      const back = between(0.05, 0.6) * size + i * size * 0.7;
      const radius = size * between(0.5, 0.72);
      sim.add({
        layer: opts.layer || "back",
        x: (Number(opts.x) || 0) - dirX * back + cx * size * between(0.55, 0.8),
        y: (Number(opts.y) || 0) - dirY * back + cy * size * between(0.55, 0.8),
        vx: vx * between(0.75, 0.95) + cx * between(8, 20),
        vy: vy * between(0.75, 0.95) + cy * between(8, 20),
        radius: radius * start,
        targetRadius: radius,
        ...(Number.isFinite(opts.rise) ? { rise: opts.rise } : {}),
        ...(Number.isFinite(opts.opacity) ? { opacity: opts.opacity } : {}),
        splitAt: between(160, 250),
        erodeAt: between(220, 320),
      });
    }
  }
}

/**
 * Clouds squeezed out of a contact. The normal points away from the surface
 * (floor 0,-1; left wall 1,0). `strength` (0..1) scales size, speed and
 * length; `bias` (-1..1) favours one tangent direction (+1 = along
 * (-ny, nx), i.e. right on a floor, down a left wall). `surfaceOffset` is how
 * far the streaks sit off the surface in cloud sizes (default 0.75); negative
 * values lay them on the surface face, as wall slides do. `pop` starts
 * the clouds near full size for impacts that must read instantly, and
 * `halfWidth` starts them at the edges of a wide contact such as two feet.
 * `opacity` defaults to rising with strength, so heavier hits look denser.
 */
export function emitSurfaceBurst(sim, opts = {}) {
  const x = Number(opts.x) || 0;
  const y = Number(opts.y) || 0;
  const nx = Number(opts.nx) || 0;
  const ny = Number.isFinite(opts.ny) ? opts.ny : -1;
  const tx = -ny;
  const ty = nx;
  const strength = clamp(Number(opts.strength) || 0, 0, 1);
  const bias = clamp(Number(opts.bias) || 0, -1, 1);
  const scale = Number(opts.scale) || 1;
  const layer = opts.layer || "back";
  const { between } = sim;
  // Harder contacts throw out denser, more solid cloud.
  const opacity = Number.isFinite(opts.opacity) ? opts.opacity : 0.8 + strength * 0.2;

  for (const side of [-1, 1]) {
    const weight = 1 + bias * side * 0.7;
    if (weight < 0.45 && strength < 0.5) continue;
    const size = (6 + strength * 9) * Math.sqrt(weight) * scale * between(0.9, 1.1);
    const speed = (70 + strength * 220) * weight * between(0.9, 1.1);
    const lift = size * (Number.isFinite(opts.surfaceOffset) ? opts.surfaceOffset : 0.75);
    // Lead clouds start at the edge of the contact (e.g. the feet), not under
    // the body where the fighter would hide them for the first frames.
    const reach = Math.max(size * 0.9, Number(opts.halfWidth) || 0);
    emitStreak(sim, {
      layer,
      x: x + tx * side * reach + nx * lift,
      y: y + ty * side * reach + ny * lift,
      dirX: tx * side,
      dirY: ty * side,
      size,
      length: size * (1.2 + strength * 1.6) * Math.max(0.6, weight),
      vx: tx * side * speed + nx * (12 + strength * 30),
      vy: ty * side * speed + ny * (12 + strength * 30),
      taper: 0.38,
      tailSpeed: 0.3,
      crownX: nx,
      crownY: ny,
      rise: opts.rise,
      pop: opts.pop,
      opacity,
    });
  }

  if (strength > 0.55 || opts.centerPuff) {
    const size = (4 + strength * 6) * scale;
    emitPuff(sim, {
      layer,
      x: x + nx * size,
      y: y + ny * size,
      vx: nx * (20 + strength * 50) + tx * bias * 30,
      vy: ny * (20 + strength * 50) + ty * bias * 30,
      size,
      lobes: 1 + Math.round(strength * 2),
      rise: opts.rise,
      pop: opts.pop,
      opacity,
    });
  }
}

/**
 * One blob scuffed off a wall by a sliding fighter. It sits on the wall face
 * itself (spilling just past the edge) and lingers there, so the slide leaves
 * a scuffed streak down the wall rather than a cloud around the fighter.
 */
export function emitWallScrape(sim, opts = {}) {
  const { between } = sim;
  const speedRatio = clamp(Number(opts.speedRatio) || 0, 0, 1);
  const away = Number(opts.awayX) < 0 ? -1 : 1;
  const radius = (3.5 + speedRatio * 3) * between(0.8, 1.2);
  sim.add({
    layer: opts.layer || "back",
    x: (Number(opts.x) || 0) - away * radius * between(0.2, 0.85),
    y: (Number(opts.y) || 0) + between(-3, 3),
    // Dust is dragged a little way down with the hand, then left behind.
    vx: -away * between(0, 8),
    vy: (Number(opts.slideVelocity) || 0) * between(0.08, 0.2),
    radius: radius * 0.7,
    targetRadius: radius * between(1.2, 1.45),
    growRate: 7,
    rise: 8,
    wobble: 5,
    drag: 3.2,
    splitAt: between(170, 270),
    erodeAt: between(230, 340),
    erodeRate: 12,
    opacity: 0.74 + speedRatio * 0.12,
  });
}

/** One blob left in the wake of a launching body; `progress` 0..1 thins it. */
export function emitWake(sim, opts = {}) {
  const { between } = sim;
  const progress = clamp(Number(opts.progress) || 0, 0, 1);
  const radius = (Number(opts.size) || 7) * (1 - progress * 0.6) * between(0.85, 1.15);
  sim.add({
    layer: opts.layer || "back",
    x: (Number(opts.x) || 0) + between(-2, 2),
    y: (Number(opts.y) || 0) + between(-3, 3),
    vx: (Number(opts.vx) || 0) * between(0.7, 1.1),
    vy: (Number(opts.vy) || 0) * between(0.7, 1.1),
    radius: radius * 0.7,
    targetRadius: radius,
    splitAt: between(150, 240),
    erodeAt: between(170, 260),
    erodeRate: 16,
    opacity: Number.isFinite(opts.opacity) ? opts.opacity : 0.88,
  });
}
