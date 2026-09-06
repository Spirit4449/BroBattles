import { sweep } from "../../shared/gloopProjectile";
import { RENDER_LAYERS } from "../../gameScene/renderLayers";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const random = (a, b) => a + Math.random() * (b - a);
const COLORS = [0x0fb6b2, 0x169aaf, 0x1268b8, 0x25cbb4];

// One graphics batch for droplets/residue, one for the deformable liquid body.
// Effects are bounded and outlive the projectile briefly; shutdown owns all cleanup.
export function createSlimeVisual(scene, state, visualScale = 1.5) {
  const body = scene.add.graphics().setDepth(RENDER_LAYERS.ATTACKS + 6);
  const fx = scene.add.graphics().setDepth(RENDER_LAYERS.ATTACKS + 2);
  const r = state.collisionRadius * clamp(visualScale / 1.5, 0.75, 1.25);
  const drops = [], stains = [];
  let time = 0, trail = 0, finished = false, destroyed = false;
  let compression = 0, springVelocity = 0, normal = { x: 0, y: -1 };
  let lastImpact = null, impactAge = 1000;
  let deformAngle = 0, deformAxis = 1, contactOffset = 0;

  // A tapered liquid filament with a hanging head, never a circular particle.
  function ribbon(x, y, tailX, tailY, width, color, alpha) {
    const dx = x - tailX, dy = y - tailY, length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length, ny = dx / length;
    fx.fillStyle(color, alpha); fx.beginPath(); fx.moveTo(tailX, tailY);
    for (let i = 1; i <= 20; i++) {
      const t = i / 20, w = width * Math.pow(Math.sin(Math.PI * t), 0.7) * t;
      fx.lineTo(tailX + dx * t + nx * w, tailY + dy * t + ny * w);
    }
    for (let i = 19; i >= 0; i--) {
      const t = i / 20, w = width * Math.pow(Math.sin(Math.PI * t), 0.7) * t;
      fx.lineTo(tailX + dx * t - nx * w, tailY + dy * t - ny * w);
    }
    fx.closePath(); fx.fillPath();
  }

  function droplet(x, y, vx, vy, size, life = 650) {
    if (drops.length >= 80) drops.shift();
    drops.push({ x, y, vx, vy, size, life, maxLife: life, color: COLORS[Math.floor(random(0, COLORS.length))] });
  }
  function impact(hit) {
    lastImpact = hit; impactAge = 0;
    normal = { x: hit.nx, y: hit.ny };
    compression = 0;
    springVelocity = clamp(hit.speed / 90, 1.5, 5);
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
    body.fillStyle(color, alpha);
    body.beginPath();
    for (let i = 0; i <= 64; i++) {
      const a = i / 64 * Math.PI * 2;
      // Slow, coherent lobes instead of noisy jitter. Gravity draws the underside down.
      const wave = 1 + 0.065 * Math.sin(a * 3 + time * 0.0025) + 0.035 * Math.sin(a * 5 - time * 0.003);
      const sag = Math.pow(Math.max(0, Math.sin(a)), 5) * (0.09 + 0.035 * Math.sin(time * 0.009));
      let x = Math.cos(a) * r * scale * wave + ox;
      let y = (Math.sin(a) * wave + sag * 1.8) * r * scale + oy;
      const nx = Math.cos(deformAngle), ny = Math.sin(deformAngle);
      const along = x * nx + y * ny, across = -x * ny + y * nx;
      x = nx * along * deformAxis - ny * across / Math.sqrt(deformAxis);
      y = ny * along * deformAxis + nx * across / Math.sqrt(deformAxis);
      // Deform only the contact-facing mass. The far side keeps its rounded
      // silhouette while the underside flattens and spreads along the surface.
      if (compression > 0 && lastImpact) {
        const alongContact = x * normal.x + y * normal.y;
        const tangent = -x * normal.y + y * normal.x;
        const weight = Math.pow(clamp((0.65 - alongContact / r) / 1.4, 0, 1), 0.8);
        let pushed = alongContact + compression * r * weight * 0.85;
        const spread = tangent * (1 + compression * weight * 0.75);
        if (state.contactHold) {
          // A broad flat contact patch across the whole underside, not a dent.
          const plane = -r + contactOffset + 0.3;
          pushed = Math.max(pushed, plane);
        }
        x = normal.x * pushed - normal.y * spread;
        y = normal.y * pushed + normal.x * spread;
      }
      if (i === 0) body.moveTo(x, y); else body.lineTo(x, y);
    }
    body.closePath(); body.fillPath();
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
      fx.fillStyle(0x07529b, alpha * 0.5);
      fx.fillEllipse(stain.x + stain.nx * 1.5, stain.y + stain.ny * 1.5,
        wall ? film + 1 : stain.size * 2.5 * spread, wall ? stain.size * 2.5 * spread : film + 1);
      fx.fillStyle(0x16afa9, alpha * 0.72);
      fx.fillEllipse(stain.x + stain.nx * 3, stain.y + stain.ny * 3,
        wall ? film : stain.size * 2.2 * spread, wall ? stain.size * 2.2 * spread : film);
      for (const bead of stain.beads) {
        const x = stain.x + tx * bead.offset * stain.size * spread + stain.nx * 3;
        const y = stain.y + ty * bead.offset * stain.size * spread + stain.ny * 3;
        const drip = wall ? bead.drip * Math.min(1, stain.age / 1000) : 0;
        fx.lineStyle(bead.size * stain.size * 0.6, 0x16afa9, alpha * 0.7);
        if (wall) ribbon(x + Math.sin(bead.offset * 7) * 2, y + drip + 5, x, y - 3,
          bead.size * stain.size * 0.65, 0x15aaa9, alpha * 0.85);
        else ribbon(x + bead.offset * 8, y + 1, x - bead.offset * 12, y - 1,
          bead.size * stain.size * 0.65, 0x16b6b0, alpha * 0.7);
      }
      fx.lineStyle(1, 0xa2edcf, alpha * 0.55);
      fx.lineBetween(stain.x - tx * stain.size * 0.5 + stain.nx * 4, stain.y - ty * stain.size * 0.5 + stain.ny * 4,
        stain.x + tx * stain.size * 0.25 + stain.nx * 4, stain.y + ty * stain.size * 0.25 + stain.ny * 4);
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
      fx.lineStyle(0.65, 0x9ee6ce, alpha * 0.5);
      fx.lineBetween(d.x - 0.7, d.y - 2, d.x - Math.cos(angle) * length * 0.6, d.y - Math.sin(angle) * length * 0.6);
    }
    if (finished) return drops.length > 0 || stains.length > 0;
    // Stable damped spring, integrated in small steps even on a slow frame.
    for (let remaining = dt; remaining > 0;) {
      const step = Math.min(1 / 120, remaining); remaining -= step;
      springVelocity += (-95 * compression - 19 * springVelocity) * step;
      compression += springVelocity * step;
    }
    if (state.contactHold) {
      const phase = 1 - state.contactHold.remaining / state.contactHold.duration;
      const peak = clamp(state.contactHold.speed / 500, 0.3, 0.65);
      const rise = clamp(phase / 0.42, 0, 1);
      const release = clamp((phase - 0.42) / 0.58, 0, 1);
      const smooth = t => t * t * (3 - 2 * t);
      compression = peak * (phase < 0.42 ? smooth(rise) : 1 - smooth(release));
      springVelocity = 0;
    }
    const speed = Math.hypot(state.vx, state.vy);
    const stretch = clamp(speed / 1100, 0, 0.30);
    const impactWeight = clamp(Math.abs(compression) * 8, 0, 1);
    const flightAngle = Math.atan2(state.vy, state.vx);
    const impactAngle = Math.atan2(normal.y, normal.x);
    // Axis blend uses doubled angles because ellipse axes are undirected.
    const angle = Math.atan2(Math.sin(flightAngle * 2) * (1 - impactWeight) + Math.sin(impactAngle * 2) * impactWeight,
      Math.cos(flightAngle * 2) * (1 - impactWeight) + Math.cos(impactAngle * 2) * impactWeight) / 2;
    const axis = 1 + stretch * (1 - impactWeight);
    contactOffset = Math.max(0, compression) * r * 1.15;
    body.setPosition(state.x - normal.x * contactOffset, state.y - normal.y * contactOffset);
    deformAngle = angle; deformAxis = axis;
    body.setRotation(0); body.setScale(1);
    if (lastImpact && !lastImpact.terminal && impactAge < 320) {
      const attachmentX = lastImpact.x, attachmentY = lastImpact.y;
      const distance = Math.hypot(body.x - attachmentX, body.y - attachmentY);
      if (distance < r * 4) ribbon(body.x, body.y, attachmentX, attachmentY,
        r * 0.45 * (1 - impactAge / 320), 0x13abae, 0.75);
    }
    // Layered translucent skin, dark lower mass and asymmetric wet reflections.
    contour(1.04, 0x99e9c9, 0.48);
    contour(1, 0x11bbaa, 0.98);
    contour(0.89, 0x139ca9, 0.98);
    contour(0.73, 0x0868b6, 0.97, r * 0.02, r * 0.09);
    contour(0.56, 0x0846ae, 0.94, -r * 0.06, r * 0.13);
    body.fillStyle(0xf2f5aa, 0.93);
    body.fillEllipse(-r * 0.44, -r * 0.47, r * 0.2, r * 0.36);
    body.fillEllipse(r * 0.42, -r * 0.51, r * 0.13, r * 0.28);
    if (compression < 0.08) {
      body.lineStyle(1.1, 0x93edce, 0.65); body.beginPath();
      body.arc(0, 0, r * 0.92, 0.1, 1.05); body.strokePath();
    }
    for (let i = 0; i < 3; i++) {
      const a = time * 0.0009 + i * 2.3;
      const bx = Math.cos(a) * r * 0.43, by = Math.sin(a * 1.3) * r * 0.36;
      body.lineStyle(0.8, 0x74dcbc, 0.4); body.strokeCircle(bx, by, r * (0.065 + i * 0.018));
    }
    // Attached liquid necks droop in world gravity, then shed real falling droplets.
    for (let i = 0; i < (state.contactHold ? 0 : 2); i++) {
      const phase = (time / (250 + i * 95) + i * 0.43) % 1;
      const x = state.x - Math.sign(state.vx || 1) * r * (0.35 + i * 0.28);
      const y = state.y + r * 0.65;
      const length = r * (0.18 + phase * 0.55);
      fx.lineStyle(r * (0.16 - phase * 0.07), 0x12afaf, 0.85);
      fx.lineBetween(x, y, x - state.vx * 0.008 * phase, y + length);
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
    destroy() { if (destroyed) return; destroyed = true; body.destroy(); fx.destroy(); },
  };
}
