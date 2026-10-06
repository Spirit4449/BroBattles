// Soft light textures for map atmosphere, drawn once per game on a canvas so
// maps need no image files for rays, glows, dust, fog or vignettes.

export const SCENERY_TEXTURES = Object.freeze({
  ray: 'scenery-fx-ray',
  glow: 'scenery-fx-glow',
  dot: 'scenery-fx-dot',
  fog: 'scenery-fx-fog',
  mist: 'scenery-fx-mist',
  vignette: 'scenery-fx-vignette',
});

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// White pixels whose alpha comes from alphaAt(u, v) with u, v in [0, 1].
function paintAlpha(scene, key, width, height, alphaAt) {
  const texture = scene.textures.createCanvas(key, width, height);
  const ctx = texture.getContext();
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(255 * clamp01(alphaAt((x + 0.5) / width, (y + 0.5) / height)));
    }
  }
  ctx.putImageData(image, 0, 0);
  texture.refresh();
  return texture;
}

function paintMist(scene, key) {
  const width = 512, height = 256;
  const texture = scene.textures.createCanvas(key, width, height);
  const ctx = texture.getContext();
  const random = seeded(7);
  for (let i = 0; i < 46; i++) {
    const r = 36 + random() * 84;
    const y = height * (0.3 + random() * 0.4);
    const x = random() * width;
    // Drawn three times so the texture tiles horizontally without a seam.
    for (const dx of [-width, 0, width]) {
      const gradient = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      gradient.addColorStop(0, 'rgba(255,255,255,0.32)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x + dx - r, y - r, r * 2, r * 2);
    }
  }
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createLinearGradient(0, 0, 0, height);
  fade.addColorStop(0, 'rgba(255,255,255,0)');
  fade.addColorStop(0.35, 'rgba(255,255,255,1)');
  fade.addColorStop(0.65, 'rgba(255,255,255,1)');
  fade.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  texture.refresh();
  return texture;
}

export function ensureSceneryTextures(scene) {
  const T = SCENERY_TEXTURES;
  const painters = {
    // Feathered shaft: soft across its width, fading in at the source and out along its length.
    [T.ray]: () => paintAlpha(scene, T.ray, 128, 512, (u, v) =>
      Math.exp(-Math.pow((u - 0.5) * 2, 2) * 4.5) * smoothstep(0, 0.1, v) * Math.pow(1 - v, 1.6)),
    [T.glow]: () => paintAlpha(scene, T.glow, 256, 256, (u, v) =>
      Math.pow(clamp01(1 - Math.hypot(u - 0.5, v - 0.5) * 2), 2.2)),
    [T.dot]: () => paintAlpha(scene, T.dot, 32, 32, (u, v) =>
      Math.pow(clamp01(1 - Math.hypot(u - 0.5, v - 0.5) * 2), 1.6)),
    // Haze pools toward the ground, like valley fog, and thins into the sky.
    [T.fog]: () => paintAlpha(scene, T.fog, 4, 256, (_u, v) => 0.3 + 0.7 * Math.pow(v, 1.4)),
    [T.vignette]: () => paintAlpha(scene, T.vignette, 256, 256, (u, v) =>
      Math.pow(smoothstep(0.45, 1.05, Math.hypot((u - 0.5) * 2, (v - 0.5) * 2) / Math.SQRT2 * 1.25), 1.3)),
    [T.mist]: () => paintMist(scene, T.mist),
  };
  for (const [key, paint] of Object.entries(painters)) {
    if (scene.textures.exists(key)) continue;
    paint().setFilter(Phaser.Textures.FilterMode.LINEAR);
  }
}
