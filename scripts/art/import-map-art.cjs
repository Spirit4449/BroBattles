// Imports a map's layered art export into the game and wires it into the map.
// Usage: node scripts/art/import-map-art.cjs <map id> <export dir> [--clouds] [--scale 0.5]
//
// The export is full-canvas PNGs from the art file, all the same size:
//   [Layer0]_Background.png, [Layer1]_Peaks.png …  scenery layers, back to front
//   [LayerN]_Platforms/*.png                         platform artwork
//   [LayerN]_Clouds/*.png                            clouds (with --clouds, added
//                                                    to the shared cloud library)
// Each image is trimmed to its visible pixels, scaled (default 0.5) and saved as
// WebP under the folder the map's art already uses (or /assets/<map key>/).
// Layers keep their place in the shared canvas (`frame`), so the composition
// matches the art file. A layer's `blur` (px) is baked into its image here; the
// game never blurs at runtime. Re-running updates art in place: layers and
// platforms already in the map (matched by file) keep their settings.
// It also flattens every layer into lobby-background.webp for the lobby.
//
// Nothing here is required: art can be dropped into public/assets by hand and
// wired up in Map Studio's Scenery tab or the map JSON. Needs cwebp/dwebp
// (brew install webp).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync: run } = require('node:child_process');
const { MapRepository } = require('../../src/server/services/maps/mapRepository');

const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const [mapId, exportDir] = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--scale');
if (!Number(mapId) || !exportDir) {
  console.error('Usage: node scripts/art/import-map-art.cjs <map id> <export dir> [--clouds] [--scale 0.5]');
  process.exit(1);
}
const SCALE = Number(option('--scale', 0.5));
// Alpha at or below this is treated as empty when trimming (export haze).
const ALPHA_FLOOR = 40;
// Starting look for new layers, by distance: the farthest layer is sky, the
// rest fade from far (more fog and blur, slower) to near.
const FAR = { scroll: 0.1, fog: 0.5, blur: 2 }, NEAR = { scroll: 0.3, fog: 0.2, blur: 0 };

const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'map-art-'));

function readImage(file) {
  run('cwebp', ['-quiet', '-lossless', file, '-o', `${tmp}/in.webp`]);
  run('dwebp', ['-quiet', '-pam', `${tmp}/in.webp`, '-o', `${tmp}/in.pam`]);
  const b = fs.readFileSync(`${tmp}/in.pam`), end = b.indexOf('ENDHDR\n');
  const head = b.subarray(0, end).toString();
  return { w: +head.match(/WIDTH (\d+)/)[1], h: +head.match(/HEIGHT (\d+)/)[1], data: Buffer.from(b.subarray(end + 7)) };
}
function writeWebp({ w, h, data }, file) {
  const header = `P7\nWIDTH ${w}\nHEIGHT ${h}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`;
  fs.writeFileSync(`${tmp}/out.pam`, Buffer.concat([Buffer.from(header), data]));
  run('cwebp', ['-quiet', '-q', '90', '-alpha_q', '100', '-m', '6', `${tmp}/out.pam`, '-o', file]);
}
function opaqueBounds({ w, h, data }) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] <= ALPHA_FLOOR) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) throw new Error('image is empty');
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
// Trimmed and scaled copy of a source PNG.
function trimmed(file) {
  const image = readImage(file), crop = opaqueBounds(image);
  const width = Math.max(1, Math.round(crop.w * SCALE)), height = Math.max(1, Math.round(crop.h * SCALE));
  run('cwebp', ['-quiet', '-lossless', '-crop', String(crop.x), String(crop.y), String(crop.w), String(crop.h),
    '-resize', String(width), String(height), file, '-o', `${tmp}/scaled.webp`]);
  run('dwebp', ['-quiet', '-pam', `${tmp}/scaled.webp`, '-o', `${tmp}/scaled.pam`]);
  const b = fs.readFileSync(`${tmp}/scaled.pam`);
  return { canvas: { w: image.w, h: image.h }, crop, image: { w: width, h: height, data: Buffer.from(b.subarray(b.indexOf('ENDHDR\n') + 7)) } };
}
// Separable Gaussian blur on premultiplied colour, so transparent pixels do not
// bleed dark fringes; edges clamp.
function gaussianBlur({ w, h, data }, sigma) {
  const r = Math.ceil(sigma * 3), kernel = [];
  for (let i = -r; i <= r; i++) kernel.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  const k = kernel.map((v) => v / sum), size = w * h * 4;
  let src = new Float32Array(size), dst = new Float32Array(size);
  for (let i = 0; i < size; i += 4) {
    const a = data[i + 3] / 255;
    src[i] = data[i] * a; src[i + 1] = data[i + 1] * a; src[i + 2] = data[i + 2] * a; src[i + 3] = data[i + 3];
  }
  for (const [lines, length, at] of [[h, w, (line, p) => (line * w + p) * 4], [w, h, (line, p) => (p * w + line) * 4]]) {
    for (let line = 0; line < lines; line++) for (let p = 0; p < length; p++) {
      const out = at(line, p);
      for (let c = 0; c < 4; c++) {
        let v = 0;
        for (let i = -r; i <= r; i++) v += k[i + r] * src[at(line, Math.min(length - 1, Math.max(0, p + i))) + c];
        dst[out + c] = v;
      }
    }
    [src, dst] = [dst, src];
  }
  for (let i = 0; i < size; i += 4) {
    const a = src[i + 3], un = a > 0 ? 255 / a : 0;
    data[i] = src[i] * un; data[i + 1] = src[i + 1] * un; data[i + 2] = src[i + 2] * un; data[i + 3] = a;
  }
}
// Source-over blend of `layer` onto `canvas` at (x, y).
function blend(canvas, layer, x, y) {
  for (let ly = 0; ly < layer.h; ly++) {
    const cy = y + ly; if (cy < 0 || cy >= canvas.h) continue;
    for (let lx = 0; lx < layer.w; lx++) {
      const cx = x + lx; if (cx < 0 || cx >= canvas.w) continue;
      const s = (ly * layer.w + lx) * 4, d = (cy * canvas.w + cx) * 4, a = layer.data[s + 3] / 255;
      for (let c = 0; c < 3; c++) canvas.data[d + c] = Math.round(layer.data[s + c] * a + canvas.data[d + c] * (1 - a));
      canvas.data[d + 3] = 255;
    }
  }
}

const source = path.resolve(exportDir);
const entries = fs.readdirSync(source).map((name) => ({ name, match: name.match(/^\[Layer(\d+)\]_(.+?)(\.png)?$/i) }))
  .filter((e) => e.match).map((e) => ({ file: path.join(source, e.name), n: Number(e.match[1]), title: e.match[2], folder: !e.match[3] }))
  .sort((a, b) => a.n - b.n || a.title.localeCompare(b.title));
const layerFiles = entries.filter((e) => !e.folder);
const platformDir = entries.find((e) => e.folder && /platform/i.test(e.title));
const cloudDir = entries.find((e) => e.folder && /cloud/i.test(e.title));
if (!layerFiles.length) throw new Error(`No [LayerN]_Name.png files in ${source}`);

const repo = new MapRepository();
const { document, revision } = repo.get(Number(mapId));
const doc = JSON.parse(JSON.stringify(document));
const assetDir = doc.scenery.layers.map((l) => l.url.match(/^\/assets\/([^/]+)\//)?.[1]).find((dir) => dir && dir !== 'map-revisions')
  || doc.metadata.key;
const publicDir = path.join(root, 'public/assets', assetDir);
fs.mkdirSync(publicDir, { recursive: true });
const urlFor = (name) => `/assets/${assetDir}/${name}.webp`;

try {
  // Scenery layers.
  const lastBack = Math.max(...layerFiles.filter((e) => !platformDir || e.n < platformDir.n).map((e) => e.n));
  const frames = [];
  let shared = null;
  layerFiles.forEach((entry, i) => {
    const name = kebab(entry.title), url = urlFor(name);
    const { canvas, crop, image } = trimmed(entry.file);
    shared ||= canvas;
    let frame = { width: Math.round(canvas.w * SCALE), height: Math.round(canvas.h * SCALE), x: Math.round(crop.x * SCALE), y: Math.round(crop.y * SCALE) };
    let layer = doc.scenery.layers.find((l) => l.url === url);
    // A layer exported on a different canvas cannot be placed from it; an
    // existing placement (often fixed by hand) is kept.
    if (canvas.w !== shared.w || canvas.h !== shared.h) {
      console.warn(`warning: ${path.basename(entry.file)} is ${canvas.w}x${canvas.h}, not ${shared.w}x${shared.h} like the first layer. Check its placement in Map Studio.`);
      if (layer?.frame) frame = layer.frame;
    }
    if (!layer) {
      const near = entry.n > lastBack;
      const t = lastBack > 0 ? Math.min(1, Math.max(0, (entry.n - 1) / Math.max(1, lastBack - 1))) : 1;
      const mix = (key) => Math.round((FAR[key] + (NEAR[key] - FAR[key]) * t) * 100) / 100;
      layer = i === 0 ? { id: name, url, scroll: 0.03, fit: 'cover', blur: 1 }
        : near ? { id: name, url, scroll: 1, fit: 'cover-x', stack: 'front' }
          : { id: name, url, scroll: mix('scroll'), fit: 'cover-x', fog: mix('fog'), ...(mix('blur') > 0 ? { blur: mix('blur') } : {}) };
      while (doc.scenery.layers.some((l) => l.id === layer.id)) layer.id += '-layer';
      // Back to front by layer number.
      const before = doc.scenery.layers.findIndex((l) => (layerFiles.find((e) => urlFor(kebab(e.title)) === l.url)?.n ?? -1) > entry.n);
      doc.scenery.layers.splice(before < 0 ? doc.scenery.layers.length : before, 0, layer);
      layer.frame = frame;
    } else if (layer.frame) layer.frame = frame;
    if (layer.blur > 0) gaussianBlur(image, layer.blur);
    writeWebp(image, path.join(publicDir, `${name}.webp`));
    frames.push({ image, frame });
    console.log(`layer ${layer.id}: ${name}.webp ${image.w}x${image.h}${layer.blur > 0 ? ` blur ${layer.blur}` : ''}`);
  });

  // Platform artwork: matched by file; a changed size rescales its platforms so
  // they keep their size in the world.
  if (platformDir) {
    for (const file of fs.readdirSync(platformDir.file).filter((f) => /\.png$/i.test(f)).sort()) {
      const name = kebab(file.replace(/\.png$/i, '')).replace(/(^|-)platform(-|$)/, '$1$2').replace(/^-|-$/g, '') || 'platform';
      const url = urlFor(`platform-${name}`);
      const { image } = trimmed(path.join(platformDir.file, file));
      writeWebp(image, path.join(root, 'public', url));
      let key = Object.keys(doc.assets).find((k) => doc.assets[k].url === url);
      if (!key) {
        key = `${doc.metadata.key}-${name}`;
        doc.assets[key] = { type: 'image', url };
      }
      const old = doc.textureSizes[key];
      if (old && (old.width !== image.w || old.height !== image.h)) {
        for (const p of doc.layout.platforms.filter((p) => p.textureKey === key)) {
          p.scaleX *= old.width / image.w; p.scaleY *= old.height / image.h;
          if (p.body) { p.body.offsetX = (p.body.offsetX || 0) * image.w / old.width; p.body.offsetY = (p.body.offsetY || 0) * image.h / old.height; }
        }
      }
      doc.textureSizes[key] = { width: image.w, height: image.h };
      console.log(`platform art ${key}: ${url} ${image.w}x${image.h}`);
    }
  }

  // Clouds join the shared library every map can use.
  if (cloudDir && flag('--clouds')) {
    const libraryFile = path.join(root, 'src/shared/maps/clouds.json');
    const library = JSON.parse(fs.readFileSync(libraryFile, 'utf8'));
    fs.mkdirSync(path.join(root, 'public/assets/clouds'), { recursive: true });
    for (const file of fs.readdirSync(cloudDir.file).filter((f) => /\.png$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      const type = `${doc.metadata.key}-${kebab(file.replace(/\.png$/i, ''))}`;
      const { image } = trimmed(path.join(cloudDir.file, file));
      writeWebp(image, path.join(root, 'public/assets/clouds', `${type}.webp`));
      library[type] = `/assets/clouds/${type}.webp`;
      console.log(`cloud ${type}`);
    }
    fs.writeFileSync(libraryFile, JSON.stringify(library, null, 2) + '\n');
  }

  // Lobby backdrop: every layer flattened in place on the shared canvas.
  const { width, height } = frames[0].frame;
  // Frames are in the first layer's canvas; a layer framed in another is drawn at its own offset.
  const lobby = { w: width, h: height, data: Buffer.alloc(width * height * 4) };
  for (const { image, frame } of frames) blend(lobby, image, frame.x, frame.y);
  writeWebp(lobby, path.join(publicDir, 'lobby-background.webp'));
  doc.metadata.lobbyBgAsset = doc.metadata.mapSelectPreviewAsset = urlFor('lobby-background');
  console.log(`lobby-background.webp ${width}x${height}`);

  // Save like Map Studio does (validation, history), and keep a built-in copy in step.
  const saved = repo.save(doc, revision);
  const builtIn = path.join(root, 'src/shared/maps', `${doc.id}.json`);
  if (fs.existsSync(builtIn)) fs.writeFileSync(builtIn, JSON.stringify(saved.document, null, 2) + '\n');
  console.log(`Saved map ${doc.id}${fs.existsSync(builtIn) ? ' (and its built-in copy)' : ''}. Reload Map Studio to see it.`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
