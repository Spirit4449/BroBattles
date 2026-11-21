#!/usr/bin/env node
// Installs Rumble Stadium's art (map 6, Bro Ball) as one coherent pixel finish.
//
//   node scripts/art/install-bro-ball-art.cjs     <- this: art + manifest
//   node scripts/maps/build-sunset-bowl.cjs       <- reads the manifest, writes the map
//
// The stadium sources in scripts/art/bro-ball-originals are Codex image
// generations. Like Sky Soil and Iron Junction, each piece is composed at
// its world size, keyed, then traced onto a chunky
// grid (the mode of palette-snapped colours per cell, as in
// docs/art/code-pixel-art.md) and saved at that art resolution; the map shows
// it scaled up with nearest filtering. Near art uses a 3 world px grid and the
// far layers 4. Pieces the level is built around (the end wall's goal mouth,
// the pitch's walk line, a platform's deck) are measured here and written to
// scripts/maps/sunset-bowl-art.json, so the build fits the colliders to the art.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(__dirname, "bro-ball-originals");
const OUT = path.join(ROOT, "public", "assets", "bro-ball");
const MANIFEST = path.join(ROOT, "scripts", "maps", "sunset-bowl-art.json");
const sharp = require(path.join(ROOT, "spritesheet-generator", "node_modules", "sharp"));

const NEAR = 3, FAR = 4;

// ---------------------------------------------------------------------------
// Pixel buffers
// ---------------------------------------------------------------------------
class Img {
  constructor(width, height, data) {
    this.width = width; this.height = height;
    this.data = data || Buffer.alloc(width * height * 4);
  }
  static async load(file) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return new Img(info.width, info.height, data);
  }
  // A region, resampled by `scale` (smooth; the pixel trace makes it crisp).
  async region({ left = 0, top = 0, width = this.width, height = this.height }, scale = 1) {
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    const { data, info } = await sharp(this.data, { raw: { width: this.width, height: this.height, channels: 4 } })
      .extract({ left, top, width, height }).resize(w, h, { kernel: "lanczos3" }).raw()
      .toBuffer({ resolveWithObject: true });
    return new Img(info.width, info.height, data);
  }
  blit(src, x0, y0) {
    for (let y = 0; y < src.height; y++) {
      const ty = y + Math.round(y0);
      if (ty < 0 || ty >= this.height) continue;
      for (let x = 0; x < src.width; x++) {
        const tx = x + Math.round(x0);
        if (tx < 0 || tx >= this.width) continue;
        const s = (y * src.width + x) * 4, t = (ty * this.width + tx) * 4;
        if (src.data[s + 3] < 128) continue;
        src.data.copy(this.data, t, s, s + 4);
      }
    }
  }
  fill(x0, y0, w, h, rgb) {
    for (let y = Math.max(0, y0); y < Math.min(this.height, y0 + h); y++) {
      for (let x = Math.max(0, x0); x < Math.min(this.width, x0 + w); x++) {
        const t = (y * this.width + x) * 4;
        this.data[t] = rgb[0]; this.data[t + 1] = rgb[1]; this.data[t + 2] = rgb[2]; this.data[t + 3] = 255;
      }
    }
  }
  each(fn) {
    for (let i = 0; i < this.data.length; i += 4) fn(this.data, i, (i / 4) % this.width, Math.floor(i / 4 / this.width));
  }
}

// Flat #FF00FF backgrounds (and the white outside a generated sprite) go transparent.
function keyMagenta(img) {
  img.each((d, i) => { if (Math.min(d[i], d[i + 2]) - d[i + 1] > 90) d[i + 3] = 0; });
}

const dist = (a, b) => {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr * 0.3 + dg * dg * 0.55 + db * db * 0.15;
};
function nearest(c, palette) {
  let best = 0, score = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = dist(c, palette[i]);
    if (d < score) { score = d; best = i; }
  }
  return best;
}
function paletteFor(img, count) {
  const samples = [];
  const stride = Math.max(1, Math.floor(img.data.length / 4 / 40000));
  for (let i = 0; i < img.data.length; i += 4 * stride) if (img.data[i + 3] >= 128) samples.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
  const palette = [samples[Math.floor(samples.length / 2)].slice()];
  while (palette.length < count) {
    let far = samples[0], score = -1;
    for (let i = 0; i < samples.length; i += 5) {
      const d = dist(samples[i], palette[nearest(samples[i], palette)]);
      if (d > score) { score = d; far = samples[i]; }
    }
    palette.push(far.slice());
  }
  for (let pass = 0; pass < 8; pass++) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    for (const c of samples) {
      const s = sums[nearest(c, palette)];
      s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; s[3]++;
    }
    palette.forEach((p, i) => { const s = sums[i]; if (s[3]) for (let k = 0; k < 3; k++) p[k] = Math.round(s[k] / s[3]); });
  }
  return palette;
}

// Trace an image at world resolution onto a grid of `grid` px: the mode of
// palette colours per cell; a cell is see-through when most of it is.
function pixelate(img, grid, colours) {
  const palette = paletteFor(img, colours);
  const w = Math.ceil(img.width / grid), h = Math.ceil(img.height / grid);
  const out = new Img(w, h);
  const votes = new Uint32Array(palette.length);
  const cache = new Map();
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      votes.fill(0);
      let opaque = 0, total = 0;
      for (let y = cy * grid; y < Math.min(img.height, (cy + 1) * grid); y++) {
        for (let x = cx * grid; x < Math.min(img.width, (cx + 1) * grid); x++) {
          const i = (y * img.width + x) * 4;
          total++;
          if (img.data[i + 3] < 128) continue;
          opaque++;
          const key = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
          let k = cache.get(key);
          if (k === undefined) { k = nearest([img.data[i], img.data[i + 1], img.data[i + 2]], palette); cache.set(key, k); }
          votes[k]++;
        }
      }
      if (opaque * 2 <= total) continue;
      let mode = 0;
      for (let k = 1; k < votes.length; k++) if (votes[k] > votes[mode]) mode = k;
      const j = (cy * w + cx) * 4;
      [out.data[j], out.data[j + 1], out.data[j + 2]] = palette[mode];
      out.data[j + 3] = 255;
    }
  }
  return out;
}

async function save(img, name) {
  await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
    .webp({ lossless: true }).toFile(path.join(OUT, `${name}.webp`));
  return { file: `${name}.webp`, width: img.width, height: img.height };
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

// A smooth sunset wash. The map draws the shared cloud sprites above it.
async function sky() {
  const width = 1300, height = 640;
  const file = "sunset-gradient.webp";
  const gradient = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#42558e"/>
        <stop offset=".12" stop-color="#78689f"/>
        <stop offset=".25" stop-color="#cb87a4"/>
        <stop offset=".42" stop-color="#f2ad97"/>
        <stop offset="1" stop-color="#ffce9d"/>
      </linearGradient>
      <radialGradient id="glow" cx=".40" cy=".42" r=".36">
        <stop offset="0" stop-color="#ffdc9f" stop-opacity=".64"/>
        <stop offset="1" stop-color="#ffdc9f" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#sky)"/>
    <rect width="100%" height="100%" fill="url(#glow)"/>
  </svg>`;
  await sharp(Buffer.from(gradient)).webp({ lossless: true }).toFile(path.join(OUT, file));
  return { file, width, height };
}

// Roof tiles and a continuous copper-bound timber beam, drawn on the same
// grid as the pitch. The last row is the face of the ceiling collider.
async function roof() {
  const underside = 57;
  const art = new Img(900, underside + 4);
  art.fill(0, 0, art.width, underside, [47, 29, 47]);
  for (let row = 0; row < 4; row++) {
    const y = row * 8 - 2;
    for (let x = -24 + (row % 2) * 12; x < art.width; x += 24) {
      const shade = Math.abs(7 * row + 5 * (x / 12)) % 13;
      art.fill(x + 1, y, 22, 7, [114 + shade, 54 + shade, 61 + shade]);
      art.fill(x + 2, y + 1, 19, 1, [155 + shade, 76 + shade, 71 + shade]);
      art.fill(x + 3, y + 5, 19, 2, [87 + shade, 42 + shade, 53 + shade]);
    }
  }
  art.fill(0, 30, art.width, 6, [131, 68, 53]);
  art.fill(0, 31, art.width, 2, [222, 141, 82]);
  art.fill(0, 36, art.width, 16, [111, 52, 49]);
  art.fill(0, 37, art.width, 2, [165, 82, 54]);
  art.fill(0, 49, art.width, 6, [75, 35, 42]);
  art.fill(0, 53, art.width, 2, [154, 77, 53]);
  for (let x = 25; x < art.width; x += 50) {
    art.fill(x - 4, 34, 8, 21, [63, 43, 52]);
    art.fill(x - 3, 35, 5, 16, [181, 109, 68]);
    art.fill(x - 2, 39, 2, 2, [251, 194, 117]);
    art.fill(x - 2, 47, 2, 2, [242, 169, 98]);
    art.fill(x + 7, 42, 22 + (x % 7), 1, [138, 63, 48]);
    art.fill(x + 15, 46, 14 + (x % 9), 1, [87, 41, 43]);
  }
  // Short bearing blocks bridge the roof and the tops of the goal walls.
  const bearingWidth = 190;
  art.fill(0, underside, bearingWidth, 4, [77, 40, 45]);
  art.fill(art.width - bearingWidth, underside, bearingWidth, 4, [77, 40, 45]);
  art.fill(0, underside + 1, bearingWidth - 1, 1, [151, 78, 57]);
  art.fill(art.width - bearingWidth + 1, underside + 1, bearingWidth - 1, 1, [151, 78, 57]);
  return { ...(await save(art, "stadium-roof")), grid: NEAR, underside: underside * NEAR };
}

async function peaks() {
  const src = await Img.load(path.join(SRC, "sunset-peaks.png"));
  const world = await src.region({}, 3200 / src.width);
  const art = pixelate(world, FAR, 48);
  // A second crumb-sized detail on an inner ridge stays visible from the pitch.
  const x = Math.round(art.width * 0.66), y = Math.round(art.height * 0.74);
  art.fill(x - 5, y + 2, 11, 2, [113, 68, 86]);
  art.fill(x - 4, y - 2, 9, 5, [157, 99, 101]);
  art.fill(x - 2, y - 4, 5, 6, [203, 137, 107]);
  art.fill(x - 3, y - 2, 7, 3, [203, 137, 107]);
  art.fill(x - 1, y - 3, 3, 1, [226, 163, 120]);
  art.fill(x - 2, y - 1, 1, 1, [114, 62, 79]);
  art.fill(x + 1, y - 2, 1, 1, [114, 62, 79]);
  art.fill(x + 2, y, 1, 1, [114, 62, 79]);
  return { ...(await save(art, "sunset-peaks")), grid: FAR };
}

// The pitch edge: a grass strip, painted boards (blue toward the left end, the
// crest panel on the halfway line, red toward the right), then the sandstone
// foundation fading into shade. `walk` is the grass walk line from the top.
async function pitch() {
  const src = await Img.load(path.join(SRC, "pitch.png"));
  const k = 0.36, width = 2700, halfway = 1350;
  const grass = await src.region({ top: 0, height: 52 }, k);
  const blue = await src.region({ left: 35, width: 663, top: 52, height: 300 }, k);
  const crest = await src.region({ left: 698, width: 779, top: 52, height: 300 }, k);
  const red = await src.region({ left: 1477, width: 655, top: 52, height: 300 }, k);
  const stone = await src.region({ top: 352, height: 265 }, k);
  const shade = await src.region({ top: 617, height: 107 }, k);
  const height = 420;
  const world = new Img(width, height);
  world.fill(0, 0, width, height, [28, 20, 32]);
  for (let x = 0; x < width; x += grass.width) world.blit(grass, x, 0);
  const boards = grass.height;
  const crestX = Math.round(halfway - crest.width / 2);
  world.blit(crest, crestX, boards);
  for (let x = crestX - blue.width; x > -blue.width; x -= blue.width) world.blit(blue, x, boards);
  for (let x = crestX + crest.width; x < width; x += red.width) world.blit(red, x, boards);
  for (let x = 0; x < width; x += stone.width) world.blit(stone, x, boards + blue.height);
  for (let x = 0; x < width; x += shade.width) world.blit(shade, x, boards + blue.height + stone.height);
  return { ...(await save(pixelate(world, NEAR, 48), "pitch")), grid: NEAR, walk: Math.round(36 * k), halfway };
}

// A hanging plank platform; the ropes are extended to reach the canopy.
// `deck` is the walk line and `span` the deck's ends, in world px.
async function platform(deckWidth = 260, ropeLength = 640) {
  const src = await Img.load(path.join(SRC, "platform.png"));
  keyMagenta(src);
  const k = deckWidth / (1856 - 316);
  const deck = await src.region({ left: 300, width: 1572, top: 500, height: 160 }, k);
  const rope = await src.region({ left: 300, width: 1572, top: 120, height: 380 }, k);
  const world = new Img(deck.width, ropeLength + deck.height);
  for (let y = ropeLength - rope.height; y > -rope.height; y -= rope.height) world.blit(rope, 0, y);
  world.blit(deck, 0, ropeLength);
  const walk = ropeLength + Math.round((516 - 500) * k);
  return { ...(await save(pixelate(world, NEAR, 24), "platform")), grid: NEAR, walk, span: [Math.round(16 * k), Math.round(16 * k) + deckWidth] };
}

// The end wall with its goal recessed into it, faced toward the pitch on the
// right. The left end's copy carries a blue banner. The mouth (lintel to step,
// back of the recess to the face) is measured from the generation.
async function wall() {
  const src = await Img.load(path.join(SRC, "wall.png"));
  // The white left showing through the open mouth is air.
  src.each((d, i, x) => { if (x > 900 && d[i] > 236 && d[i + 1] > 236 && d[i + 2] > 236) d[i + 3] = 0; });
  const mouth = { top: 900, bottom: 1305, back: 576, face: src.width };
  const k = 200 / (mouth.bottom - mouth.top);
  const red = await src.region({}, k);
  const blue = new Img(red.width, red.height, Buffer.from(red.data));
  // Recolour the banner (and only it) from team red to team blue.
  const banner = { left: 355 * k, right: 665 * k, top: 225 * k, bottom: 705 * k };
  blue.each((d, i, x, y) => {
    if (x < banner.left || x > banner.right || y < banner.top || y > banner.bottom) return;
    const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
    if (r - g > 55 && r - b > 45) { d[i] = Math.round(b * 0.75); d[i + 1] = Math.round(g * 0.9 + r * 0.12); d[i + 2] = Math.min(255, Math.round(r * 1.05)); }
  });
  const at = v => Math.round(v * k);
  const opening = { top: at(mouth.top), bottom: at(mouth.bottom), back: at(mouth.back), face: at(mouth.face) };
  const left = await save(pixelate(blue, NEAR, 48), "wall-team1");
  const right = await save(pixelate(red, NEAR, 48), "wall-team2");
  return { team1: left, team2: right, grid: NEAR,
    mouth: opening,
    torch: { x: at(880), y: at(470) } };
}

// A short, bare log with the sawn end facing into the pitch.
async function wallLog() {
  const art = new Img(50, 8);
  const outline = [53, 28, 29];
  art.fill(0, 0, 46, 8, outline);
  art.fill(46, 1, 3, 6, outline);
  art.fill(49, 2, 1, 4, outline);
  art.fill(0, 1, 44, 2, [179, 106, 55]);
  art.fill(0, 3, 44, 2, [137, 69, 41]);
  art.fill(0, 5, 44, 2, [100, 47, 35]);
  for (const [x, y, width] of [[2, 1, 10], [16, 1, 13], [33, 1, 8], [7, 3, 12], [25, 3, 11]]) {
    art.fill(x, y, width, 1, [211, 136, 72]);
  }
  for (const [x, y, width] of [[0, 4, 9], [14, 5, 13], [30, 4, 10], [33, 6, 10]]) {
    art.fill(x, y, width, 1, [76, 34, 29]);
  }
  art.fill(44, 1, 2, 6, [154, 80, 43]);
  art.fill(45, 2, 3, 4, [223, 151, 78]);
  art.fill(46, 3, 2, 2, [156, 82, 43]);
  art.fill(47, 3, 1, 1, [235, 174, 100]);
  return { ...(await save(art, "wall-log")), grid: NEAR };
}

const PIECES = { sky, peaks, roof, pitch, platform, wall, wallLog };
const only = process.argv.find(arg => arg.startsWith("--only="))?.slice(7).split(",");
(async () => {
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
  for (const [name, make] of Object.entries(PIECES)) {
    if (only && !only.includes(name)) continue;
    manifest[name] = await make();
    console.log(`${name}: ${JSON.stringify(manifest[name])}`);
  }
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
