import { teamColor, TEAM_RED } from "../../../../shared/projectilePresentation";
import { sweep } from "../../../../shared/characters/gloopProjectile";
import { RENDER_LAYERS } from "../../scene/renderLayers";
import { fillPixelBlob, fillPixelEllipse, PIXEL_FX_SIZE, rasterizePixelBlob } from "../../powerups/pixelShapes.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const random = (a, b) => a + Math.random() * (b - a);
const COLORS = [0x0fb6b2, 0x169aaf, 0x1268b8, 0x25cbb4];
const CELL = PIXEL_FX_SIZE;
const snap = v => Math.round(v / CELL) * CELL;

// Stamps square brushes onto the FX grid, filling each covered cell once so
// translucent strokes don't darken where samples overlap.
// round: discs instead of squares, for brushes wide enough to show corners.
function stampCells(g, samples, color, alpha, round = false) {
  const filled = new Set();
  g.fillStyle(color, alpha);
  for (const { x, y, size } of samples) {
    const span = Math.max(1, Math.round(size / CELL));
    const col0 = Math.round(x / CELL - span / 2), row0 = Math.round(y / CELL - span / 2);
    const mid = (span - 1) / 2, reach = (span / 2) ** 2;
    for (let row = row0; row < row0 + span; row++) {
      for (let col = col0; col < col0 + span; col++) {
        if (round && span > 2 && (col - col0 - mid) ** 2 + (row - row0 - mid) ** 2 > reach) continue;
        const key = col * 100003 + row;
        if (filled.has(key)) continue;
        filled.add(key);
        g.fillRect(col * CELL, row * CELL, CELL, CELL);
      }
    }
  }
}

function fillPixelPolygon(g, points, color, alpha) {
  fillPixelBlob(g, rasterizePixelBlob(points, { ringCount: 0, grow: 0 }), color, alpha);
}

// A liquid bridge, thick where it joins each end and pinched between them.
// pinch 1 severs it at the waist.
function drawNeck(g, x0, y0, x1, y1, w0, w1, pinch, color, alpha) {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / CELL));
  const samples = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const waist = 1 - (1 - (2 * t - 1) ** 2) * (0.4 + 0.6 * pinch);
    const size = 2 * (w0 + (w1 - w0) * t) * waist;
    if (size >= CELL * 0.75) samples.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, size });
  }
  stampCells(g, samples, color, alpha, true);
}

export const slimeRadius = (collisionRadius, visualScale = 1.5) =>
  collisionRadius * clamp(visualScale / 1.5, 0.75, 1.25);

// Team and skin colouring shared by the ball and the bud it grows from.
function slimePalette(owner) {
  const crystal = (owner?._bbSkinTextureKey || owner?.texture?.key) === 'gloop__gloop-amethyst';
  const sourceColors = crystal ? [0x4215b8, 0x5633cb, 0x261080, 0x3976bc] : COLORS;
  const skinTint = color => crystal ? ({
    0x07529b: 0x201060, 0x16afa9: 0x4215b8, 0x15aaa9: 0x4215b8,
    0x16b6b0: 0x5633cb, 0xa2edcf: 0x8099d8, 0x9ee6ce: 0x8099d8,
    0x99e9c9: 0x5366b6, 0x11bbaa: 0x5633cb, 0x139ca9: 0x4215b8,
    0x0868b6: 0x301298, 0x0846ae: 0x261080, 0xf2f5aa: 0x8a9cdd,
    0x93edce: 0x4f7bbf, 0x74dcbc: 0x6755bb, 0x12afaf: 0x4215b8,
    0x13b5ad: 0x5633cb, 0x13abae: 0x4215b8,
  }[color] ?? color) : color;
  // Hand-selected cherry/coral ramp: keep glossy highlights and saturated depths.
  // Amethyst retains violet facets with ruby edges rather than losing its identity.
  const enemy = teamColor(owner) === TEAM_RED;
  const redRamp = {
    0x07529b: 0x9c2049, 0x16afa9: 0xeb4355, 0x15aaa9: 0xeb4355,
    0x16b6b0: 0xf55265, 0xa2edcf: 0xffc5b5, 0x9ee6ce: 0xffb7aa,
    0x99e9c9: crystal ? 0x67204d : 0x882333, 0x11bbaa: 0xe64a56, 0x139ca9: 0xdc3849,
    0x0868b6: crystal ? 0xac3575 : 0xd73346,
    0x0846ae: crystal ? 0x88305f : 0xc32e40,
    0xf2f5aa: 0xffefc8, 0x93edce: 0xffc9b7, 0x74dcbc: 0xffaa9d,
    0x12afaf: 0xef495f, 0x13b5ad: 0xf15a6a, 0x13abae: 0xdf385c,
  };
  const tint = color => enemy ? (redRamp[color] ?? 0xf05a69) : skinTint(color);
  const colors = enemy ? (crystal ? [0xd54375,0xf56785,0x942d76,0xff9b99] : [0xff5360,0xf33f4d,0xea3043,0xff857e]) : sourceColors;
  return { crystal, enemy, tint, colors };
}

// The throw's windup: a lump of Gloop swells out of his body toward the aim
// and strains on a neck, so the ball visibly comes from him. It follows him
// and hands over to the ball at release; offsets are the launch start
// relative to the owner.
export function createSlimeBud(scene, owner, { offsetX, offsetY, angle, radius, durationMs }) {
  const { tint, enemy } = slimePalette(owner);
  const neckG = scene.add.graphics().setDepth(RENDER_LAYERS.ATTACKS + 5);
  const blobG = scene.add.graphics().setDepth(RENDER_LAYERS.ATTACKS + 6);
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const reach = radius * 1.5;
  let age = 0, grown = 0, retracting = false, destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    neckG.destroy(); blobG.destroy();
  };
  function blob(size, stretch, color, alpha, ox = 0, oy = 0) {
    const points = [];
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2;
      const wave = 1 + 0.06 * Math.sin(a * 3 + age * 0.02);
      const lx = Math.cos(a) * size * wave, ly = Math.sin(a) * size * wave;
      // Stretched along the throw, the trailing half narrowing into the neck.
      const lead = lx * stretch * (lx < 0 ? 1.1 : 1), side = ly / stretch;
      points.push({ x: dx * lead - dy * side + ox, y: dy * lead + dx * side + oy });
    }
    const shape = rasterizePixelBlob(points, { ringCount: 2, grow: 0 });
    fillPixelBlob(blobG, shape, tint(color), alpha);
  }
  return {
    // false once it has nothing left to draw.
    update(delta) {
      if (destroyed || !owner?.active) { destroy(); return false; }
      age += delta;
      if (retracting) grown = Math.max(0, grown - delta / 90);
      else {
        const t = clamp(age / Math.max(1, durationMs), 0, 1);
        grown = 1 - (1 - t) ** 3;
        // A late release (remote latency) holds the lump; a lost one is reabsorbed.
        if (age > durationMs + 450) retracting = true;
      }
      if (retracting && grown <= 0) { destroy(); return false; }
      const rootX = owner.x + offsetX - dx * reach, rootY = owner.y + offsetY - dy * reach;
      const travel = reach * (0.3 + 0.7 * grown);
      const cx = rootX + dx * travel, cy = rootY + dy * travel;
      const size = radius * (0.4 + 0.6 * grown) * (1 + 0.05 * Math.sin(age * 0.045));
      const stretch = 1 + 0.3 * grown;
      neckG.clear(); blobG.clear();
      drawNeck(neckG, rootX, rootY, cx, cy, radius * 0.34, size * 0.45, grown * 0.6, tint(0x11bbaa), 0.98);
      drawNeck(neckG, rootX, rootY, cx, cy, radius * 0.2, size * 0.26, grown * 0.6, tint(0x139ca9), 0.98);
      blobG.setPosition(snap(cx), snap(cy));
      blob(size * (enemy ? 1.08 : 1.04), stretch, 0x99e9c9, enemy ? 0.95 : 0.48);
      blob(size, stretch, 0x11bbaa, 0.98);
      blob(size * 0.89, stretch, 0x139ca9, 0.98);
      blob(size * 0.7, stretch, 0x0868b6, 0.97, -dx * size * 0.12, size * 0.08);
      fillPixelEllipse(blobG, -size * 0.4, -size * 0.45, Math.max(CELL * 2, size * 0.2), size * 0.34, tint(0xf2f5aa), 0.93);
      return true;
    },
    retract() { retracting = true; },
    destroy,
  };
}

// One graphics batch for droplets/residue, one for the deformable liquid body.
// Effects are bounded and outlive the projectile briefly; shutdown owns all cleanup.
// spit: the root of the neck, relative to the owner, that the ball tears free of.
export function createSlimeVisual(scene, state, visualScale = 1.5, owner = null, spit = null) {
  const { crystal, enemy, tint, colors } = slimePalette(owner);
  const body = scene.add.graphics().setDepth(RENDER_LAYERS.ATTACKS + 6);
  const fx = scene.add.graphics().setDepth(RENDER_LAYERS.ATTACKS + 2);
  const r = state.collisionRadius * clamp(visualScale / 1.5, 0.75, 1.25);
  const drops = [], stains = [];
  let time = 0, trail = 0, finished = false, destroyed = false;
  // squash > 0 flattens the mass along the contact normal, < 0 stretches it;
  // both keep its area. The throw itself leaves it slightly stretched.
  let squash = -0.12, squashVelocity = 0, normal = { x: 0, y: -1 };
  let lastImpact = null, impactAge = 1000;
  // anchor: how firmly the underside is pinned to the last surface touched.
  // ripple: surface waves excited by an impact, decaying on their own.
  let anchor = 0, ripple = 0, freeAge = 1000;
  let flightAngle = 0, flightStretch = 1;
  // Spat from Gloop: the neck to his body pinches off early in the flight,
  // and the mass leaves drawn out along the throw, springing back as it flies.
  const SNAP_MS = 95, SPIT_MS = 160;
  let spitAge = spit ? 0 : Infinity, snapped = !spit;
  if (spit) {
    const launch = Math.atan2(state.vy, state.vx);
    normal = { x: Math.cos(launch), y: Math.sin(launch) };
    squash = -0.3;
  }

  // A tapered liquid filament with a hanging head, stepped onto the pixel grid.
  function ribbon(x, y, tailX, tailY, width, color, alpha) {
    const dx = x - tailX, dy = y - tailY;
    const steps = Math.max(2, Math.ceil(Math.hypot(dx, dy) / CELL));
    const samples = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, w = width * Math.pow(Math.sin(Math.PI * t), 0.7) * t;
      samples.push({ x: tailX + dx * t, y: tailY + dy * t, size: w * 2 });
    }
    stampCells(fx, samples, tint(color), alpha);
  }
  function pixelLine(g, x0, y0, x1, y1, size, color, alpha) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / CELL));
    const samples = [];
    for (let i = 0; i <= steps; i++) samples.push({ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, size });
    stampCells(g, samples, tint(color), alpha);
  }

  function droplet(x, y, vx, vy, size, life = 650) {
    if (drops.length >= 80) drops.shift();
    drops.push({ x, y, vx, vy, size, life, maxLife: life, color: colors[Math.floor(random(0, colors.length))] });
  }
  function impact(hit) {
    lastImpact = hit; impactAge = 0;
    normal = { x: hit.nx, y: hit.ny };
    // The mass is still travelling into the surface, so it starts flattening at once.
    squashVelocity = Math.max(squashVelocity, clamp(hit.speed / 220, 1, 3.5));
    ripple = Math.max(ripple, clamp(hit.speed / 700, 0.35, 1));
    const size = r * (hit.terminal ? 1.55 : 1.15);
    stains.push({ ...hit, size, age: 0, life: hit.terminal ? 2300 : 1900,
      beads: Array.from({ length: 7 }, () => ({ offset: random(-1, 1), size: random(0.1, 0.28), drip: random(8, 24) })) });
    const tx = -hit.ny, ty = hit.nx;
    for (let i = 0; i < (hit.terminal ? 16 : 10); i++) {
      const tangent = random(-105, 105), outward = random(15, Math.min(110, hit.speed * 0.25 + 25));
      droplet(hit.x + hit.nx * 3, hit.y + hit.ny * 3,
        tx * tangent + hit.nx * outward, ty * tangent + hit.ny * outward,
        random(1.5, 4.2), random(380, 800));
    }
  }
  function contour(scale, color, alpha, ox = 0, oy = 0) {
    const points = [];
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2;
      // Slow, coherent lobes instead of noisy jitter. Gravity draws the underside down.
      const wave = 1 + 0.065 * Math.sin(a * 3 + time * 0.0025) + 0.035 * Math.sin(a * 5 - time * 0.003);
      const sag = Math.pow(Math.max(0, Math.sin(a)), 5) * (0.09 + 0.035 * Math.sin(time * 0.009));
      // Higher surface modes ring after an impact, aligned to the contact.
      const rel = a - Math.atan2(normal.y, normal.x);
      const ring = 1 + ripple * (0.07 * Math.cos(3 * rel) * Math.sin(impactAge * 0.031)
        + 0.05 * Math.cos(4 * rel) * Math.sin(impactAge * 0.043 + 1));
      let x = Math.cos(a) * r * scale * wave * ring + ox;
      let y = (Math.sin(a) * wave * ring + sag * 1.8) * r * scale + oy;
      // Area-preserving squash along the contact normal.
      const keep = 1 - squash;
      let along = (x * normal.x + y * normal.y) * keep;
      const across = (-x * normal.y + y * normal.x) / keep;
      // While pinned, the underside spreads into a flat patch instead of a round belly.
      if (anchor > 0 && squash > 0) {
        const plane = -r * scale * keep * (1 - 0.2 * anchor * clamp(squash * 3, 0, 1));
        along = Math.max(along, plane);
      }
      x = normal.x * along - normal.y * across;
      y = normal.y * along + normal.x * across;
      // Then stretch along the direction of travel, also preserving area.
      const fx0 = Math.cos(flightAngle), fy0 = Math.sin(flightAngle);
      const lead = (x * fx0 + y * fy0) * flightStretch, side = (-x * fy0 + y * fx0) / flightStretch;
      points.push({ x: fx0 * lead - fy0 * side, y: fy0 * lead + fx0 * side });
    }
    const blob = rasterizePixelBlob(points, { ringCount: 2, grow: 0 });
    fillPixelBlob(body, blob, tint(color), alpha);
    return blob;
  }
  // Long pointed crystals, darkened by the violet liquid around them.
  function shard(graphics, x, y, size, angle, alpha = 1) {
    const point = (px, py) => ({
      x: x + (px * Math.cos(angle) - py * Math.sin(angle)) * size,
      y: y + (px * Math.sin(angle) + py * Math.cos(angle)) * size,
    });
    const tip = point(-0.08, -1.3), left = point(-0.39, -0.25);
    const lowerLeft = point(-0.32, 0.66), base = point(0.1, 0.85);
    const lowerRight = point(0.37, 0.55), right = point(0.32, -0.35);
    const ridge = point(0.02, -0.13);
    const faces = [
      [[tip, ridge, base, lowerLeft, left], 0x3150b5],
      [[tip, right, lowerRight, base, ridge], 0x7450b8],
      [[tip, left, ridge], 0x4275bf],
    ];
    for (const [vertices, color] of faces) fillPixelPolygon(graphics, vertices, color, alpha);
    const outline = rasterizePixelBlob([tip, right, lowerRight, base, lowerLeft, left], { ringCount: 1, grow: 0 });
    fillPixelBlob(graphics, outline, 0x241064, alpha, d => d === 1);
  }
  function update(delta) {
    if (destroyed) return;
    const dt = Math.min(Math.max(delta, 0), 100) / 1000;
    time += delta; impactAge += delta;
    fx.clear(); body.clear();
    for (let i = stains.length - 1; i >= 0; i--) {
      const stain = stains[i]; stain.age += delta;
      if (stain.age >= stain.life) { stains.splice(i, 1); continue; }
      const alpha = Math.min(1, (stain.life - stain.age) / 700);
      const spread = 0.65 + 0.35 * (1 - Math.exp(-stain.age / 75));
      const tx = -stain.ny, ty = stain.nx;
      const wall = Math.abs(stain.nx) > 0.5;
      const film = Math.min(5, stain.size * 0.18);
      const filmCells = Math.max(CELL * 2, film);
      fillPixelEllipse(fx, stain.x + stain.nx * 1.5, stain.y + stain.ny * 1.5,
        wall ? filmCells + CELL : stain.size * 2.5 * spread, wall ? stain.size * 2.5 * spread : filmCells + CELL,
        tint(0x07529b), alpha * 0.5);
      fillPixelEllipse(fx, stain.x + stain.nx * 3, stain.y + stain.ny * 3,
        wall ? filmCells : stain.size * 2.2 * spread, wall ? stain.size * 2.2 * spread : filmCells,
        tint(0x16afa9), alpha * 0.72);
      for (const bead of stain.beads) {
        const x = stain.x + tx * bead.offset * stain.size * spread + stain.nx * 3;
        const y = stain.y + ty * bead.offset * stain.size * spread + stain.ny * 3;
        const drip = wall ? bead.drip * Math.min(1, stain.age / 1000) : 0;
        if (wall) ribbon(x + Math.sin(bead.offset * 7) * 2, y + drip + 5, x, y - 3,
          bead.size * stain.size * 0.65, 0x15aaa9, alpha * 0.85);
        else ribbon(x + bead.offset * 8, y + 1, x - bead.offset * 12, y - 1,
          bead.size * stain.size * 0.65, 0x16b6b0, alpha * 0.7);
      }
      pixelLine(fx, stain.x - tx * stain.size * 0.5 + stain.nx * 4, stain.y - ty * stain.size * 0.5 + stain.ny * 4,
        stain.x + tx * stain.size * 0.25 + stain.nx * 4, stain.y + ty * stain.size * 0.25 + stain.ny * 4,
        CELL, 0xa2edcf, alpha * 0.55);
      if (crystal && stain.size > 8) {
        for (let j = -1; j <= 1; j++) shard(fx,
          stain.x + tx * j * stain.size * 0.48 + stain.nx * 3,
          stain.y + ty * j * stain.size * 0.48 + stain.ny * 3,
          stain.size * 0.23, j * 0.6 + Math.atan2(stain.nx, -stain.ny), alpha);
      }
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.life -= delta;
      if (d.life <= 0) { drops.splice(i, 1); continue; }
      d.vy += 460 * dt; d.vx *= Math.exp(-1.1 * dt);
      const dx = d.vx * dt, dy = d.vy * dt;
      let contact = null;
      const terrain = state.mapCollisionRects || [];
      for (const rect of terrain) {
        const hit = sweep(d.x, d.y, dx, dy, d.size, rect);
        if (hit && (!contact || hit.t < contact.t)) contact = hit;
      }
      if (dy > 0 && Number.isFinite(state.floorY)) {
        const t = (state.floorY - d.size - d.y) / dy;
        if (t >= 0 && t <= 1 && (!contact || t < contact.t)) contact = { t, nx: 0, ny: -1 };
      }
      if (contact) {
        if (stains.length >= 32) stains.shift();
        stains.push({ x: d.x + dx * contact.t - contact.nx * d.size,
          y: d.y + dy * contact.t - contact.ny * d.size,
          nx: contact.nx, ny: contact.ny, size: d.size * 1.4,
          age: 0, life: 850, beads: [] });
        drops.splice(i, 1); continue;
      }
      d.x += dx; d.y += dy;
      const alpha = Math.min(1, d.life / 200) * 0.8;
      const length = 8 + Math.min(19, Math.hypot(d.vx, d.vy) * 0.09);
      const angle = Math.atan2(d.vy + 70, d.vx);
      ribbon(d.x, d.y, d.x - Math.cos(angle) * length, d.y - Math.sin(angle) * length,
        d.size * 1.1, d.color, alpha);
      // One bright cell on the head reads as the wet glint at pixel scale.
      stampCells(fx, [{ x: d.x - CELL * 0.5, y: d.y - CELL, size: CELL }], tint(0x9ee6ce), alpha * 0.6);
    }
    if (finished) return drops.length > 0 || stains.length > 0;
    // Underdamped jelly spring. In contact it chases a stiff target: flatten
    // fast, then rebound into a stretch as the stored energy pushes off. Once
    // free it rings at its own slower frequency and settles over a few wobbles.
    const contact = state.contactHold;
    let target = 0, stiffness = 380, damping = 6.5;
    if (contact) {
      const phase = 1 - contact.remaining / contact.duration;
      const peak = clamp(contact.speed / 900, 0.15, 0.38);
      const smooth = t => t * t * (3 - 2 * t);
      target = peak + (-peak * 0.3 - peak) * smooth(clamp((phase - 0.45) / 0.35, 0, 1));
      stiffness = 1400; damping = 32;
      anchor = 1; freeAge = 0;
    } else {
      anchor *= Math.exp(-dt / 0.06);
      freeAge += delta;
    }
    for (let remaining = dt; remaining > 0;) {
      const step = Math.min(1 / 240, remaining); remaining -= step;
      squashVelocity += (stiffness * (target - squash) - damping * squashVelocity) * step;
      squash += squashVelocity * step;
    }
    squash = clamp(squash, -0.45, 0.6);
    ripple *= Math.exp(-dt / 0.28);
    const speed = Math.hypot(state.vx, state.vy);
    if (speed > 1) flightAngle = Math.atan2(state.vy, state.vx);
    flightStretch = 1 + clamp(speed / 1100, 0, 0.3);
    // How far the deformed outline reaches toward the surface: the support of
    // the squash-then-stretch transform of a circle, plus the gravity sag.
    const keep = 1 - squash;
    const fx0 = Math.cos(flightAngle), fy0 = Math.sin(flightAngle);
    const nLead = (normal.x * fx0 + normal.y * fy0) * flightStretch;
    const nSide = (-normal.x * fy0 + normal.y * fx0) / flightStretch;
    const mx = fx0 * nLead - fy0 * nSide, my = fy0 * nLead + fx0 * nSide;
    const reach = r * (Math.hypot((mx * normal.x + my * normal.y) * keep, (-mx * normal.y + my * normal.x) / keep)
      + 0.16 * Math.max(0, -normal.y));
    let bodyX = state.x, bodyY = state.y;
    if (lastImpact && !lastImpact.terminal) {
      // The pinned underside rests on the surface. Just after push-off the
      // stretched mass is briefly kept from poking through it. That lift
      // fades within moments: the surface is finite, and a ball that drops
      // past its edge must fall with its physics rather than hover at it.
      const height = (state.x - lastImpact.x) * normal.x + (state.y - lastImpact.y) * normal.y;
      const pinned = clamp(reach - height, -r, r * 0.5);
      const fade = clamp(freeAge / 140, 0, 1);
      const lift = clamp(reach - height, 0, r * 0.5) * (1 - fade * fade * (3 - 2 * fade));
      const offset = anchor * pinned + (1 - anchor) * lift;
      bodyX += normal.x * offset; bodyY += normal.y * offset;
    }
    body.setPosition(snap(bodyX), snap(bodyY));
    if (spitAge < SPIT_MS && owner?.active) {
      spitAge += delta;
      const rootX = owner.x + spit.offsetX, rootY = owner.y + spit.offsetY;
      const midX = (rootX + state.x) / 2, midY = (rootY + state.y) / 2;
      if (!snapped && spitAge >= SNAP_MS) {
        snapped = true;
        const len = Math.hypot(state.x - rootX, state.y - rootY) || 1;
        const ux = (state.x - rootX) / len, uy = (state.y - rootY) / len;
        for (let i = 0; i < 7; i++) {
          const along = i < 2 ? random(-70, -25) : random(30, 140), across = random(-55, 55);
          droplet(midX, midY, ux * along - uy * across, uy * along + ux * across - 40, random(1.6, 3.4), random(320, 560));
        }
      }
      if (!snapped) {
        const pinch = clamp(spitAge / SNAP_MS, 0, 1);
        drawNeck(fx, rootX, rootY, body.x, body.y, r * 0.34 * (1 - 0.4 * pinch), r * 0.45, pinch, tint(0x11bbaa), 0.98);
        drawNeck(fx, rootX, rootY, body.x, body.y, r * 0.2 * (1 - 0.4 * pinch), r * 0.26, pinch, tint(0x139ca9), 0.98);
      } else {
        // The torn ends recoil: a stub sinks back into him, a tail into the ball.
        const left = clamp(1 - (spitAge - SNAP_MS) / (SPIT_MS - SNAP_MS), 0, 1);
        const stubX = rootX + (midX - rootX) * 0.8 * left, stubY = rootY + (midY - rootY) * 0.8 * left;
        drawNeck(fx, rootX, rootY, stubX, stubY, r * 0.26 * left, CELL * 0.5, 0, tint(0x11bbaa), 0.98);
        const tailX = body.x + (midX - body.x) * 0.8 * left, tailY = body.y + (midY - body.y) * 0.8 * left;
        drawNeck(fx, body.x, body.y, tailX, tailY, r * 0.3 * left, CELL * 0.5, 0, tint(0x11bbaa), 0.98);
      }
    }
    body.setRotation(0); body.setScale(1);
    if (lastImpact && !lastImpact.terminal && impactAge < 320) {
      const attachmentX = lastImpact.x, attachmentY = lastImpact.y;
      const distance = Math.hypot(body.x - attachmentX, body.y - attachmentY);
      if (distance < r * 4) ribbon(body.x, body.y, attachmentX, attachmentY,
        r * 0.45 * (1 - impactAge / 320), 0x13abae, 0.75);
    }
    // Layered translucent skin, dark lower mass and asymmetric wet reflections.
    contour(enemy ? 1.08 : 1.04, 0x99e9c9, enemy ? 0.95 : 0.48);
    const skin = contour(1, 0x11bbaa, 0.98);
    contour(crystal ? 0.95 : 0.89, 0x139ca9, 0.98);
    // The dense core lags the skin, sloshing against the squash velocity.
    const slosh = clamp(squashVelocity * 0.012, -0.12, 0.12) * r;
    const sx = -normal.x * slosh, sy = -normal.y * slosh;
    contour(crystal ? 0.81 : 0.73, 0x0868b6, 0.97, r * 0.02 + sx * 0.6, r * 0.09 + sy * 0.6);
    contour(crystal ? 0.63 : 0.56, 0x0846ae, 0.94, -r * 0.06 + sx, r * 0.13 + sy);
    fillPixelEllipse(body, -r * 0.44, -r * 0.47, Math.max(CELL * 2, r * 0.2), r * 0.36, tint(0xf2f5aa), 0.93);
    fillPixelEllipse(body, r * 0.42, -r * 0.51, Math.max(CELL, r * 0.13), r * 0.28, tint(0xf2f5aa), 0.93);
    if (squash < 0.08) {
      // Lower-right rim light along the skin's inner ring.
      fillPixelBlob(body, skin, tint(0x93edce), 0.65, (d, x, y) => {
        const a = Math.atan2(y, x);
        return d === 2 && a > 0.1 && a < 1.05;
      });
    }
    const bubbles = [];
    for (let i = 0; i < 3; i++) {
      const a = time * 0.0009 + i * 2.3;
      bubbles.push({ x: Math.cos(a) * r * 0.43, y: Math.sin(a * 1.3) * r * 0.36, size: r * (0.13 + i * 0.036) });
    }
    stampCells(body, bubbles, tint(0x74dcbc), 0.4);
    if (crystal) {
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3 + time * 0.00035;
        shard(body, Math.cos(a) * r * 0.55,
          Math.sin(a) * r * 0.48 + squash * r * 0.3,
          r * (i === 0 ? 0.43 : 0.36), Math.sin(a) * 0.35, 0.96);
      }
    }
    // Attached liquid necks droop in world gravity, then shed real falling droplets.
    for (let i = 0; i < (state.contactHold ? 0 : 2); i++) {
      const phase = (time / (250 + i * 95) + i * 0.43) % 1;
      const x = state.x - Math.sign(state.vx || 1) * r * (0.35 + i * 0.28);
      const y = state.y + r * 0.65;
      const length = r * (0.18 + phase * 0.55);
      pixelLine(fx, x, y, x - state.vx * 0.008 * phase, y + length, r * (0.16 - phase * 0.07), 0x12afaf, 0.85);
      ribbon(x - state.vx * 0.008 * phase, y + length + 3, x, y - 4,
        r * (0.14 + phase * 0.025), 0x13b5ad, 0.9);
    }
    trail += delta;
    if (trail >= 55 && !state.contactHold) {
      trail %= 55;
      droplet(state.x - Math.sign(state.vx || 1) * r * 0.65, state.y + r * 0.6,
        state.vx * 0.15 + random(-15, 15), Math.max(20, state.vy * 0.12), random(1.4, 2.8), 480);
    }
    return true;
  }
  return {
    body, impact, update,
    finish({ onCharacter = false } = {}) {
      if (finished) return;
      finished = true;
      if (!onCharacter && !lastImpact?.terminal) {
        for (let i = 0; i < 12; i++) droplet(state.x, state.y, random(-100, 100), random(-100, 40), random(2, 4));
      }
      body.clear();
    },
    destroy({ skipBody = false } = {}) {
      if (destroyed) return;
      destroyed = true;
      if (!skipBody) body.destroy();
      fx.destroy();
    },
  };
}
