const { getResolvedCharacterAttackConfig } = require("./characterTuning");
const SLIME = getResolvedCharacterAttackConfig("gloop", "slimeball");
// Shared fixed-step slime physics. Collision normals drive both rebound and animation.
const STEP_MS = 1000 / 120;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function getSlimeLaunchStepCount(distance, cfg = SLIME) {
  const speedMultiplier = Math.max(
    0.1,
    Number(cfg?.launchSpeedMultiplier) || 1,
  );
  return Math.max(
    1,
    Math.round(
      clamp(0.55 + Math.max(0, Number(distance) || 0) / 650, 0.55, 1.55) *
        120 /
        speedMultiplier,
    ),
  );
}

function sweep(x, y, dx, dy, r, rect) {
  const { left, right, top, bottom } = rect;
  if (![left, right, top, bottom].every(Number.isFinite)) return null;
  let hit = null;
  const consider = (t, nx, ny) => {
    if (t >= -1e-8 && t <= 1 && dx * nx + dy * ny < -1e-8 && (!hit || t < hit.t))
      hit = { t: Math.max(0, t), nx, ny };
  };
  // Flat faces followed by rounded corners: a circle, not an oversized square.
  if (dx > 0) { const t = (left - r - x) / dx; const yy = y + dy * t; if (yy >= top && yy <= bottom) consider(t, -1, 0); }
  if (dx < 0) { const t = (right + r - x) / dx; const yy = y + dy * t; if (yy >= top && yy <= bottom) consider(t, 1, 0); }
  if (dy > 0) { const t = (top - r - y) / dy; const xx = x + dx * t; if (xx >= left && xx <= right) consider(t, 0, -1); }
  if (dy < 0) { const t = (bottom + r - y) / dy; const xx = x + dx * t; if (xx >= left && xx <= right) consider(t, 0, 1); }
  const aa = dx * dx + dy * dy;
  if (aa > 0) for (const cx of [left, right]) for (const cy of [top, bottom]) {
    const ox = x - cx, oy = y - cy;
    const b = ox * dx + oy * dy, c = ox * ox + oy * oy - r * r;
    const disc = b * b - aa * c;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / aa;
    const hx = x + dx * t - cx, hy = y + dy * t - cy;
    if ((cx === left ? hx <= 0 : hx >= 0) && (cy === top ? hy <= 0 : hy >= 0))
      consider(t, hx / r, hy / r);
  }
  // Recover a launch slightly inside terrain without tunneling through it.
  const px = clamp(x, left, right), py = clamp(y, top, bottom);
  const distance = Math.hypot(x - px, y - py);
  if (distance < r - 0.001) {
    if (distance > 0) {
      const nx = (x - px) / distance, ny = (y - py) / distance;
      if (dx * nx + dy * ny < 0) hit = { t: 0, nx, ny, push: r - distance };
    } else {
      const faces = [{ d: x - left, nx: -1, ny: 0 }, { d: right - x, nx: 1, ny: 0 },
        { d: y - top, nx: 0, ny: -1 }, { d: bottom - y, nx: 0, ny: 1 }];
      const face = faces.sort((a, b) => a.d - b.d)[0];
      hit = { t: 0, ...face, push: r + face.d };
    }
  }
  return hit;
}

function slimeLaunch(pose, target, cfg) {
  const distance = Math.hypot(target.x - pose.x, target.y - pose.y);
  if (Number.isFinite(cfg.maxThrowRange) && distance > cfg.maxThrowRange) {
    const ratio = cfg.maxThrowRange / distance;
    target = { x: pose.x + (target.x - pose.x) * ratio,
      y: pose.y + (target.y - pose.y) * ratio };
  }
  const direction = target.x < pose.x ? -1 : 1;
  const start = { x: pose.x + direction * (pose.width || 80) * cfg.forwardOffset,
    y: pose.y - (pose.height || 100) * cfg.verticalOffset };
  const dx = target.x - start.x, dy = target.y - start.y;
  // Solve the same discrete gravity/drag integrator used in flight, for a lob
  // whose flight time grows with distance. No decorative Bezier approximation.
  const steps = getSlimeLaunchStepCount(Math.hypot(dx, dy), cfg);
  const dt = STEP_MS / 1000, damping = Math.exp(-cfg.airDrag * dt);
  let horizontal = 0, velocity = 1;
  for (let i = 0; i < steps; i++) { velocity *= damping; horizontal += velocity * dt; }
  let vx = dx / horizontal;
  let vy = (dy - cfg.gravity * dt * dt * steps * (steps + 1) / 2) / (steps * dt);
  // A finite throw impulse: elevation spends the same speed budget as distance.
  // Keep the preview and authoritative release on this exact launch calculation.
  if (Number.isFinite(cfg.maxUpwardSpeed)) vy = Math.max(vy, -cfg.maxUpwardSpeed);
  const speedLimit = cfg.maxLaunchSpeed;
  const requestedSpeed = Math.hypot(vx, vy);
  if (Number.isFinite(speedLimit) && requestedSpeed > speedLimit) {
    vx *= speedLimit / requestedSpeed;
    vy *= speedLimit / requestedSpeed;
  }
  return { start, angle: Math.atan2(vy, vx), speed: Math.hypot(vx, vy), initialVy: vy,
    direction, target: { ...target }, physicsVersion: 2 };
}

function sampleSlimePath(launch, cfg, rects = [], { stopAtFirstImpact = false } = {}) {
  const state = { ...cfg, x: launch.start.x, y: launch.start.y,
    vx: Math.cos(launch.angle) * launch.speed, vy: launch.initialVy };
  const points = [{ x: state.x, y: state.y }], impacts = [];
  for (let i = 0; i < 720 && !state.done; i++) {
    const contacts = advanceSlimeball(state, STEP_MS, rects);
    impacts.push(...contacts);
    if (stopAtFirstImpact && contacts.length) {
      points.push({ x: state.x, y: state.y });
      break;
    }
    if (i % 4 === 0 || contacts.length || state.done) points.push({ x: state.x, y: state.y });
  }
  return { points, impacts, startX: launch.start.x, startY: launch.start.y, endX: state.x, endY: state.y };
}

function advanceSlimeball(s, deltaMs, rects = [], onSegment = null) {
  const impacts = [];
  s._slimeAccumulator = (s._slimeAccumulator || 0) + Math.max(0, Number(deltaMs) || 0);
  const r = s.collisionRadius ?? SLIME.collisionRadius;
  const surfaces = [...rects];
  if (Number.isFinite(s.floorY)) surfaces.push({ left: -1e7, right: 1e7, top: s.floorY, bottom: 1e7 });
  if (Number.isFinite(s.worldMinX)) surfaces.push({ left: -1e7, right: s.worldMinX, top: -1e7, bottom: 1e7 });
  if (Number.isFinite(s.worldMaxX)) surfaces.push({ left: s.worldMaxX, right: 1e7, top: -1e7, bottom: 1e7 });
  while (!s.done && s._slimeAccumulator + 1e-7 >= STEP_MS) {
    s._slimeAccumulator -= STEP_MS;
    s.elapsed = (s.elapsed || 0) + STEP_MS;
    if (s.contactHold) {
      s.contactHold.remaining -= STEP_MS;
      if (s.contactHold.remaining > 0) {
        if (onSegment?.({ x: s.x, y: s.y }, s) === true) s.done = true;
        if (s.elapsed >= (s.maxLifetimeMs ?? SLIME.maxLifetimeMs)) s.done = true;
        continue;
      }
      s.reboundImpulse = { vx: s.contactHold.vx, vy: s.contactHold.vy, elapsed: 0, duration: 50 };
      s.contactHold = null;
    }
    let remaining = STEP_MS / 1000;
    if (s.reboundImpulse) {
      const impulse = s.reboundImpulse;
      const before = impulse.elapsed / impulse.duration;
      impulse.elapsed = Math.min(impulse.duration, impulse.elapsed + STEP_MS);
      const after = impulse.elapsed / impulse.duration;
      // Ease the stored elastic impulse into outward velocity, then gravity
      // naturally slows the ascent. Shared by reticle, server and rendering.
      const ease = t => t * t * (3 - 2 * t);
      const fraction = ease(after) - ease(before);
      s.vx += impulse.vx * fraction; s.vy += impulse.vy * fraction;
      if (after >= 1) s.reboundImpulse = null;
    }
    s.vy += (s.gravity ?? SLIME.gravity) * remaining;
    s.vx *= Math.exp(-(s.airDrag ?? SLIME.airDrag) * remaining);
    for (let contact = 0; contact < 4 && remaining > 1e-7 && !s.done; contact++) {
      const dx = s.vx * remaining, dy = s.vy * remaining;
      let hit = null;
      for (const rect of surfaces) {
        const candidate = sweep(s.x, s.y, dx, dy, r, rect);
        if (candidate && (!hit || candidate.t < hit.t)) hit = candidate;
      }
      const t = hit ? hit.t : 1;
      const from = { x: s.x, y: s.y };
      s.x += dx * t; s.y += dy * t;
      s.traveled = (s.traveled || 0) + Math.hypot(dx * t, dy * t);
      if (onSegment?.(from, s) === true) { s.done = true; break; }
      if (!hit) break;
      s.x += hit.nx * ((hit.push || 0) + 0.01);
      s.y += hit.ny * ((hit.push || 0) + 0.01);
      const normalSpeed = Math.max(0, -(s.vx * hit.nx + s.vy * hit.ny));
      const count = s.bounceCount || 0;
      // Later rebounds retain more lift so the second bounce remains useful and
      // readable instead of collapsing almost immediately after the first.
      const successiveBounceMultiplier = clamp(
        s.successiveBounceMultiplier ?? SLIME.successiveBounceMultiplier ?? 0.85,
        0,
        1,
      );
      const restitution = clamp(s.bounceDampingY ?? SLIME.bounceDampingY, 0, 1) *
        (count === 0 ? 1 : successiveBounceMultiplier);
      const terminal = count >= Math.max(0, s.maxBounces ?? SLIME.maxBounces) || normalSpeed * restitution < (s.minBounceSpeed ?? SLIME.minBounceSpeed);
      impacts.push({ x: s.x - hit.nx * r, y: s.y - hit.ny * r,
        nx: hit.nx, ny: hit.ny, speed: normalSpeed, terminal });
      if (terminal) { s.done = true; break; }
      s.bounceCount = count + 1;
      s.reboundImpulse = null;
      const tangentX = s.vx + normalSpeed * hit.nx;
      const tangentY = s.vy + normalSpeed * hit.ny;
      const friction = clamp(s.bounceDampingX ?? SLIME.bounceDampingX, 0, 1);
      s.vx = tangentX * friction + hit.nx * normalSpeed * restitution;
      s.vy = tangentY * friction + hit.ny * normalSpeed * restitution;
      // Viscous dwell: impact energy is absorbed while the mass spreads,
      // then stored elastic energy pulls it off the surface.
      const duration = clamp(105 + normalSpeed * 0.15, 110, 180);
      s.contactHold = { remaining: duration, duration, vx: s.vx, vy: s.vy,
        nx: hit.nx, ny: hit.ny, speed: normalSpeed };
      s.vx = 0; s.vy = 0;
      remaining = 0;
    }
    if (s.elapsed >= (s.maxLifetimeMs ?? SLIME.maxLifetimeMs) || s.traveled >= (s.range ?? SLIME.range)) s.done = true;
  }
  return impacts;
}
module.exports = {
  STEP_MS,
  sweep,
  advanceSlimeball,
  slimeLaunch,
  sampleSlimePath,
  getSlimeLaunchStepCount,
};
