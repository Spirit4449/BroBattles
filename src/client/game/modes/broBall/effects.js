// Gold hit bursts, flame trails, spawn sparkles, landing dust and goal confetti,
// drawn as snapped pixel shapes so they sit with the rest of the art.
const GOLD = [0xfff7cf, 0xffe36b, 0xffc93d, 0xffa21f];
const FLAME = [0xfff3b0, 0xffcf4a, 0xff9124, 0xf2581c];
const GLOW_KEY = 'bro-ball-glow';
const snap = value => Math.round(value / 2) * 2;
const pick = list => list[Math.floor(Math.random() * list.length)];
const CONTACT_ARC_MS = 240;

function drawContactArc(graphics, { x, y, nx, ny }, radius, offset, spread, color, alpha) {
  const cell = 4;
  const pixels = [];
  for (let i = -12; i <= 12; i++) {
    const angle = spread * i / 12;
    const forward = offset - radius * (1 - Math.cos(angle));
    const sideways = radius * Math.sin(angle);
    const px = Math.round((x + forward * nx - sideways * ny) / cell) * cell;
    const py = Math.round((y + forward * ny + sideways * nx) / cell) * cell;
    const previous = pixels.at(-1);
    if (previous?.x === px && previous.y === py) continue;
    pixels.push({ x: px, y: py });
  }
  graphics.fillStyle(0x48291d, alpha);
  for (const pixel of pixels) graphics.fillRect(pixel.x - 1, pixel.y - 1, cell + 2, cell + 2);
  graphics.fillStyle(color, alpha);
  for (const pixel of pixels) graphics.fillRect(pixel.x, pixel.y, cell, cell);
}

// Fill the two rim spans on each pixel row as the shockwave expands.
function drawContactRing(graphics, x, y, radius, width) {
  const cell = 4;
  const outer = Math.max(1, Math.round(radius / cell));
  const inner = Math.max(0, outer - Math.max(1, Math.round(width / cell)));
  const left = snap(x) - cell / 2;
  const top = snap(y) - cell / 2;
  for (let row = -outer; row <= outer; row++) {
    const edge = Math.floor(Math.sqrt(outer * outer - row * row));
    const hole = Math.abs(row) < inner ? Math.ceil(Math.sqrt(inner * inner - row * row)) : 0;
    const rowY = top + row * cell;
    if (hole === 0) {
      graphics.fillRect(left - edge * cell, rowY, (2 * edge + 1) * cell, cell);
    } else {
      const span = (edge - hole + 1) * cell;
      graphics.fillRect(left - edge * cell, rowY, span, cell);
      graphics.fillRect(left + hole * cell, rowY, span, cell);
    }
  }
}

function ensureGlow(scene) {
  if (scene.textures.exists(GLOW_KEY)) return;
  const size = 128;
  const texture = scene.textures.createCanvas(GLOW_KEY, size, size);
  const context = texture.getContext();
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  texture.refresh();
}

export function createBallEffects(scene, Phaser, { depth, reduced, floor }) {
  ensureGlow(scene);
  const back = scene.add.graphics().setDepth(depth - 0.5).setBlendMode(Phaser.BlendModes.ADD);
  const front = scene.add.graphics().setDepth(depth + 0.5);
  const glows = [];
  let particles = [];
  let rings = [];
  let contactArcs = [];

  function glow(x, y, { color = 0xffd75a, from = 0.4, to = 1.6, life = 260, alpha = 0.9, follow = null } = {}) {
    const image = scene.add.image(x, y, GLOW_KEY).setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(depth - 0.4).setTint(color).setAlpha(alpha).setScale(from);
    glows.push({ image, from, to, life, age: 0, alpha, follow });
    return image;
  }

  function spark(x, y, angle, speed, options = {}) {
    if (particles.length > 420) particles.shift();
    particles.push({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      age: 0, life: options.life ?? 420 + Math.random() * 260,
      size: options.size ?? 2, color: options.color ?? pick(GOLD),
      shape: options.shape ?? 'square', gravity: options.gravity ?? 380, drag: options.drag ?? 2.4,
      layer: options.layer ?? 'front', spin: Math.random() * 6,
    });
  }

  function ring(x, y, { radius = 20, reach = 60, life = 320, width = 3, color = 0xffe37a } = {}) {
    rings.push({ x, y, radius, reach, life, width, color, age: 0 });
  }

  /** The burst for one server impact. */
  function burst(impact) {
    if (reduced) return;
    const { x, y, angle, kind } = impact;
    if (impact.contact) {
      const contact = impact.contact;
      contactArcs.push({ dx: contact.x - x, dy: contact.y - y, nx: contact.nx, ny: contact.ny, age: 0 });
    }
    const power = Math.min(1.4, (impact.strength || 300) / 1000);
    if (kind === 'body' || kind === 'wall') {
      if (impact.strength < 240) return;
      for (let i = 0; i < 4; i++) spark(x, y, angle + (Math.random() - 0.5) * 1.6, 120 + Math.random() * 120, { life: 260, color: GOLD[0] });
      return;
    }
    if (kind === 'post') {
      ring(x, y, { radius: 12, reach: 28, life: 220, width: 2, color: 0xfff1c2 });
      for (let i = 0; i < 6; i++) spark(x, y, angle + (Math.random() - 0.5) * 2.2, 160 + Math.random() * 180, { life: 300 });
      return;
    }
    const hard = kind === 'super' || kind === 'smash';
    // Every attack kick gets the full gold burst; supers and dashes more.
    const strike = kind === 'kick';
    // A hot core, a wide gold bloom and a shockwave ring on every kick.
    glow(x, y, { color: 0xfff6d8, from: 0.2, to: hard ? 1.6 : strike ? 1.15 : 0.8, life: hard ? 200 : 150, alpha: 1 });
    glow(x, y, { color: hard ? 0xffa526 : 0xffcf3a, from: 0.5, to: hard ? 4.2 : strike ? 2.8 : 1.9, life: hard ? 520 : strike ? 380 : 300, alpha: hard ? 0.95 : 0.8 });
    ring(x, y, { radius: 18, reach: hard ? 84 : strike ? 80 : 50, life: hard ? 440 : 320, width: hard ? 6 : strike ? 4 : 3, color: 0xffe066 });
    if (hard || strike) ring(x, y, { radius: 10, reach: hard ? 54 : 46, life: hard ? 560 : 400, width: 2, color: hard ? 0xff9a2c : 0xfff3c0 });
    const count = hard ? 32 : strike ? 20 : 12;
    for (let i = 0; i < count; i++) {
      const spread = i < count / 2 ? 0.9 : Math.PI;
      const a = angle + (Math.random() - 0.5) * 2 * spread;
      spark(x, y, a, (hard ? 280 : 190) + Math.random() * (hard ? 440 : 260) * power, {
        shape: i % 3 === 0 ? 'star' : 'square', size: i % 3 === 0 ? (hard ? 6 : 4) : hard ? 4 : 2,
        color: hard && i % 2 ? pick(FLAME) : pick(GOLD),
      });
    }
    // Speed lines streak back from the contact, against the shot.
    const lines = hard ? 7 : strike ? 5 : 3;
    for (let i = 0; i < lines; i++) {
      spark(x, y, angle + Math.PI + (Math.random() - 0.5) * 0.9, 240 + Math.random() * 200, {
        shape: 'streak', size: hard ? 3 : 2, life: 200 + Math.random() * 120, gravity: 0, drag: 6,
        color: GOLD[i % 2], layer: 'back',
      });
    }
  }

  /** Called each frame for the ball: gold trail when quick, flames when heated. */
  function trail(ball, pace, heat, dt) {
    if (reduced) return;
    if (heat > 0.05) {
      // Flame tongues peel off the back of the ball and cool from yellow to red.
      const back = Math.atan2(-ball.vy, -ball.vx);
      const count = Math.ceil(heat * 11 * dt * 60);
      for (let i = 0; i < count; i++) {
        const a = back + (Math.random() - 0.5) * 3.4, r = 8 + Math.random() * 14;
        spark(ball.x + Math.cos(a) * r, ball.y + Math.sin(a) * r, back + (Math.random() - 0.5) * 0.6,
          20 + Math.random() * 90, { shape: 'flame', size: 6 + Math.round(Math.random() * heat * 3) * 2,
            life: 160 + Math.random() * 260 * heat, gravity: -260, drag: 4 });
      }
    } else if (pace > 620 && Math.random() < dt * 40) {
      spark(ball.x + (Math.random() - 0.5) * 20, ball.y + (Math.random() - 0.5) * 20, Math.random() * Math.PI * 2, 20,
        { life: 300, gravity: 40, size: 2, color: pick(GOLD), layer: 'back' });
    }
  }

  function sparkle(x, y, radius = 30) {
    if (reduced) return;
    const a = Math.random() * Math.PI * 2;
    spark(x + Math.cos(a) * radius, y + Math.sin(a) * radius, a + Math.PI / 2, 30,
      { shape: Math.random() < 0.4 ? 'star' : 'square', size: Math.random() < 0.4 ? 3 : 2, life: 520, gravity: 30, color: pick(GOLD) });
  }

  function dust(x, strength) {
    if (reduced || strength < 220) return;
    const count = Math.min(10, Math.round(strength / 90));
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      spark(x + side * 10, floor - 2, side > 0 ? -0.35 - Math.random() * 0.5 : Math.PI + 0.35 + Math.random() * 0.5,
        60 + Math.random() * 90, { color: pick([0xe8d9b4, 0xd2bf93, 0xf3e9cc]), size: 2 + (i % 2) * 2, life: 380, gravity: 120, drag: 4 });
    }
  }

  function confetti(x, y, palette, angle, count) {
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * 1.65;
      spark(x, y, a, 300 + Math.random() * 660, {
        color: pick(palette), shape: 'confetti', size: 4 + (i % 3) * 2,
        life: 1300 + Math.random() * 1000, gravity: 540, drag: 1.25,
      });
    }
  }

  function celebrateGoal(x, y, colors, direction, midfieldX) {
    if (reduced) return;
    const palette = [colors.main, colors.light, 0xffdd51, 0xff765a, 0x52f5db, 0xffffff];
    confetti(x, y, palette, -Math.PI / 2 + direction * 0.65, 76);
    confetti(midfieldX - direction * 120, floor - 8, palette, -Math.PI / 2 + direction * 0.18, 56);
    glow(x, y, { color: 0xfffae4, from: 0.85, to: 2.5, life: 250, alpha: 1 });
    glow(x, y, { color: colors.glow, from: 1.2, to: 5, life: 610, alpha: 0.85 });
    ring(x, y, { radius: 20, reach: 108, life: 400, width: 8, color: 0xffefc2 });
  }

  function update(dt, ballPosition) {
    const ms = dt * 1000;
    back.clear();
    front.clear();
    for (let i = glows.length - 1; i >= 0; i--) {
      const g = glows[i];
      g.age += ms;
      const t = Math.min(1, g.age / g.life);
      if (g.follow) g.image.setPosition(g.follow.x, g.follow.y);
      g.image.setScale(g.from + (g.to - g.from) * (1 - (1 - t) ** 2)).setAlpha(g.alpha * (1 - t));
      if (t >= 1) {
        g.image.destroy();
        glows.splice(i, 1);
      }
    }
    rings = rings.filter(r => (r.age += ms) < r.life);
    for (const r of rings) {
      const t = r.age / r.life;
      const radius = r.radius + r.reach * (1 - (1 - t) ** 3);
      back.fillStyle(r.color, 0.9 * (1 - t));
      drawContactRing(back, r.x, r.y, radius, r.width * (1 - t * 0.6));
    }
    particles = particles.filter(p => (p.age += ms) < p.life);
    for (const p of particles) {
      p.vx *= Math.exp(-p.drag * dt);
      p.vy = p.vy * Math.exp(-p.drag * dt) + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.spin += dt * 9;
      const t = p.age / p.life;
      const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      const g = p.layer === 'back' ? back : front;
      const x = snap(p.x), y = snap(p.y), s = p.size;
      g.fillStyle(p.color, alpha);
      if (p.shape === 'star') {
        const arm = s + (t < 0.3 ? 2 : 0);
        g.fillRect(x - 1, y - arm, 2, arm * 2).fillRect(x - arm, y - 1, arm * 2, 2);
        g.fillStyle(0xffffff, alpha).fillRect(x - 1, y - 1, 2, 2);
      } else if (p.shape === 'streak') {
        const length = Math.min(26, Math.hypot(p.vx, p.vy) * 0.06);
        const a = Math.atan2(p.vy, p.vx);
        for (let k = 0; k < length; k += 2) g.fillRect(snap(p.x - Math.cos(a) * k), snap(p.y - Math.sin(a) * k), s, s);
      } else if (p.shape === 'flame') {
        const size = Math.max(2, Math.round(s * (1 - t * 0.7) / 2) * 2);
        g.fillStyle(FLAME[Math.min(3, Math.floor(t * 4.2))], alpha);
        g.fillRect(x - size / 2, y - size / 2, size, size);
      } else if (p.shape === 'confetti') {
        const w = 2 + snap(Math.abs(Math.cos(p.spin)) * (s - 2));
        g.fillRect(x - w / 2, y - s / 2, w, s);
      } else {
        const size = Math.max(2, Math.round(s * (1 - t * 0.5)));
        g.fillRect(x - size / 2, y - size / 2, size, size);
      }
    }
    // Draw the contact cue over the hit sparks so the arc stays readable.
    contactArcs = ballPosition ? contactArcs.filter(arc => (arc.age += ms) < CONTACT_ARC_MS) : [];
    for (const arc of contactArcs) {
      const contact = { x: ballPosition.x + arc.dx, y: ballPosition.y + arc.dy, nx: arc.nx, ny: arc.ny };
      const t = arc.age / CONTACT_ARC_MS;
      const expansion = 8 * (1 - (1 - t) ** 2);
      const alpha = 1 - t * t;
      drawContactArc(front, contact, 22 + expansion, 0, 0.9, 0xfffbea, alpha);
      drawContactArc(front, contact, 15 + expansion, -10, 0.72, 0xffd260, alpha);
    }
  }

  function destroy() {
    for (const g of glows) g.image.destroy();
    back.destroy();
    front.destroy();
  }

  function clearContactArcs() {
    contactArcs = [];
  }

  return { burst, trail, sparkle, dust, celebrateGoal, glow, ring, spark, update, clearContactArcs, destroy };
}
