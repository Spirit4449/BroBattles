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

// Three box passes approximate a Gaussian. Colour is premultiplied so
// transparent pixels do not bleed dark fringes; edges clamp.
function boxBlur(image, radius) {
  const { width: w, height: h, data } = image, size = w * h * 4;
  let src = new Float32Array(size), dst = new Float32Array(size);
  for (let i = 0; i < size; i += 4) {
    const a = data[i + 3] / 255;
    src[i] = data[i] * a; src[i + 1] = data[i + 1] * a; src[i + 2] = data[i + 2] * a; src[i + 3] = data[i + 3];
  }
  const span = 2 * radius + 1;
  const pass = (length, lines, index) => {
    for (let line = 0; line < lines; line++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += src[index(line, Math.min(length - 1, Math.max(0, k))) + c];
        for (let p = 0; p < length; p++) {
          dst[index(line, p) + c] = sum / span;
          sum += src[index(line, Math.min(length - 1, p + radius + 1)) + c] - src[index(line, Math.max(0, p - radius)) + c];
        }
      }
    }
    [src, dst] = [dst, src];
  };
  for (let i = 0; i < 3; i++) {
    pass(w, h, (y, x) => (y * w + x) * 4);
    pass(h, w, (x, y) => (y * w + x) * 4);
  }
  for (let i = 0; i < size; i += 4) {
    const a = src[i + 3], unpremultiply = a > 0 ? 255 / a : 0;
    data[i] = src[i] * unpremultiply; data[i + 1] = src[i + 1] * unpremultiply;
    data[i + 2] = src[i + 2] * unpremultiply; data[i + 3] = a;
  }
}

/**
 * Depth of field without Phaser preFX (which renders offset under the game's
 * framebuffer scaling): a blurred copy of `key`, made once and cached.
 * `sigma` is the Gaussian radius in texture pixels.
 */
export function blurredTexture(scene, key, sigma) {
  const blurredKey = `${key}:blur${sigma}`;
  if (scene.textures.exists(blurredKey)) return blurredKey;
  const source = scene.textures.get(key).getSourceImage();
  const pad = Math.ceil(sigma * 3);
  const texture = scene.textures.createCanvas(blurredKey, source.width, source.height);
  const ctx = texture.getContext();
  ctx.filter = `blur(${sigma}px)`;
  if (ctx.filter !== 'none' && ctx.filter !== '') {
    // Blur a copy padded with stretched edge pixels, so the border clamps
    // instead of fading to transparent.
    const w = source.width, h = source.height;
    const padded = document.createElement('canvas');
    padded.width = w + 2 * pad;
    padded.height = h + 2 * pad;
    const p = padded.getContext('2d');
    p.drawImage(source, 0, 0, 1, h, 0, pad, pad, h);
    p.drawImage(source, w - 1, 0, 1, h, w + pad, pad, pad, h);
    p.drawImage(source, 0, 0, w, 1, pad, 0, w, pad);
    p.drawImage(source, 0, h - 1, w, 1, pad, h + pad, w, pad);
    p.drawImage(source, pad, pad);
    ctx.drawImage(padded, -pad, -pad);
    ctx.filter = 'none';
  } else {
    // Older browsers without canvas filters: three box passes, radius ≈ sigma.
    ctx.drawImage(source, 0, 0);
    const image = ctx.getImageData(0, 0, source.width, source.height);
    boxBlur(image, Math.max(1, Math.round(sigma)));
    ctx.putImageData(image, 0, 0);
  }
  texture.refresh();
  texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return blurredKey;
}
