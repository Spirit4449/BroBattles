// Pixel-art cast effect for the ozzy's super (Arcane Surge), timed to the
// frames of `ozzy-special` (see anim.js):
//   0-330 ms   staff raised: motes spiral into the glowing staff tip
//   330 ms     staff planted: a shock ring runs out along the ground
//   420 ms on  violet blast: a vortex turns on the staff head, a rune circle
//              glows under his feet and sparks rise around him
// Everything is drawn on a 2 px grid, about one art pixel of the ozzy sheet,
// and fades in whole steps so it reads as pixel art rather than soft glow.
import { getResolvedCharacterSpecialConfig } from "../../../../shared/characters/characterTuning.js";
import { rigPoint, spriteView } from "../shared/rig";
import { attachToPlayer } from "../shared/attachToPlayer";

const CAST_MS = getResolvedCharacterSpecialConfig("ozzy", "arcaneSurge").castMs || 2000;
// The special animation runs about 1.72 s (anim.js); the effect fades out with it.
export const SUPER_TIMELINE = { plantMs: 330, blastMs: 420, fadeMs: 1450, endMs: Math.min(CAST_MS, 1800), exitMs: 150 };
const CELL = 2;
const C = {
  outline: 0x241046, deep: 0x4c1d95, mid: 0x7c3aed, light: 0xa78bfa,
  pale: 0xddd6fe, white: 0xf5f3ff, cyan: 0x67e8f9,
};

const clamp01 = v => Math.max(0, Math.min(1, v));
// Opacity in thirds, never a smooth ramp.
const steps = v => Math.ceil(clamp01(v) * 3) / 3;
const hash = n => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// Points come from the ozzy's rig (ozzy.json `rig`): the staff tip follows
// the frame being shown, the orb is the violet blast on the planted staff.
const point = (sprite, name) => rigPoint(sprite, name, "ozzy") || { x: sprite.x, y: sprite.y };

function painter(graphics) {
  return (x, y, color, alpha = 1, size = 1) => {
    if (alpha <= 0) return;
    graphics.fillStyle(color, alpha);
    const shift = Math.floor((size - 1) / 2) * CELL; // stay on the cell grid
    graphics.fillRect(Math.round(x / CELL) * CELL - shift, Math.round(y / CELL) * CELL - shift, size * CELL, size * CELL);
  };
}

// Pixel ring on an ellipse: one cell per step of arc, optionally dashed.
function ring(px, cx, cy, rx, ry, color, alpha, { dash = 0, phase = 0, size = 1 } = {}) {
  const count = Math.max(12, Math.round((2 * Math.PI * Math.max(rx, ry)) / (CELL * 1.4)));
  for (let i = 0; i < count; i++) {
    if (dash && Math.floor(i / dash) % 2) continue;
    const a = (i / count) * Math.PI * 2 + phase;
    px(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, color, alpha, size);
  }
}

function drawCharge(px, tip, ms) {
  const t = clamp01(ms / SUPER_TIMELINE.plantMs);
  // Motes spiral in and shorten their tails as they land.
  for (let i = 0; i < 10; i++) {
    const local = clamp01(t * 1.25 - hash(i) * 0.25);
    if (local <= 0 || local >= 1) continue;
    const r = 48 * Math.pow(1 - local, 1.3) + 3;
    const a = i * 0.63 * Math.PI + local * 3.2;
    for (let k = 0; k < 3; k++) {
      const rr = r + k * 4, aa = a - k * 0.22;
      px(tip.x + Math.cos(aa) * rr, tip.y + Math.sin(aa) * rr,
        k === 0 ? (i % 3 ? C.pale : C.cyan) : k === 1 ? C.light : C.mid, steps(1 - k * 0.3));
    }
  }
  // The tip star grows and twinkles between white and cyan.
  const arm = 1 + Math.floor(t * 3);
  const hot = Math.floor(ms / 60) % 2 ? C.white : C.cyan;
  px(tip.x, tip.y, C.white, 1, 2);
  for (let k = 1; k <= arm; k++) {
    const c = k === arm ? C.light : hot;
    px(tip.x + k * CELL * 1.5, tip.y, c); px(tip.x - k * CELL * 1.5, tip.y, c);
    px(tip.x, tip.y + k * CELL * 1.5, c); px(tip.x, tip.y - k * CELL * 1.5, c);
  }
}

function drawPlant(px, feet, head, ms, limit = 1) {
  const t = clamp01((ms - SUPER_TIMELINE.plantMs) / 420);
  if (t <= 0 || t >= 1) return;
  const rx = 10 + t * 74;
  const fade = steps(Math.min(1 - t, limit));
  ring(px, feet.x, feet.y, rx, rx * 0.26, t < 0.35 ? C.pale : t < 0.7 ? C.light : C.mid, fade, { size: t < 0.4 ? 2 : 1 });
  ring(px, feet.x, feet.y, rx * 0.72, rx * 0.19, C.deep, fade);
  // A short diamond flash where the staff meets the blast.
  if (t < 0.4) {
    const r = 4 + t * 26;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      for (let k = 0; k < 3; k++) px(head.x + Math.cos(a) * (r + k * 3), head.y + Math.sin(a) * (r + k * 3), k ? C.light : C.white, steps(1 - t * 2));
    }
  }
}

function drawSurge(back, front, feet, head, body, ms, limit = 1) {
  const { blastMs, fadeMs, endMs } = SUPER_TIMELINE;
  if (ms < blastMs) return;
  const appear = clamp01((ms - blastMs) / 160);
  const fade = steps(Math.min(appear, limit, 1 - clamp01((ms - fadeMs) / (endMs - fadeMs))));
  if (fade <= 0) return;
  const spin = (ms - blastMs) / 1000;
  // Rune circle under his feet, behind the sprite.
  ring(back, feet.x, feet.y, 46, 12, C.deep, fade, { size: 2 });
  ring(back, feet.x, feet.y, 46, 12, C.light, fade, { dash: 3, phase: spin * 1.4 });
  ring(back, feet.x, feet.y, 30, 7.5, C.mid, fade, { dash: 2, phase: -spin * 2 });
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + spin * 1.4;
    const x = feet.x + Math.cos(a) * 38, y = feet.y + Math.sin(a) * 10;
    back(x, y, C.pale, fade); back(x - CELL, y, C.light, fade); back(x + CELL, y, C.light, fade);
    back(x, y - CELL, C.light, fade);
  }
  // Vortex arms turning on the staff head, in front of the violet blast.
  for (let arm = 0; arm < 3; arm++) {
    for (let k = 0; k < 9; k++) {
      const r = 6 + k * 2.6;
      const a = arm * (Math.PI * 2 / 3) + spin * 7 - k * 0.32;
      const tone = k < 2 ? C.white : k < 4 ? C.pale : k < 7 ? C.light : C.mid;
      front(head.x + Math.cos(a) * r, head.y + Math.sin(a) * r * 0.85, tone, fade);
    }
  }
  front(head.x, head.y, C.white, fade, 2);
  // Sparks rise around him, cooling from pale to deep as they climb.
  for (let i = 0; i < 16; i++) {
    const life = ((ms - blastMs) / 760 + hash(i + 7)) % 1;
    const x = body.x + (hash(i + 31) - 0.5) * 84 + Math.sin(life * 6 + i) * 4;
    const y = feet.y - 4 - life * (feet.y - body.y + 40);
    const tone = life < 0.3 ? C.pale : life < 0.6 ? C.light : life < 0.85 ? C.mid : C.deep;
    front(x, y, tone, fade, i % 5 === 0 && life < 0.4 ? 2 : 1);
  }
}

// Filled pixel disc drawn as one span per row, snapped to the cell grid.
function disc(graphics, cx, cy, r, color, alpha) {
  if (alpha <= 0 || r < CELL) return;
  graphics.fillStyle(color, alpha);
  const x0 = Math.round(cx / CELL) * CELL, y0 = Math.round(cy / CELL) * CELL;
  for (let dy = -Math.floor(r / CELL) * CELL; dy <= r; dy += CELL) {
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)) / CELL) * CELL;
    graphics.fillRect(x0 - half, y0 + dy, half * 2 + CELL, CELL);
  }
}

// Additive light behind him: it builds on the staff tip while he charges, flares
// when the orb bursts, then breathes around the orb. Stacked discs give stepped
// pixel-art bands instead of a smooth gradient.
function drawGlow(glow, tip, head, feet, scale, ms, limit = 1) {
  const { plantMs, blastMs, fadeMs, endMs } = SUPER_TIMELINE;
  if (ms < plantMs) {
    const t = clamp01(ms / plantMs);
    const r = (6 + t * 12) * scale;
    disc(glow, tip.x, tip.y, r * 1.8, C.mid, 0.16 * steps(Math.min(t, limit)));
    disc(glow, tip.x, tip.y, r, C.cyan, 0.3 * steps(Math.min(t, limit)));
    return;
  }
  if (ms < blastMs) return;
  const t = ms - blastMs;
  const fade = steps(Math.min(clamp01(t / 120), limit, 1 - clamp01((ms - fadeMs) / (endMs - fadeMs))));
  const flash = 1 - clamp01(t / 260);
  const breathe = Math.round(Math.sin(ms / 110) * 1.5) * CELL;
  const r = 34 * scale + breathe;
  disc(glow, head.x, head.y, r * 1.75 + flash * 26 * scale, C.deep, 0.22 * fade);
  disc(glow, head.x, head.y, r * 1.35 + flash * 18 * scale, C.mid, 0.2 * fade);
  disc(glow, head.x, head.y, r + flash * 10 * scale, C.light, 0.24 * fade);
  if (flash > 0) disc(glow, head.x, head.y, r * 0.9, C.white, 0.5 * steps(flash));
  // The orb lights the floor beneath it.
  for (const [w, a] of [[1, 0.18], [0.65, 0.22]]) {
    glow.fillStyle(C.light, a * fade);
    const half = Math.round((56 * w * scale) / CELL) * CELL;
    for (let row = -2; row <= 1; row++) {
      const inset = Math.abs(row + 0.5) > 1 ? Math.round(half * 0.35 / CELL) * CELL : 0;
      glow.fillRect(Math.round(feet.x / CELL) * CELL - half + inset, Math.round(feet.y / CELL) * CELL + row * CELL,
        (half - inset) * 2, CELL);
    }
  }
}

// Plays once per cast on any client; a new cast replaces one still running.
// `elapsedMs` joins a cast whose pose is already showing (the owner's pose
// starts on the key press, a round trip before the server confirms it).
export function playOzzySuperCast(scene, sprite, { elapsedMs = 0 } = {}) {
  if (!scene?.add?.graphics || !sprite?.active) return null;
  const startMs = Math.max(0, Number(elapsedMs) || 0);
  if (startMs >= SUPER_TIMELINE.endMs) return null;
  let exitAt = null;
  let pBack = null, pFront = null;
  const draw = (ms, { floor: glow, behind: back, front }) => {
    glow.clear();
    back.clear();
    front.clear();
    const tip = point(sprite, "staffTip");
    const head = point(sprite, "orb");
    const feet = point(sprite, "feet");
    const body = point(sprite, "chest");
    const limit = exitAt === null ? 1 : 1 - clamp01((ms - exitAt) / SUPER_TIMELINE.exitMs);
    drawGlow(glow, tip, head, feet, Math.abs(spriteView(sprite, "ozzy").scaleX), ms, limit);
    if (ms < SUPER_TIMELINE.plantMs && limit === 1) drawCharge(pFront, tip, ms);
    drawPlant(pBack, feet, head, ms, limit);
    drawSurge(pBack, pFront, feet, head, body, ms, limit);
  };
  return attachToPlayer(scene, sprite, {
    key: "ozzy-super",
    layers: ["floor", "behind", "front"],
    lifetimeMs: SUPER_TIMELINE.endMs - startMs,
    update(elapsed, _dt, layers) {
      if (!pBack) {
        layers.floor.setBlendMode?.("ADD");
        pBack = painter(layers.behind);
        pFront = painter(layers.front);
      }
      const ms = startMs + elapsed;
      // Leave with the pose: once the sprite shows something other than a
      // special frame (lock ended, interrupted, local and remote differ), fade out.
      const frame = sprite.frame?.name;
      if (exitAt === null && elapsed > 120 && typeof frame === "string" && !/special/i.test(frame)) exitAt = ms;
      if (exitAt !== null && ms >= exitAt + SUPER_TIMELINE.exitMs) return false;
      draw(ms, layers);
      return true;
    },
  });
}
