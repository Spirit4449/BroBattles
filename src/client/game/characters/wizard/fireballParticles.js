import { teamColor, TEAM_RED } from "../../../../shared/projectilePresentation";
import { FIREBALL_PALETTES } from "./fireballArt";

// Trail pixels share the fireball sheet's palette and its 2-screen-pixel art
// cell. Chips shrink and cool in whole steps (core -> light -> mid -> edge)
// instead of fading smoothly, so the wake reads as pixel art, not blur.
// Colours are baked into the texture and stepped by swapping frames, because
// the Canvas renderer fallback ignores particle tint.
const CHIP = 6; // three art cells at activeScale 0.5
const BALL_RADIUS = 19; // screen px at activeScale 0.5
const STEP_MS = 8;
const TEXTURE = "wizard-fire-pixels";
const SHAPES = ["square", "plus", "round"];
const TONES = ["core", "light", "mid", "edge", "outline", "smoke"];
const SMOKE = { blue: "#26305e", red: "#3b2a33" };

function getPixelTexture(scene) {
  if (scene.textures.exists(TEXTURE)) return TEXTURE;
  const texture = scene.textures.createCanvas(TEXTURE, CHIP * SHAPES.length * TONES.length, CHIP * 2);
  const ctx = texture.getContext();
  ["blue", "red"].forEach((team, row) => {
    const [, outline, edge, mid, light, core] = FIREBALL_PALETTES[team];
    const colours = { core, light, mid, edge, outline, smoke: SMOKE[team] };
    SHAPES.forEach((shape, si) => TONES.forEach((tone, ti) => {
      const x = (si * TONES.length + ti) * CHIP, y = row * CHIP;
      ctx.fillStyle = colours[tone];
      if (shape === "square") ctx.fillRect(x, y, CHIP, CHIP);
      else {
        ctx.fillRect(x + 2, y, 2, CHIP);
        ctx.fillRect(x, y + 2, CHIP, 2);
        if (shape === "round") { ctx.fillRect(x + 1, y + 1, 4, 4); }
      }
      texture.add(`${team}-${shape}-${tone}`, 0, x, y, CHIP, CHIP);
    }));
  });
  texture.refresh();
  texture.setFilter(0);
  return TEXTURE;
}

const teamOf = owner => (teamColor(owner) === TEAM_RED ? "red" : "blue");

// Picks a chip shape per particle and steps it through `tones` over its life.
// Tint stays white; the op is only used for its per-particle callbacks.
function toneRamp(scene, team, shapes, tones) {
  const frames = scene.textures.get?.(TEXTURE);
  const frame = (shape, tone) => frames?.get?.(`${team}-${shape}-${tone}`);
  const apply = (p, index) => {
    const next = frame(p._bbShape, tones[index]);
    if (next) p.frame = next;
    p._bbTone = tones[index];
  };
  return {
    onEmit: (p) => {
      p._bbShape = shapes[Math.floor(Math.random() * shapes.length)];
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
// Each particle keeps its own starting size and shrinks one third at a time.
const shrinking = (sizes) => ({
  onEmit: (p) => (p._bbSize = sizes[Math.floor(Math.random() * sizes.length)]),
  onUpdate: (p, _k, t) => Math.max(1 / 3, Math.ceil(p._bbSize * 3 * (1 - t)) / 3),
});

function trailEmitters(scene, texture, sprite, fx, fy) {
  const team = teamOf(sprite);
  const back = speed => ({ min: -speed[1], max: -speed[0] });
  const velocity = (along, side) => {
    const a = back(along);
    return {
      speedX: { min: fx * a.min - Math.abs(fy) * side, max: fx * a.max + Math.abs(fy) * side },
      speedY: { min: fy * a.min - Math.abs(fx) * side, max: fy * a.max + Math.abs(fx) * side },
    };
  };
  const make = (depth, config) => scene.add.particles(0, 0, texture, { emitting: false, blendMode: "NORMAL", ...config })
    .setDepth(sprite.depth + depth);
  return {
    // Hot licks peeling off the back of the ball.
    flame: make(-1, {
      lifespan: { min: 150, max: 290 }, maxParticles: 160,
      ...velocity([50, 120], 34), gravityY: -50,
      scale: shrinking([1, 1, 2 / 3]), tint: toneRamp(scene, team, ["square", "round"], ["core", "light", "mid", "edge"]),
    }),
    // Embers drift up and sideways, cooling to the outline colour.
    ember: make(-2, {
      lifespan: { min: 360, max: 680 }, maxParticles: 90,
      ...velocity([15, 70], 55), gravityY: -120,
      scale: shrinking([2 / 3, 1 / 3]), tint: toneRamp(scene, team, ["square", "plus"], ["light", "mid", "edge", "outline"]),
    }),
    // A faint smoke wake gives the trail a body without a solid ribbon.
    smoke: make(-3, {
      lifespan: { min: 420, max: 620 }, maxParticles: 60,
      ...velocity([10, 40], 18), gravityY: -45,
      scale: stepped([1, 4 / 3, 5 / 3]), alpha: stepped([0.45, 0.32, 0.18]), tint: toneRamp(scene, team, ["square"], ["smoke"]),
    }),
  };
}

export function createFireballParticles(scene, sprite, angle) {
  const fx = Math.cos(angle), fy = Math.sin(angle);
  const texture = getPixelTexture(scene);
  const emitters = trailEmitters(scene, texture, sprite, fx, fy);
  const all = Object.values(emitters);
  let step = 0;
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
    all.forEach(emitter => emitter.destroy());
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
      if (drainMs > 700) destroy();
      return;
    }
    const size = Math.abs(sprite.scaleX || 0.5) / 0.5;
    // Emit along the path travelled this frame so spacing stays even at any
    // frame rate; positions are random so no lanes or rails form.
    for (let ms = STEP_MS - carry; ms <= dt; ms += STEP_MS) {
      const t = dt ? ms / dt : 1;
      const x = previous.x + (sprite.x - previous.x) * t;
      const y = previous.y + (sprite.y - previous.y) * t;
      step++;
      for (let i = 0; i < 2; i++) emitters.flame.emitParticleAt(...rearPoint(x, y, size, 0.45 + Math.random() * 0.4, 1.3), 1);
      if (step % 3 === 0) emitters.ember.emitParticleAt(...rearPoint(x, y, size, 0.7 + Math.random() * 0.4, 1.6), 1);
      if (step % 4 === 0) emitters.smoke.emitParticleAt(...rearPoint(x, y, size, 1, 0.9), 1);
    }
    carry = (carry + dt) % STEP_MS;
    previous = { x: sprite.x, y: sprite.y };
  };
  scene.events.on("postupdate", update);
  scene.events.once("shutdown", destroy);
  scene.events.once("presentation:reset", destroy);
  return { destroy, stop() { draining = true; } };
}

// A one-shot spray of pixel embers where the fireball lands.
export function spawnFireballBurst(scene, x, y, owner) {
  if (!scene?.add?.particles || !scene.textures) return;
  const emitter = scene.add.particles(0, 0, getPixelTexture(scene), {
    emitting: false, blendMode: "NORMAL",
    lifespan: { min: 200, max: 460 }, speed: { min: 60, max: 190 }, angle: { min: 0, max: 360 },
    gravityY: -80, scale: shrinking([1, 2 / 3, 2 / 3]),
    tint: toneRamp(scene, teamOf(owner), SHAPES, ["core", "light", "mid", "edge"]),
  }).setDepth(owner?.depth ?? 100);
  emitter.explode(14, Math.round(x), Math.round(y));
  let done = false;
  const destroy = () => {
    if (done) return;
    done = true;
    scene.events?.off?.("shutdown", destroy);
    emitter.destroy();
  };
  scene.events?.once?.("shutdown", destroy);
  scene.time?.delayedCall?.(520, destroy);
}
