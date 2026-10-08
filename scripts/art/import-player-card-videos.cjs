// Usage: node scripts/art/import-player-card-videos.cjs <steel.mp4> <royal.mp4>
// Or: node scripts/art/import-player-card-videos.cjs --card <slime-circuit|shuriken-strike> <source.mp4>
// Requires ffmpeg, cwebp and macOS VideoToolbox for the Safari alpha export.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { measurePlayerCardBounds } = require('./player-card-bounds.cjs');
const { stampPlayerCardVersions } = require('./player-card-versions.cjs');
const specs = [
  { id: 'radiant-silver', crf: 30, appleBitrate: '350k' },
  {
    id: 'arena-crown', crf: 42, appleBitrate: '360k',
    appleAlphaQuality: 0.6, appleKeyframeInterval: 192,
    // Royal has no intentional green. Clear compressed screen color left inside
    // the moving cyan outlines without globally shifting gold/cyan hues.
    despillMix: null, clearResidualGreen: true, posterQuality: 92,
    // Trim outer sparks/padding while preserving the card and main crown effects.
    crop: 'crop=400:800:70:80',
    // Same source-coordinate scale as the uncropped catalog viewport.
    viewport: { width: 800, height: 1600, x: 70, y: 170, w: 660, h: 1268 },
  },
];
const additionalSpecs = {
  ...Object.fromEntries(specs.map(card => [card.id, { ...card, preserveGreen: card.id === 'radiant-silver' }])),
  ...Object.fromEntries(require('./new-player-cards.json').map(card => [card.id,
    { appleBitrate: '400k', appleAlphaQuality: 0.8, appleKeyframeInterval: 144, ...card, crf: card.crf ?? 30 }])),
  'slime-circuit': { id: 'slime-circuit', crf: 30, appleBitrate: '500k', preserveGreen: true,
    viewport: { width: 1080, height: 1920, x: 220, y: 310, w: 640, h: 1280 } },
  // This red/steel card has no intentional green. Despill the full frame so
  // dark, compressed screen-green fringe cannot survive a boundary-only key.
  'shuriken-strike': { id: 'shuriken-strike', crf: 30, appleBitrate: '500k',
    viewport: { width: 1080, height: 1920, x: 196, y: 310, w: 688, h: 1290 } },
};
const singleCard = process.argv[2] === '--card';
if (singleCard ? process.argv.length !== 5 || !additionalSpecs[process.argv[3]] : process.argv.length !== 4) {
  throw new Error('Pass steel and royal videos, or --card <slime-circuit|shuriken-strike> <source.mp4>.');
}
// Flood only background-connected green. A global chroma key/despill would
// remove the slime face, gems and circuitry along with the green backdrop.
async function removeExteriorGreen(file) {
  const sharp = require('../../spritesheet-generator/node_modules/sharp');
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const count = width * height;
  const seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0, tail = 0;
  const visit = p => {
    if (seen[p]) return;
    seen[p] = 1;
    const i = p * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.hypot(r - 70, g - 206, b) > 95) return;
    queue[tail++] = p;
    data.fill(0, i, i + 4);
  };
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
  while (head < tail) {
    const p = queue[head++], x = p % width;
    if (x) visit(p - 1);
    if (x + 1 < width) visit(p + 1);
    if (p >= width) visit(p - width);
    if (p + width < count) visit(p + width);
  }
  // Remove the two-pixel compression fringe touching the keyed exterior.
  // Restrict despill to that boundary so enclosed emerald/slime details survive.
  const exterior = new Uint8Array(count);
  for (let p = 0; p < count; p++) exterior[p] = data[p * 4 + 3] === 0 ? 1 : 0;
  for (let p = 0; p < count; p++) {
    const i = p * 4;
    if (!data[i + 3]) continue;
    const x = p % width, y = Math.floor(p / width);
    let edge = false;
    for (let dy = -2; dy <= 2 && !edge; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height && exterior[p + dy * width + dx]) { edge = true; break; }
    }
    if (!edge) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Screen green is yellow-green; emerald/cyan highlights have more blue.
    if (g > r + 20 && g > b + 35 && b < g * 0.45 && r > g * 0.1) data.fill(0, i, i + 4);
  }
  await sharp(data, { raw: info }).png().toFile(`${file}.keyed.png`);
  fs.renameSync(`${file}.keyed.png`, file);
}
async function removeResidualGreen(file) {
  const sharp = require('../../spritesheet-generator/node_modules/sharp');
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (!data[i + 3] || (g > r + 28 && g > b + 30)) data.fill(0, i, i + 4);
  }
  const keyed = `${file}.keyed.png`;
  await sharp(data, { raw: info }).png().toFile(keyed);
  fs.renameSync(keyed, file);
}
const out = path.resolve(__dirname, '../../public/assets/player-cards');
async function main() {
for (const [index, { id, crf, appleBitrate, appleAlphaQuality = 1, appleKeyframeInterval = 24, crop, viewport, preserveGreen, clearResidualGreen, outputWidth = 540, posterQuality, despillMix = 1 }] of
  (singleCard ? [additionalSpecs[process.argv[3]]] : specs).entries()) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-card-'));
  try {
    const webm = path.join(temp, `${id}-animated.webm`);
    const poster = path.join(temp, `${id}-poster.webp`);
    const apple = path.join(temp, `${id}-animated.mov`);
    // Binary key alpha: premultiply clears hidden RGB without darkening visible pixels.
    // Despill first removes green fringe that would bleed back through chroma compression.
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', singleCard ? process.argv[4] : process.argv[index + 2], '-an',
      '-vf', [preserveGreen ? 'format=rgba' : `format=rgba,colorkey=0x46ce00:0.3:0${despillMix == null ? '' : `,despill=green:mix=${despillMix}`}`,
        `scale=${outputWidth}:${outputWidth * 16 / 9}:flags=neighbor`,
        crop, 'premultiply=inplace=1'].filter(Boolean).join(','),
      path.join(temp, '%03d.png')]);
    const frames = fs.readdirSync(temp).filter(f => f.endsWith('.png')).sort();
    if (preserveGreen) for (const frame of frames) await removeExteriorGreen(path.join(temp, frame));
    if (clearResidualGreen) for (const frame of frames) await removeResidualGreen(path.join(temp, frame));
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '24',
      '-i', path.join(temp, '%03d.png'), '-an', '-vf', 'format=yuva420p',
      '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf),
      '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-threads', '2',
      webm]);
    execFileSync('cwebp', ['-quiet', ...(posterQuality == null ? ['-lossless'] : ['-q', String(posterQuality), '-m', '6', '-alpha_q', '100']), path.join(temp, frames[0]), '-o', poster]);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '24',
      '-i', path.join(temp, '%03d.png'), '-an', '-vf', 'format=bgra',
      '-c:v', 'hevc_videotoolbox', '-allow_sw', '1', '-alpha_quality', String(appleAlphaQuality),
      '-bf', '0', '-g', String(appleKeyframeInterval),
      '-b:v', appleBitrate, '-tag:v', 'hvc1',
      '-movflags', '+faststart', apple]);
    // A failed Apple encoder must not truncate an installed animation or leave
    // the three exports out of sync with one another and their catalog sizes.
    const cardOut = path.join(out, id);
    fs.mkdirSync(cardOut, { recursive: true });
    for (const file of [webm, poster, apple]) fs.copyFileSync(file, path.join(cardOut, path.basename(file)));
    const catalogPath = path.resolve(__dirname, '../../src/shared/catalogs/playerCardsCatalog.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const entry = catalog.cards.find(card => card.id === id);
    entry.assetUrl = `/assets/player-cards/${id}/${id}-poster.webp`;
    entry.animationUrl = `/assets/player-cards/${id}/${id}-animated.webm`;
    if (viewport) entry.animationViewport = viewport;
    entry.battleViewport = await measurePlayerCardBounds(poster);
    entry.animationBytes = fs.statSync(path.join(cardOut, `${id}-animated.webm`)).size;
    entry.animationAppleUrl = `/assets/player-cards/${id}/${id}-animated.mov`;
    entry.animationAppleBytes = fs.statSync(path.join(cardOut, `${id}-animated.mov`)).size;
    stampPlayerCardVersions(entry);
    fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
    console.log(`${id}: ${frames.length} frames, ${fs.statSync(path.join(cardOut, `${id}-animated.webm`)).size} bytes`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
