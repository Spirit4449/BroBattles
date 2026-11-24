import { teamColor, TEAM_RED } from "../../../../shared/projectilePresentation";
import { EIGHT_BALL_PALETTE, FIREBALL_PALETTES, FIREBALL_RADIUS_PX } from "./fireballArt";

// Pixel motes in the fireball's palette, drawn on the same 2-pixel art cell
// as the ball. Small sparks form a short wake behind it. Size and alpha change in whole
// steps so the wake stays crisp pixel art. Colours are baked into the texture
// and stepped by swapping frames, because the Canvas renderer fallback
// ignores particle tint.
const BALL_RADIUS = FIREBALL_RADIUS_PX;
const STEP_MS = 16;
const TRAIL_LIFESPAN = { min: 125, max: 250 };
const TEXTURE = "ozzy-fire-pixels";
const PX = 2; // one art cell in texture pixels
const MOTE = 6 * PX;
const SHAPES = ["wisp", "dot", "spark"];
const TONES = ["core", "light", "mid", "edge", "glow"];
// Cells set for each shape on a 6x6 grid.
const SHAPE_CELLS = {
  wisp: ["..##..", ".####.", "######", "######", ".####.", "..##.."],
  dot: ["......", "......", "..##..", "..##..", "......", "......"],
  spark: ["......", "..#...", ".###..", "..#...", "......", "......"],
};

function getPixelTexture(scene) {
  if (scene.textures.exists(TEXTURE)) return TEXTURE;
  const texture = scene.textures.createCanvas(TEXTURE, MOTE * SHAPES.length * TONES.length, MOTE * 3);
  const ctx = texture.getContext();
  ["blue", "red", "gold"].forEach((team, row) => {
    const [, glow, edge, mid, light, core] = team === 'gold' ? EIGHT_BALL_PALETTE : FIREBALL_PALETTES[team];
    const colours = { core, light, mid, edge, glow };
    SHAPES.forEach((shape, si) => TONES.forEach((tone, ti) => {
      const x = (si * TONES.length + ti) * MOTE, y = row * MOTE;
      SHAPE_CELLS[shape].forEach((line, cy) => [...line].forEach((cell, cx) => {
        if (cell === ".") return;
        ctx.fillStyle = colours[tone];
        ctx.fillRect(x + cx * PX, y + cy * PX, PX, PX);
      }));
      texture.add(`${team}-${shape}-${tone}`, 0, x, y, MOTE, MOTE);
    }));
  });
  texture.refresh();
  texture.setFilter?.(1);
  return TEXTURE;
}

const teamOf = owner => teamColor(owner) === TEAM_RED ? 'red' : owner?._bbEightBall ? 'gold' : 'blue';

// Picks a shape per particle and steps it through `tones` over its life.
// Tint stays white; the op is only used for its per-particle callbacks.
function toneRamp(scene, team, shapes, tones) {
  const frames = scene.textures.get?.(TEXTURE);
  const frame = (shape, tone) => frames?.get?.(`${team}-${shape}-${tone}`);
  const apply = (p, index) => {
    if (p._bbTone === tones[index]) return;
    const next = frame(p._bbShape, tones[index]);
    if (next) p.frame = next;
    p._bbTone = tones[index];
  };
  return {
    onEmit: (p) => {
      p._bbShape = shapes[Math.floor(Math.random() * shapes.length)];
      p._bbTone = null;
      apply(p, 0);
      return 0xffffff;
    },
    onUpdate: (p, _k, t) => {
      apply(p, Math.min(tones.length - 1, Math.floor(t * tones.length)));
      return 0xffffff;
    },
  };
}

// Value held in whole steps across the particle's life.
const stepped = (values) => ({
  onEmit: () => values[0],
  onUpdate: (_p, _k, t) => values[Math.min(values.length - 1, Math.floor(t * values.length))],
});
// Each particle keeps its own starting size and halves once late in life.
const halving = (sizes, at = 0.6) => ({
  onEmit: (p) => (p._bbSize = sizes[Math.floor(Math.random() * sizes.length)]),
  onUpdate: (p, _k, t) => (t < at ? p._bbSize : p._bbSize / 2),
});

export function createFireballParticles(scene, sprite, angle) {
  const fx = Math.cos(angle), fy = Math.sin(angle);
  const spread = (along, across) => {
    const drift = -35 * along;
    const variation = 25 * Math.abs(along) + 45 * Math.abs(across);
    return { min: drift - variation, max: drift + variation };
  };
  const emitter = scene.add.particles(0, 0, getPixelTexture(scene), {
    emitting: false, blendMode: "NORMAL", lifespan: TRAIL_LIFESPAN,
    speedX: spread(fx, fy), speedY: spread(fy, fx), gravityY: -30,
    scale: 0.5, alpha: stepped([1, 0.75, 0.4, 0.15]),
    tint: toneRamp(scene, teamOf(sprite), ["spark", "dot", "dot"], ["core", "light", "mid", "edge"]),
  }).setDepth(sprite.depth + 1);
  let previous = { x: sprite.x, y: sprite.y };
  let carry = 0;
  let draining = false;
  let drainMs = 0;
  let disposed = false;
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    scene.events.off("postupdate", update);
    scene.events.off("shutdown", destroy);
    scene.events.off("presentation:reset", destroy);
    emitter.destroy();
  };
  // A random point on the ball's rear half, `depth` of the radius out.
  const rearPoint = (x, y, size, depth, arc) => {
    const theta = (Math.random() * 2 - 1) * arc;
    const r = BALL_RADIUS * size * depth;
    const along = Math.cos(theta) * r, side = Math.sin(theta) * r;
    return [Math.round(x - fx * along - fy * side), Math.round(y - fy * along + fx * side)];
  };
  const update = (_time, delta = 16.67) => {
    const dt = Math.max(0, Math.min(64, delta));
    if (draining || !sprite.active) {
      drainMs += Math.max(0, delta);
      if (drainMs >= TRAIL_LIFESPAN.max) destroy();
      return;
    }
    const size = Math.abs(sprite.scaleX || 0.5) / 0.5 / (sprite._bbEightBall ? 4 : 1);
    // Emit along the path travelled this frame so spacing stays even at any
    // frame rate; positions are random so no lanes or rails form.
    for (let ms = STEP_MS - carry; ms <= dt; ms += STEP_MS) {
      const t = dt ? ms / dt : 1;
      const x = previous.x + (sprite.x - previous.x) * t;
      const y = previous.y + (sprite.y - previous.y) * t;
      emitter.emitParticleAt(...rearPoint(x, y, size, 1 + Math.random() * 0.8, 0.9), 1);
    }
    carry = (carry + dt) % STEP_MS;
    previous = { x: sprite.x, y: sprite.y };
  };
  scene.events.on("postupdate", update);
  scene.events.once("shutdown", destroy);
  scene.events.once("presentation:reset", destroy);
  return { destroy, stop() { draining = true; } };
}

// A one-shot spray of glowing sparks where the fireball lands.
export function spawnFireballBurst(scene, x, y, owner) {
  if (!scene?.add?.particles || !scene.textures) return;
  const emitter = scene.add.particles(0, 0, getPixelTexture(scene), {
    emitting: false, blendMode: "NORMAL",
    // Biased upward so the spray rises with the flames.
    lifespan: { min: 300, max: 700 }, speed: { min: 70, max: 240 }, angle: { min: 190, max: 350 },
    gravityY: -40, scale: halving([1, 1, 1.5]), alpha: stepped([1, 1, 0.6]),
    tint: toneRamp(scene, teamOf(owner), ["spark", "dot", "wisp"], ["core", "light", "mid", "edge"]),
  }).setDepth(owner?.depth ?? 100);
  emitter.explode(18, Math.round(x), Math.round(y));
  let done = false;
  const destroy = () => {
    if (done) return;
    done = true;
    scene.events?.off?.("shutdown", destroy);
    scene.events?.off?.("presentation:reset", destroy);
    emitter.destroy();
  };
  scene.events?.once?.("shutdown", destroy);
  scene.events?.once?.("presentation:reset", destroy);
  scene.time?.delayedCall?.(760, destroy);
}
