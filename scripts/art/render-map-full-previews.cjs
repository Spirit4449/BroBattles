// Renders a full-arena preview image for each saved map with the game's own
// map and scenery runtime, for the lobby map picker's expand view.
//
//   node scripts/art/render-map-full-previews.cjs [mapId ...]
//
// Reads data/maps/<id>.json (saved maps override src/shared/maps at runtime),
// writes public/assets/<folder>/full-preview.webp and records it as
// metadata.mapFullPreviewAsset in both the saved and the default document.
// Needs Playwright's Chromium (npx playwright-core install chromium) or
// CHROME_EXECUTABLE pointing at an installed Chrome.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const webpack = require('webpack');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '../..');
const OUTPUT_WIDTH = 1920;
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-map-preview-'));

function bundle() {
  const base = require(path.join(root, 'webpack.config.js'))({}, { mode: 'development' });
  const config = {
    mode: 'development', devtool: false, context: root,
    entry: path.join(__dirname, 'map-full-preview/entry.js'),
    output: { path: outDir, filename: 'snapshot.js' },
    module: { rules: base.module.rules.filter(rule => !String(rule.test).includes('css')) },
    resolve: base.resolve,
  };
  return new Promise((resolve, reject) => webpack(config, (error, stats) => {
    if (error || stats.hasErrors()) return reject(error || new Error(stats.toString('errors-only')));
    resolve();
  }));
}

const mapIds = () => {
  const args = process.argv.slice(2);
  if (args.length) return args;
  return fs.readdirSync(path.join(root, 'data/maps')).filter(f => /^\d+\.json$/.test(f)).map(f => f.replace('.json', ''));
};

// The map's own art folder: where its select preview (or first asset) lives.
function assetFolder(map) {
  const url = map.metadata?.mapSelectPreviewAsset || Object.values(map.assets || {})[0]?.url;
  const match = /^\/assets\/([^/]+)\//.exec(url || '');
  if (!match) throw new Error(`Map ${map.id}: cannot tell which /assets folder it uses`);
  return match[1];
}

function recordAsset(file, url) {
  if (!fs.existsSync(file)) return;
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (doc.metadata?.mapFullPreviewAsset === url) return;
  doc.metadata = { ...doc.metadata, mapFullPreviewAsset: url };
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
}

(async () => {
  await bundle();
  const app = express();
  let current = null;
  app.get('/', (_req, res) => res.type('html').send(
    `<!doctype html><style>html,body{margin:0;overflow:hidden;background:#111d29}</style><div id="game"></div>`
    + `<script>window.__SNAPSHOT_MAP__=${JSON.stringify(current)}</script><script src="/snapshot.js"></script>`));
  app.get('/snapshot.js', (_req, res) => res.sendFile(path.join(outDir, 'snapshot.js')));
  app.use('/assets/map-revisions', express.static(path.join(root, 'data/maps/assets/revisions')));
  app.use('/assets', express.static(path.join(root, 'public/assets')));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  try {
    for (const id of mapIds()) {
      current = JSON.parse(fs.readFileSync(path.join(root, `data/maps/${id}.json`), 'utf8'));
      const { camera } = require(path.join(root, 'src/shared/maps/arenas.js')).mapArena(current);
      const height = Math.round(OUTPUT_WIDTH * camera.height / camera.width);
      const page = await browser.newPage({ viewport: { width: OUTPUT_WIDTH, height } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForFunction(() => window.__snapshotReady, null, { timeout: 30000 }).catch(() => {
        throw new Error(`Map ${id} did not render: ${errors.join('; ') || 'timed out'}`);
      });
      const dataUrl = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/webp', 0.86));
      await page.close();
      const folder = assetFolder(current);
      const url = `/assets/${folder}/full-preview.webp`;
      const target = path.join(root, 'public', url);
      fs.writeFileSync(target, Buffer.from(dataUrl.split(',')[1], 'base64'));
      recordAsset(path.join(root, `data/maps/${id}.json`), url);
      recordAsset(path.join(root, `src/shared/maps/${id}.json`), url);
      console.log(`${current.label}: ${path.relative(root, target)} (${OUTPUT_WIDTH}x${height})`);
    }
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
