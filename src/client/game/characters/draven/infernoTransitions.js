import { INFERNO_RISE_BEATS } from "../../../../shared/combat/runtime/abilities/dravenInfernoLift.js";
import { PIXEL_FX_SIZE, addPixelCircle, drawPixelRing } from "../../scene/fx/pixelShapes";
import { snapSmoke, paintStaffSmoke, staffSmokePalette, staffTip } from "./staffSmoke";
import { RENDER_LAYERS } from "../../scene/renderLayers";

// Inferno's ignite and burnout, staged around his rise
// (shared/combat/runtime/abilities/dravenInfernoLift.js) and drawn as chunky
// pixels to match the overlay art (scripts/art/draven-pixel/fx.cjs). Timings
// here are presentation only; the channel and the rise come from draven.json
// special.inferno.
//
// Ignite   gather   he sinks, embers are pulled into the staff, a sigil is traced underfoot
//          launch   thin sparks lift past him on either side
//          crown    at the peak the rune circle blooms from the staff, shockwaves
//                   roll out to the damage radius
// Burnout  flicker  the circle stutters for the last moments of the channel
//          collapse the circle and its embers are wrung back into the staff head
//          detonate a flash, shockwaves, an ember shower and smoke where it vanished

const CELL = PIXEL_FX_SIZE;

// The rune circle's bloom out of the staff, held in steps like the art's frames.
export const INFERNO_ENTER_OVERLAY_MS = 360;
const INTRO_STEPS = 8;
export const INFERNO_SHIELD_POP_MS = 360;
// How long the staff keeps pouring smoke, and how long a puff lives.
const SMOKE_POUR_MS = 420;
const SMOKE_LIFE_MS = [480, 720];
// The sigil traced under his feet, as a flattened ellipse.
const SIGIL_RX = 66;
const SIGIL_RY = 16;
const SHOCKWAVE_MS = 380;
// Burnout: the circle flickers for this long before the channel ends...
export const INFERNO_BURNOUT_WARN_MS = 500;
// ...then is wrung into the staff head and detonates.
const EXIT_COLLAPSE_MS = 280;
const EXIT_COLLAPSE_STEPS = 7;

const SHIELD_SHARD_SHADES = [0xffffff, 0xe4e8ef, 0xb4bac6, 0x7d8494];

const pick = (list, i) => list[i % list.length];
const between = (min, max) => min + Math.random() * (max - min);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const outCubic = (u) => 1 - (1 - clamp01(u)) ** 3;
const inCubic = (u) => clamp01(u) ** 3;
const lerp = (a, b, u) => a + (b - a) * u;

// When each ignite beat lands, in ms from the cast, for a given rise time.
export function infernoEnterBeats(riseMs) {
  const gatherMs = riseMs * INFERNO_RISE_BEATS.gather;
  const crownMs = riseMs * INFERNO_RISE_BEATS.apex;
  return { gatherMs, crownMs, doneMs: crownMs + INFERNO_ENTER_OVERLAY_MS };
}

// Back-out overshoot used for the shield pop (the loop draws it each tick).
export function infernoPopScale(t) {
  const u = Math.max(0, Math.min(1, t)) - 1;
  const s = 2.2;
  return 1 + u * u * ((s + 1) * u + s);
}

// Stepped flicker in the last moments of the channel so everyone can see the
// shield is about to drop. Returns the overlay alpha.
export function infernoBurnoutAlpha(remainingMs) {
  if (remainingMs > INFERNO_BURNOUT_WARN_MS) return 1;
  const fast = remainingMs < INFERNO_BURNOUT_WARN_MS * 0.4;
  return Math.floor(remainingMs / (fast ? 45 : 80)) % 2 ? 0.45 : 1;
}

function pixelSquare(scene, x, y, size, color, alpha, depth) {
  const s = Math.max(CELL, Math.round(size / CELL) * CELL);
  const square = scene.add.rectangle(x, y, s, s, color, alpha);
  square.setDepth(depth);
  return square;
}

function track(particles, obj) {
  particles?.add(obj);
  return () => {
    particles?.delete(obj);
    obj.destroy();
  };
}

// One grid cell of a stage drawing, snapped to the world pixel grid.
function cell(g, x, y, color, alpha, size = CELL) {
  g.fillStyle(color, alpha);
  g.fillRect(Math.round(x / CELL) * CELL - size / 2, Math.round(y / CELL) * CELL - size / 2, size, size);
}

function feetY(player) {
  const bottom = player.body?.bottom;
  return Number.isFinite(bottom) ? bottom : player.y + (player.displayHeight || 72) * 0.3;
}

// Smoke and flame puffs, painted through paintStaffSmoke. Puffs with `home`
// live in that sprite's space (so the staff smoke rides up with him); the rest
// stay where they were thrown.
function puffField() {
  const puffs = [];
  return {
    get size() { return puffs.length; },
    add(p) {
      puffs.push({ vx: 0, vy: 0, h: 1, age: 0, spin: between(-1, 1), grow: 1.6, cool: 2.4, rise: 30, ...p, r0: p.r });
    },
    step(dt) {
      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        p.age += dt * 1000;
        const life = p.age / p.life;
        if (life >= 1) { puffs.splice(i, 1); continue; }
        const drag = Math.exp(-dt * 3);
        p.vx = p.vx * drag + p.spin * 40 * dt;
        p.vy = p.vy * drag - p.rise * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.r = p.r0 * (1 + life * p.grow);
        p.h = 1 - life * life;
        p.warm = Math.max(0, p.warm - dt * p.cool);
      }
    },
    // Snap centres to the smoke grid so puffs step instead of sliding.
    world() {
      return puffs.map((p) => ({ ...p,
        x: snapSmoke((p.home ? p.home.x : 0) + p.x), y: snapSmoke((p.home ? p.home.y : 0) + p.y) }));
    },
  };
}

// Runs `draw(t, dt)` on every scene update until it returns false or the scene stops.
function runStage(scene, draw) {
  const born = scene.time?.now ?? 0;
  let last = born;
  const stop = () => {
    scene.events?.off?.("update", onUpdate);
    scene.events?.off?.("shutdown", stop);
  };
  const onUpdate = (time) => {
    const dt = Math.min(50, Math.max(0, time - last)) / 1000;
    last = time;
    if (draw(time - born, dt) === false) stop();
  };
  scene.events?.on?.("update", onUpdate);
  scene.events?.once?.("shutdown", stop);
  onUpdate(born);
}

// A traced sigil: `sweep` 0..1 of the outer ring drawn clockwise, the inner
// ring counter-clockwise, and six glyph ticks lit as the trace passes them.
function drawSigil(g, x, y, sweep, alpha, pal, flash) {
  if (alpha <= 0 || sweep <= 0) return;
  const ring = (rx, ry, dir, color, size = CELL) => {
    const steps = Math.ceil((Math.PI * 2 * rx) / CELL);
    const end = Math.floor(steps * sweep);
    for (let i = 0; i <= end; i++) {
      const a = -Math.PI / 2 + dir * (i / steps) * Math.PI * 2;
      // The trace's head burns white-hot.
      const head = end - i < 4 && sweep < 1;
      cell(g, x + Math.cos(a) * rx, y + Math.sin(a) * ry, head || flash ? pal.hot : color, alpha, size);
    }
  };
  ring(SIGIL_RX, SIGIL_RY, 1, pick(pal.arcane, 1), CELL * 2);
  ring(SIGIL_RX * 0.7, SIGIL_RY * 0.7, -1, pick(pal.fire, 2));
  for (let k = 0; k < 6; k++) {
    if (sweep < (k + 0.5) / 6) continue;
    const a = -Math.PI / 2 + (k / 6) * Math.PI * 2 + Math.PI / 6;
    for (let s = 0; s <= 3; s++) {
      const r = lerp(0.72, 1.0, s / 3);
      cell(g, x + Math.cos(a) * SIGIL_RX * r, y + Math.sin(a) * SIGIL_RY * r, flash ? pal.hot : pick(pal.arcane, 0), alpha, CELL * 2);
    }
  }
}

// Motes streaking from where they start to `to()` (which may move), with a short trail.
function drawMotes(g, motes, t, to, pal) {
  for (const m of motes) {
    const u = (t - m.delay) / m.dur;
    if (u < 0 || u >= 1) continue;
    const target = to();
    for (let k = 0; k < 3; k++) {
      const e = inCubic(Math.max(0, u - k * 0.08));
      cell(g, lerp(m.x, target.x, e), lerp(m.y, target.y, e), k === 0 ? m.color : pick(pal.fire, 2),
        1 - k * 0.3, k === 0 ? CELL * 2 : CELL);
    }
  }
}

function drawShockwaves(g, waves, t, pal) {
  for (const w of waves) {
    const u = (t - w.at) / SHOCKWAVE_MS;
    if (u < 0 || u >= 1) continue;
    drawPixelRing(g, w.x, w.y, lerp(w.from, w.to, outCubic(u)), {
      lineColor: w.color, lineAlpha: (1 - u) ** 1.4, lineCells: u < 0.4 ? 3 : 2,
      fillColor: pal.hot, fillAlpha: u < 0.12 ? 0.18 * (1 - u / 0.12) : 0,
    });
  }
}

function burst(scene, particles, at, count, colors, reach, depth) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + between(-0.12, 0.12);
    const spark = pixelSquare(scene, at.x, at.y, CELL * 2, pick(colors, i), 1, depth);
    const done = track(particles, spark);
    const d = between(...reach);
    scene.tweens.add({
      targets: spark,
      x: at.x + Math.cos(a) * d,
      y: at.y + Math.sin(a) * d,
      alpha: 0,
      duration: between(260, 380),
      ease: "Cubic.easeOut",
      onComplete: done,
    });
  }
}

// The staff-smoke palette shifted down one band for flame: white-hot core,
// yellow, orange and red, burning out to deep red and the arcane shade rather
// than cooling into smoke.
function flamePalette(pal) {
  return { ...pal, fire: [pal.fire[0], pal.fire[1]], arcane: [pal.fire[2], pal.fire[3]],
    plume: [pal.fire[3], pick(pal.arcane, 2), pick(pal.arcane, 2)] };
}

// Called once at cast. `overlay` may be null when the effect art is missing.
export function playInfernoEnter(scene, player, { overlay, particles, radius = 220, riseMs = 650, isOwner = false }) {
  if (!scene?.add?.graphics || !scene.tweens || !player) return;
  const pal = staffSmokePalette(player);
  const { gatherMs, crownMs } = infernoEnterBeats(riseMs);
  const groundX = player.x;
  const groundY = feetY(player);

  const layer = (depth) => {
    const g = scene.add.graphics();
    g.setDepth(depth);
    particles?.add(g);
    return g;
  };
  const layers = [
    layer(RENDER_LAYERS.PLAYER - 0.8),
    layer(RENDER_LAYERS.PLAYER - 0.5),
    layer(RENDER_LAYERS.PLAYER + 2),
  ];
  const [back, smoke, front] = layers;
  const liftSparks = Array.from({ length: 10 }, (_, i) => ({
    offset: (i % 2 ? 1 : -1) * between(18, 42),
    start: gatherMs + (crownMs - gatherMs) * i / 12,
    duration: between(140, 220),
    distance: between(28, 52),
    color: i % 3 ? pick(pal.fire, i) : pal.hot,
  }));
  const retire = () => layers.forEach((g) => { particles?.delete(g); if (g.active) g.destroy(); });

  // Hidden until the crown, then blooms out of the staff head in held steps.
  if (overlay) {
    const full = overlay._infernoScale || overlay.scale || 1;
    const intro = { t: 0 };
    const stepped = () => Math.floor(intro.t * INTRO_STEPS) / INTRO_STEPS;
    const apply = () => {
      const t = stepped();
      // Starts as a spark on the staff, then swells with an overshoot.
      overlay.setScale(full * (0.06 + 0.94 * infernoPopScale(t * t)));
      overlay.setAlpha(Math.min(1, 0.35 + t * 2));
    };
    overlay.setAlpha(0);
    overlay._infernoAnchor = () => {
      const tip = staffTip(player);
      const k = 1 - stepped();
      return { x: player.x + (tip.x - player.x) * k, y: player.y + (tip.y - player.y) * k };
    };
    scene.tweens.add({
      targets: intro,
      t: 1,
      delay: crownMs,
      duration: INFERNO_ENTER_OVERLAY_MS,
      onStart: apply,
      onUpdate: apply,
      onComplete: () => {
        apply();
        delete overlay._infernoAnchor;
      },
    });
  }

  const puffs = puffField();
  let poured = 0;
  const tip0 = staffTip(player);
  const gatherMotes = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2 + between(-0.2, 0.2);
    const d = between(60, 110);
    return { x: tip0.x + Math.cos(a) * d, y: tip0.y + Math.sin(a) * d * 0.8, delay: between(0, gatherMs * 0.7),
      dur: gatherMs * 0.9 + 40, color: i % 3 ? pick(pal.arcane, i) : pal.hot };
  });
  const waves = [];
  let crowned = false;

  runStage(scene, (t, dt) => {
    if (!player.active || layers.some((g) => !g.active)) {
      retire();
      return false;
    }
    const tip = staffTip(player);
    const feet = feetY(player);

    // Gather: the staff pours smoke and drinks in embers.
    while (t < SMOKE_POUR_MS && poured < Math.floor(t / 22) + 1) {
      const k = poured * 22 / SMOKE_POUR_MS;
      const side = poured % 2 ? 1 : -1;
      puffs.add({ home: player, x: tip.x - player.x, y: tip.y - player.y,
        vx: side * between(20, 80) * (0.5 + k), vy: -between(120, 200) * (1 - k * 0.35),
        r: between(9, 14) * (1.2 - k * 0.4), warm: 1 - k * 0.6, life: between(...SMOKE_LIFE_MS) });
      poured += 1;
    }

    // Crown: the circle blooms, the sigil flares, shockwaves roll out.
    if (!crowned && t >= crownMs) {
      crowned = true;
      const at = { x: player.x, y: player.y };
      waves.push({ ...at, at: t, from: 16, to: radius, color: pick(pal.arcane, 1) });
      waves.push({ ...at, at: t + 70, from: 10, to: radius * 0.78, color: pick(pal.fire, 1) });
      if (isOwner) scene.cameras?.main?.shake?.(140, 0.0035);
      const flash = addPixelCircle(scene, tip.x, tip.y, 18, pal.hot, 0.95);
      flash.setDepth(RENDER_LAYERS.PLAYER + 2);
      flash.setScale(0.6);
      const doneFlash = track(particles, flash);
      scene.tweens.add({
        targets: flash,
        scale: 2.2,
        alpha: 0,
        duration: 220,
        ease: "Quad.easeOut",
        onUpdate: () => Object.assign(flash, staffTip(player)),
        onComplete: doneFlash,
      });
      burst(scene, particles, tip, 12, [pal.hot, ...pal.fire], [50, 90], RENDER_LAYERS.PLAYER + 2);
    }

    puffs.step(dt);
    back.clear();
    front.clear();
    // Sigil: traced through the gather, flares at the crown, then fades.
    const sweep = clamp01(t / (gatherMs * 1.4));
    const fade = crowned ? 1 - clamp01((t - crownMs - 80) / 420) : 1;
    drawSigil(back, groundX, groundY, sweep, fade, pal, crowned && t - crownMs < 80);
    drawShockwaves(back, waves, t, pal);
    for (const spark of liftSparks) {
      const u = (t - spark.start) / spark.duration;
      if (u < 0 || u >= 1) continue;
      const x = snapSmoke(player.x + spark.offset);
      const y = snapSmoke(feet - spark.distance * u);
      back.fillStyle(spark.color, 1 - u);
      back.fillRect(x, y, CELL, CELL * (u < 0.65 ? 3 : 1));
    }
    paintStaffSmoke(smoke, puffs.world(), pal);
    drawMotes(front, gatherMotes, t, () => staffTip(player), pal);

    if (crowned && t > crownMs + Math.max(SHOCKWAVE_MS + 70, 500) && !puffs.size) {
      retire();
      return false;
    }
    return true;
  });
}

// Called when the channel ends or is interrupted. Takes ownership of the
// detached overlay and destroys it when the collapse finishes.
export function playInfernoExit(scene, player, { overlay, x, y, shieldRadius = 57, radius = 220 }) {
  if (!scene?.add?.graphics || !scene.tweens) {
    overlay?.destroy?.();
    return;
  }
  const pal = staffSmokePalette(player);
  const flamePal = flamePalette(pal);
  const depth = RENDER_LAYERS.PLAYER + 2;
  // The circle dies where the staff was, while he drops away from it.
  const core = player?.active ? staffTip(player) : { x, y };
  let ring = overlay?.active ? overlay : null;
  if (!ring) overlay?.destroy?.();
  const full = ring?._infernoScale || ring?.scale || 1;
  if (ring) delete ring._infernoAnchor;

  // Shield shatters into glassy shards that tumble away.
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + between(-0.1, 0.1);
    const shard = pixelSquare(scene, x + Math.cos(a) * shieldRadius, y + Math.sin(a) * shieldRadius,
      i % 4 === 0 ? CELL * 3 : CELL * 2, pick(SHIELD_SHARD_SHADES, i), 0.95, depth);
    const reach = between(18, 40);
    scene.tweens.add({
      targets: shard,
      x: shard.x + Math.cos(a) * reach,
      y: shard.y + Math.sin(a) * reach * 0.6 + between(16, 34),
      alpha: 0,
      angle: between(-90, 90),
      duration: between(320, 460),
      ease: "Quad.easeOut",
      onComplete: () => shard.destroy(),
    });
  }

  const layers = [RENDER_LAYERS.PLAYER - 0.8, RENDER_LAYERS.PLAYER - 0.5, depth].map((d) => {
    const g = scene.add.graphics();
    g.setDepth(d);
    return g;
  });
  const [back, smoke, front] = layers;

  // Embers from the circle's edge are wrung into the core.
  const motes = Array.from({ length: 22 }, (_, i) => {
    const a = (i / 22) * Math.PI * 2 + between(-0.15, 0.15);
    const d = between(0.35, 0.6) * radius;
    return { x: core.x + Math.cos(a) * d, y: core.y + Math.sin(a) * d * 0.8, delay: between(0, EXIT_COLLAPSE_MS * 0.35),
      dur: EXIT_COLLAPSE_MS * 0.65, color: i % 3 ? pick(pal.fire, i) : pal.hot };
  });
  const puffs = puffField();
  const waves = [];
  let detonated = false;

  runStage(scene, (t, dt) => {
    if (layers.some((g) => !g.active)) {
      layers.forEach((g) => g.active && g.destroy());
      ring?.destroy();
      return false;
    }
    // Collapse: a last swell, then the circle is wrung down into the core in held steps.
    if (ring) {
      const u = Math.floor(clamp01(t / EXIT_COLLAPSE_MS) * EXIT_COLLAPSE_STEPS) / EXIT_COLLAPSE_STEPS;
      const k = u < 0.2 ? 1 + 0.12 * (u / 0.2) : 1.12 * (1 - inCubic((u - 0.2) / 0.8)) + 0.04 * u;
      ring.setScale(full * k);
      ring.setAlpha(1);
      ring.x = lerp(x, core.x, u);
      ring.y = lerp(y, core.y, u);
      if (t >= EXIT_COLLAPSE_MS) {
        ring.destroy();
        ring = null;
      }
    }

    // Detonate where it vanished.
    if (!detonated && t >= EXIT_COLLAPSE_MS) {
      detonated = true;
      waves.push({ ...core, at: t, from: 8, to: radius * 0.7, color: pal.hot });
      waves.push({ ...core, at: t + 60, from: 6, to: radius * 0.5, color: pick(pal.arcane, 1) });
      const flash = addPixelCircle(scene, core.x, core.y, 18, pal.hot, 1);
      flash.setDepth(depth);
      scene.tweens.add({
        targets: flash, scale: 2.6, alpha: 0, duration: 200, ease: "Quad.easeOut",
        onComplete: () => flash.destroy(),
      });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + between(-0.3, 0.3);
        puffs.add({ x: core.x, y: core.y, vx: Math.cos(a) * between(140, 220), vy: Math.sin(a) * between(90, 160),
          r: between(10, 16), warm: 1.3, life: between(220, 340), cool: 3, rise: 60, grow: 1.1 });
      }
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2 + between(-0.2, 0.2);
        const reach = between(40, 110);
        const life = between(520, 760);
        const ember = pixelSquare(scene, core.x, core.y, i % 3 === 0 ? CELL * 3 : CELL * 2,
          i % 2 ? pick(pal.fire, i) : pick(pal.arcane, i), 1, depth);
        // Thrown out, then falling.
        scene.tweens.add({ targets: ember, x: core.x + Math.cos(a) * reach, duration: life, ease: "Cubic.easeOut" });
        scene.tweens.add({
          targets: ember,
          y: core.y + Math.sin(a) * reach * 0.6 + between(40, 90),
          alpha: 0,
          scale: 0.5,
          duration: life,
          ease: "Quad.easeIn",
          onComplete: () => ember.destroy(),
        });
      }
    }

    puffs.step(dt);
    back.clear();
    front.clear();
    drawShockwaves(back, waves, t, pal);
    paintStaffSmoke(smoke, puffs.world(), flamePal);
    drawMotes(front, motes, t, () => core, pal);
    if (detonated && !ring && !puffs.size && t > EXIT_COLLAPSE_MS + SHOCKWAVE_MS + 60) {
      layers.forEach((g) => g.destroy());
      return false;
    }
    return true;
  });
}
