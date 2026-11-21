// Sparrow's Seraph effects: the angelic shield, the aim light, the release and
// the light bolt with its beam. Pixel art from scripts/art/sparrow-pixel/
// seraph-fx.cjs, packed in the seraph-fx atlas.
// Presentation only: the server owns the bolt's hits.
import { RENDER_LAYERS } from "../../scene/renderLayers";
import { BOLT, SERAPH } from "../../../../shared/characters/sparrowLightBolt.js";
import { createRuntimeId } from "../shared/runtimeId";

export const SERAPH_FX_KEY = "sparrow-seraph-fx";
// name -> frames, fps, repeat (-1 loops)
export const SERAPH_FX_ANIMS = {
  shield: { count: 24, rate: 24, repeat: -1 },
  rayStart: { count: 4, rate: 12, repeat: -1 },
  bolt: { count: 8, rate: 30, repeat: -1 },
  flash: { count: 10, rate: 24, repeat: 0 },
  radiance: { count: 12, rate: 20, repeat: 0 },
  impact: { count: 8, rate: 24, repeat: 0 },
  feather: { count: 8, rate: 10, repeat: -1 },
  mote: { count: 4, rate: 12, repeat: -1 },
};
const frameName = (name, i) => `${name}${String(i).padStart(2, "0")}`;
// The world is drawn a little larger than her art pixels; match her.
const ART_SCALE = 1.056;
const AIM_THICKNESS_SCALE = 1.15;
const BEAM_FADE_DELAY_MS = 205;
const BEAM_FADE_MS = 1160;
const BEAM_FADE_WIDTH = 0.46; // Fraction of the flight covered by the soft fade edge.
const TIP_FEATHER_PX = 280;
const BEAM_TEXTURE_SCALE_X = 2; // World pixels per canvas texel along the bolt.
const BEAM_SCROLL_ART_PX_PER_MS = 0.22;
const stripTiles = new WeakMap();

function ready(scene) {
  return !!scene?.add && scene.textures?.exists?.(SERAPH_FX_KEY);
}

function play(sprite, name) {
  const key = `${SERAPH_FX_KEY}-${name}`;
  if (sprite.scene?.anims?.exists(key)) sprite.anims.play(key);
  return sprite;
}

function fxSprite(scene, x, y, name, depth) {
  const sprite = scene.add.sprite(x, y, SERAPH_FX_KEY, frameName(name, 0));
  sprite.setScale(ART_SCALE).setDepth(depth);
  return play(sprite, name);
}

// Removes a one-shot when its animation ends, or after `ms` as a fallback.
function oneShot(scene, sprite, ms = 900) {
  const done = () => { if (sprite.active) sprite.destroy(); };
  sprite.once?.("animationcomplete", done);
  scene.time?.delayedCall?.(ms, done);
  return sprite;
}

/** The angelic shield: follows the sprite until destroyed. */
export function createSeraphShield(scene, player) {
  if (!ready(scene)) return null;
  const shield = fxSprite(scene, player.x, player.y, "shield", RENDER_LAYERS.PLAYER + 1);
  const pulses = [0, 0.5].map(offset => ({
    offset,
    sprite: scene.add.image(player.x, player.y, SERAPH_FX_KEY, frameName("shieldPulse", 0))
      .setDepth(RENDER_LAYERS.PLAYER + 1).setAlpha(0),
  }));
  shield.setAlpha(0);
  scene.tweens?.add({ targets: shield, alpha: 0.95, duration: 260 });
  return {
    sync(x, y, elapsed) {
      if (!shield.active) return;
      shield.setPosition(x, y);
      const charge = Math.min(1, elapsed / SERAPH.aimMs);
      const cycles = (elapsed / 1000) * (0.86 + 0.62 * charge ** 2);
      const strength = charge < 1 ? smoothStep(elapsed / SERAPH.riseMs) * (0.58 + 0.36 * charge) : 0;
      for (const { sprite, offset } of pulses) {
        const phase = (cycles + offset) % 1;
        sprite.setPosition(x, y).setScale(ART_SCALE * (1.025 + 0.29 * phase))
          .setAlpha(strength * (1 - phase) ** 1.15);
      }
    },
    destroy() {
      for (const { sprite } of pulses) sprite.destroy();
      if (!shield.active) return;
      scene.tweens?.killTweensOf?.(shield);
      scene.tweens?.add({ targets: shield, alpha: 0, scale: ART_SCALE * 1.25, duration: 180,
        onComplete: () => shield.destroy() });
    },
  };
}

/** The aim light: a soft beam from the bow along the aim. */
export function createAimRay(scene) {
  if (!ready(scene)) return null;
  const textureKey = createRuntimeId("seraphAim");
  const tiles = getStripTiles(scene, "ray", 4);
  const texture = scene.textures.createCanvas(textureKey, Math.ceil(BOLT.range / BEAM_TEXTURE_SCALE_X), tiles[0].height);
  const ctx = texture.context;
  const patterns = tiles.map(tile => ctx.createPattern(tile, "repeat-x"));
  const tip = ctx.createLinearGradient((BOLT.range - TIP_FEATHER_PX) / BEAM_TEXTURE_SCALE_X, 0, BOLT.range / BEAM_TEXTURE_SCALE_X, 0);
  for (let i = 0; i <= 4; i++) tip.addColorStop(i / 4, `rgba(255,255,255,${smoothStep(1 - i / 4)})`);
  const ray = scene.add.image(0, 0, textureKey)
    .setOrigin(0, 0.5).setDepth(RENDER_LAYERS.ATTACKS + 2)
    .setScale(BEAM_TEXTURE_SCALE_X, ART_SCALE * AIM_THICKNESS_SCALE);
  const start = fxSprite(scene, 0, 0, "rayStart", RENDER_LAYERS.ATTACKS + 3);
  ray.setAlpha(0); start.setAlpha(0);
  let shown = 0;
  let lastFrame = -1;
  return {
    update(x, y, angle, { visible = true } = {}) {
      if (!ray.active) return;
      const now = scene.time?.now || 0;
      shown += ((visible ? 1 : 0) - shown) * 0.25;
      ray.setPosition(x, y).setRotation(angle).setAlpha(shown * 0.88);
      start.setPosition(x, y).setAlpha(shown);
      const frame = Math.floor(now * 0.03);
      if (shown < 0.005 || frame === lastFrame) return;
      lastFrame = frame;
      const scroll = Math.floor(now * 0.12) % tiles[0].width;
      const pattern = patterns[Math.floor(now / 100) % patterns.length];
      drawStrip(texture, pattern, scroll, BOLT.range / BEAM_TEXTURE_SCALE_X, tip);
    },
    destroy() {
      ray.destroy();
      start.destroy();
      scene.textures.remove(textureKey);
    },
  };
}

export function createSeraphChargeLights(scene) {
  if (!ready(scene)) return null;
  const lights = [-2.72, -1.82, -0.9, 0.08, 0.94, 2.12].map((angle, i) => ({
    x: Math.cos(angle),
    y: Math.sin(angle),
    phase: Math.PI * (i % 2) + i * 0.4,
    reach: 26 + 8 * (i % 2),
    sprite: scene.add.image(0, 0, SERAPH_FX_KEY, frameName("chargeLight", 0))
      .setOrigin(0.18, 0.5).setRotation(angle).setDepth(RENDER_LAYERS.PLAYER + 2).setAlpha(0),
  }));
  return {
    sync(x, y, elapsed) {
      const progress = Math.min(1, elapsed / SERAPH.aimMs);
      const appear = smoothStep(elapsed / SERAPH.riseMs);
      // Integrate the pulse rate so low frame rates preserve its timing.
      const pulse = Math.PI * 2 * (elapsed / 1000) * (0.35 + 0.38 * progress ** 2);
      for (const light of lights) {
        const phase = pulse + light.phase;
        const extension = (1 - Math.cos(phase)) * 0.5;
        const radius = 3 + light.reach * extension;
        const brightness = 0.62 + 0.38 * Math.sin(phase) ** 2;
        light.sprite.setPosition(x + light.x * radius, y + light.y * radius)
          .setScale(0.64 + 0.28 * progress + 0.14 * extension, 0.9)
          .setAlpha(progress >= 1 ? 0 : appear * brightness * (0.68 + 0.32 * progress));
      }
    },
    destroy() { for (const light of lights) light.sprite.destroy(); },
  };
}

/** Loose feathers brushing off her and fluttering down. */
export function shedFeathers(scene, x, y, { count = 5, facing = 1 } = {}) {
  if (!ready(scene)) return;
  for (let i = 0; i < count; i++) {
    const feather = fxSprite(scene, x - facing * (6 + Math.random() * 18), y - 18 + Math.random() * 20,
      "feather", RENDER_LAYERS.PLAYER + 2);
    feather.anims.setProgress?.(Math.random());
    const drift = -facing * (20 + Math.random() * 50);
    const fall = 90 + Math.random() * 70;
    const duration = 1500 + Math.random() * 900;
    const sway = 10 + Math.random() * 10;
    const x0 = feather.x;
    scene.tweens.add({
      targets: feather, y: feather.y + fall, alpha: { from: 1, to: 0 }, duration, ease: "Sine.easeIn",
      onUpdate: (tween) => {
        const t = tween.progress;
        feather.x = x0 + drift * t + Math.sin(t * Math.PI * 3 + i) * sway;
      },
      onComplete: () => feather.destroy(),
    });
  }
}

function motes(scene, x, y, count, spread, depth) {
  for (let i = 0; i < count; i++) {
    const mote = fxSprite(scene, x + (Math.random() * 2 - 1) * spread, y + (Math.random() * 2 - 1) * spread, "mote", depth);
    scene.tweens.add({ targets: mote, y: mote.y - 8 - Math.random() * 16, alpha: 0,
      duration: 380 + Math.random() * 360, onComplete: () => mote.destroy() });
  }
}

/** The release: radiance around her and the explosion of light at the bow. */
export function playSeraphRelease(scene, { x, y, bowX, bowY, facing = 1 }) {
  if (!ready(scene)) return;
  oneShot(scene, fxSprite(scene, x, y, "radiance", RENDER_LAYERS.PLAYER - 1).setScale(ART_SCALE * 1.15));
  oneShot(scene, fxSprite(scene, bowX, bowY, "flash", RENDER_LAYERS.ATTACKS + 6));
  motes(scene, x, y, 10, 30, RENDER_LAYERS.ATTACKS + 5);
  shedFeathers(scene, x, y, { count: 6, facing });
  scene.cameras?.main?.shake?.(140, 0.004);
}

/** A strike on a target. */
export function playSeraphImpact(scene, x, y) {
  if (!ready(scene)) return;
  oneShot(scene, fxSprite(scene, x, y, "impact", RENDER_LAYERS.ATTACKS + 6));
  motes(scene, x, y, 7, 16, RENDER_LAYERS.ATTACKS + 5);
}

function getStripTiles(scene, name, count) {
  const atlas = scene.textures.get(SERAPH_FX_KEY);
  let strips = stripTiles.get(atlas);
  if (!strips) {
    strips = new Map();
    stripTiles.set(atlas, strips);
  }
  if (strips.has(name)) return strips.get(name);
  const tiles = Array.from({ length: count }, (_, i) => {
    const frame = atlas.get(frameName(name, i));
    const tile = scene.game.canvas.ownerDocument.createElement("canvas");
    tile.width = frame.cutWidth;
    tile.height = frame.cutHeight;
    tile.getContext("2d").drawImage(frame.source.image, frame.cutX, frame.cutY,
      tile.width, tile.height, 0, 0, tile.width, tile.height);
    return tile;
  });
  strips.set(name, tiles);
  return tiles;
}

function drawStrip(texture, pattern, scroll, length, alpha) {
  const ctx = texture.context;
  const tileScale = ART_SCALE / BEAM_TEXTURE_SCALE_X;
  ctx.clearRect(0, 0, texture.width, texture.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(tileScale, 1);
  ctx.translate(-scroll, 0);
  ctx.fillStyle = pattern;
  ctx.fillRect(scroll, 0, length / tileScale, texture.height);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = alpha;
  ctx.fillRect(0, 0, texture.width, texture.height);
  ctx.restore();
  texture.refresh();
}

function smoothStep(t) {
  const p = Math.min(1, Math.max(0, t));
  return p * p * (3 - 2 * p);
}

// Keep the beam's geometry in place as its light recedes. Sample each ramp at
// several points so the fade has eased shoulders at the bow and the bolt tip.
function beamAlphaGradient(ctx, length, range, fadeAge) {
  const originFeather = 104;
  const tipFeather = Math.min(64, length);
  const rangeFeather = Math.min(TIP_FEATHER_PX, range);
  const fadeWidth = range * BEAM_FADE_WIDTH;
  const fadeProgress = Math.max(0, fadeAge / BEAM_FADE_MS);
  const fadeFront = (range + fadeWidth) * fadeProgress - fadeWidth;
  const points = [0, length];
  for (let i = 0; i <= 4; i++) {
    points.push(originFeather * i / 4, length - tipFeather * i / 4,
      range - rangeFeather * i / 4, fadeFront + fadeWidth * i / 4);
  }
  const gradient = ctx.createLinearGradient(0, 0, length / BEAM_TEXTURE_SCALE_X, 0);
  for (const x of points) {
    if (x < 0 || x > length) continue;
    const alpha = smoothStep(x / originFeather) * smoothStep((length - x) / tipFeather) *
      smoothStep((range - x) / rangeFeather) * smoothStep((x - fadeFront) / fadeWidth);
    gradient.addColorStop(x / length, `rgba(255,255,255,${alpha})`);
  }
  return gradient;
}

/**
 * The light bolt: its head races along the aim at the flight's speed and
 * leaves woven energy behind it which fades from the bow along its path.
 * `bolt` is the shared flight (sparrowLightBolt.createBolt); `ageMs` how far
 * into its flight it already is.
 */
export function launchSeraphBolt(scene, bolt, { ageMs = 0 } = {}) {
  if (!ready(scene) || !bolt) return null;
  const angle = Math.atan2(bolt.vy, bolt.vx);
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const tiles = getStripTiles(scene, "beam", 6);
  const textureKey = createRuntimeId("seraphBeam");
  const texture = scene.textures.createCanvas(textureKey, Math.ceil(bolt.range / BEAM_TEXTURE_SCALE_X), tiles[0].height);
  const ctx = texture.context;
  const patterns = tiles.map((tile) => ctx.createPattern(tile, "repeat-x"));
  const beam = scene.add.image(bolt.x, bolt.y, textureKey).setOrigin(0, 0.5).setRotation(angle)
    .setScale(BEAM_TEXTURE_SCALE_X, ART_SCALE).setDepth(RENDER_LAYERS.ATTACKS + 4);
  const head = fxSprite(scene, bolt.x, bolt.y, "bolt", RENDER_LAYERS.ATTACKS + 5)
    .setRotation(angle).setOrigin(0.83, 0.5);
  const startedAt = (scene.time?.now || 0) - ageMs;
  let lastMote = 0;
  const update = () => {
    if (!beam.active) { stop(); return; }
    const now = scene.time?.now || 0;
    const age = now - startedAt;
    const fadeAge = age - BEAM_FADE_DELAY_MS;
    if (fadeAge >= BEAM_FADE_MS) { stop(); return; }
    const travelled = Math.min(bolt.range, (bolt.speed * age) / 1000);
    if (travelled > 0) {
      const length = travelled / BEAM_TEXTURE_SCALE_X;
      const tile = Math.floor(age * 0.024) % tiles.length;
      const scroll = Math.floor(age * BEAM_SCROLL_ART_PX_PER_MS) % tiles[tile].width;
      drawStrip(texture, patterns[tile], scroll, length, beamAlphaGradient(ctx, travelled, bolt.range, fadeAge));
    }
    if (head.active) {
      const headAlpha = smoothStep((bolt.range - travelled) / TIP_FEATHER_PX);
      head.setPosition(bolt.x + ux * travelled, bolt.y + uy * travelled).setAlpha(headAlpha);
      if (headAlpha > 0.3 && now - lastMote > 32) {
        lastMote = now;
        motes(scene, head.x - ux * 30, head.y - uy * 30, 2, 10, RENDER_LAYERS.ATTACKS + 5);
      }
      if (travelled >= bolt.range) head.destroy();
    }
  };
  const stop = () => {
    scene.events?.off("update", update);
    scene.events?.off("shutdown", stop);
    if (head.active) head.destroy();
    if (beam.active) beam.destroy();
    if (scene.textures.exists(textureKey)) scene.textures.remove(textureKey);
  };
  scene.events?.on("update", update);
  scene.events?.once("shutdown", stop);
  update();
  return { stop };
}
