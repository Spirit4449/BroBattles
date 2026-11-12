#!/usr/bin/env node
// Writes a small `portrait.webp` beside every character/skin `body.webp`.
// The client inlines these into its bundles (see src/client/views/
// bodyPortraitAssets.js), so they must stay small: full-size bodies added
// ~2.5 MB of base64 to each of the lobby, game and profile bundles.
//
// Usage: node scripts/art/build-portraits.cjs   (needs ffmpeg and cwebp)
// `npm run validate:content` reports portraits whose source body changed.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const ASSETS = path.join(ROOT, 'public/assets');
const MANIFEST = path.join(ROOT, 'src/client/views/portraitSources.json');
// Largest display is 280 CSS px; 448 keeps retina screens sharp.
const SIZE = 448;

function bodySources() {
  const found = [];
  for (const character of fs.readdirSync(ASSETS)) {
    const dir = path.join(ASSETS, character);
    if (fs.existsSync(path.join(dir, 'body.webp'))) found.push(path.join(dir, 'body.webp'));
    const skins = path.join(dir, 'skins');
    if (!fs.existsSync(skins)) continue;
    for (const skin of fs.readdirSync(skins)) {
      const body = path.join(skins, skin, 'body.webp');
      if (fs.existsSync(body)) found.push(body);
    }
  }
  return found.sort();
}

function sourceHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

const publicUrl = file => '/' + path.relative(path.join(ROOT, 'public'), file).split(path.sep).join('/');

function buildPortraits() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-portraits-'));
  const manifest = {};
  try {
    for (const body of bodySources()) {
      const png = path.join(temp, 'scaled.png');
      const out = path.join(path.dirname(body), 'portrait.webp');
      // Nearest-neighbour keeps the pixel-art edges hard.
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', body,
        '-vf', `scale=${SIZE}:${SIZE}:flags=neighbor`, png]);
      execFileSync('cwebp', ['-quiet', '-q', '92', '-sharp_yuv', '-alpha_q', '100', '-m', '6', png, '-o', out]);
      // Some bodies already compress below a lossy portrait; keep those as-is.
      if (fs.statSync(out).size >= fs.statSync(body).size) fs.copyFileSync(body, out);
      manifest[publicUrl(body)] = sourceHash(body);
      console.log(`${publicUrl(out)}  ${fs.statSync(body).size} -> ${fs.statSync(out).size} bytes`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}

// Errors for missing or stale portraits, used by validate-content.
function portraitErrors() {
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
  const errors = [];
  for (const body of bodySources()) {
    const url = publicUrl(body);
    if (!fs.existsSync(path.join(path.dirname(body), 'portrait.webp'))) errors.push(`${url}: missing portrait.webp`);
    else if (manifest[url] !== sourceHash(body)) errors.push(`${url}: portrait.webp is stale`);
  }
  return errors.map(error => `${error}; run node scripts/art/build-portraits.cjs`);
}

if (require.main === module) buildPortraits();

module.exports = { portraitErrors };
