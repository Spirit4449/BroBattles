// Renders a full-arena preview image for each effective map with the game's own
// map and scenery runtime, for the lobby map picker's expand view.
//
//   node scripts/art/render-map-full-previews.cjs [mapId ...]
//
// Publishes metadata.mapFullPreviewAsset through the configured map repository.
// The generated images are stored by content hash in its asset directory.
// Needs Playwright's Chromium (npx playwright-core install chromium) or
// CHROME_EXECUTABLE pointing at an installed Chrome.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const webpack = require('webpack');
const { chromium } = require('playwright-core');
const { mapRepository } = require('../../src/server/services/maps/mapRepository');
const { storeImmutableAsset } = require('../../src/server/services/maps/mapAssetFiles');
const { mapArena } = require('../../src/shared/maps/arenas');

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
  const compiler = webpack(config);
  return new Promise((resolve, reject) => compiler.run((error, stats) => {
    compiler.close(closeError => {
      if (error || closeError) return reject(error || closeError);
      if (stats.hasErrors()) return reject(new Error(stats.toString('errors-only')));
      resolve();
    });
  }));
}

async function main() {
  let browser;
  let server;
  try {
    await bundle();
    const app = express();
    let current = null;
    app.get('/', (_req, res) => res.type('html').send(
      '<!doctype html><style>html,body{margin:0;overflow:hidden;background:#111d29}</style><div id="game"></div>'
      + `<script>window.__SNAPSHOT_MAP__=${JSON.stringify(current).replaceAll('<', '\\u003c')}</script><script src="/snapshot.js"></script>`));
    app.get('/snapshot.js', (_req, res) => res.sendFile(path.join(outDir, 'snapshot.js')));
    app.use('/assets/map-revisions', express.static(path.resolve(mapRepository.directory, 'assets/revisions')));
    app.use('/assets', express.static(path.join(root, 'public/assets')));
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
      listener.once('error', reject);
    });
    const port = server.address().port;
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });

    const ids = process.argv.length > 2 ? process.argv.slice(2) : mapRepository.mapIds();
    for (const id of ids) {
      const { document, revision } = mapRepository.get(id);
      current = document;
      const { camera } = mapArena(document);
      const height = Math.round(OUTPUT_WIDTH * camera.height / camera.width);
      const page = await browser.newPage({ viewport: { width: OUTPUT_WIDTH, height } });
      try {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${port}/`);
        await page.waitForFunction(() => window.__snapshotReady, null, { timeout: 30000 }).catch(() => {
          throw new Error(`Map ${id} did not render: ${errors.join('; ') || 'timed out'}`);
        });
        const dataUrl = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/webp', 0.86));
        const prefix = 'data:image/webp;base64,';
        if (!dataUrl.startsWith(prefix)) throw new Error(`Map ${id} did not produce a WebP preview`);
        const bytes = Buffer.from(dataUrl.slice(prefix.length), 'base64');
        const url = storeImmutableAsset(bytes, '.webp', mapRepository.directory);
        if (document.metadata.mapFullPreviewAsset !== url) {
          document.metadata.mapFullPreviewAsset = url;
          mapRepository.save(document, revision);
        }
        console.log(`${document.label}: ${url} (${OUTPUT_WIDTH}x${height})`);
      } finally {
        await page.close();
      }
    }
  } finally {
    try {
      await browser?.close();
    } finally {
      try {
        if (server?.listening) await new Promise(resolve => server.close(resolve));
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
