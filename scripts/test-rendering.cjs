// Requires Playwright and its browser binaries; no game server/database needed.
// NODE_PATH may point at an existing Playwright installation.
// CHROME_EXECUTABLE optionally selects an installed Chrome.
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<script src="/node_modules/phaser/dist/phaser.js"></script><script type="module" src="/tests/browser/renderingSmoke.js"></script>');
    return;
  }
  if (url === '/slow.mp3') {
    setTimeout(() => { res.setHeader('Content-Type', 'audio/mpeg'); res.end(fs.readFileSync(path.join(root, 'public/assets/movement/jump.mp3'))); }, 1200);
    return;
  }
  let file = path.join(root, url);
  if (!path.extname(file)) file += '.js';
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.webp') ? 'image/webp' : 'application/json');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch({ headless: true,
        ...(name === 'chromium' && process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}),
      });
      try {
        for (const renderer of ['webgl', 'canvas', 'fallback']) {
          const page = await browser.newPage();
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          if (renderer === 'fallback') await page.addInitScript(() => {
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (type, ...args) {
              return type.includes('webgl') ? null : original.call(this, type, ...args);
            };
          });
          await page.goto(`http://127.0.0.1:${server.address().port}/?renderer=${renderer}`);
          await page.waitForFunction(() => window.results || window.testError);
          assert.equal(await page.evaluate(() => window.testError), undefined);
          const result = await page.evaluate(() => window.results);
          assert.deepEqual(errors, []);
          assert.equal(result.type, renderer === 'webgl' ? 2 : 1);
          assert.ok(result.createdBeforeAudio && result.earlySoundSkipped && result.audioEventuallyLoaded && result.failedSoundSkipped);
          for (const sample of result.samples) {
            assert.deepEqual(sample.size, [Math.round(400 * sample.scale), Math.round(200 * sample.scale)]);
            assert.deepEqual(sample.logical, [400, 200]);
            assert.deepEqual(sample.center, [255, 0, 0, 255]);
            assert.deepEqual(sample.corner, [255, 255, 0, 255]);
            assert.deepEqual(sample.generated, [0, 255, 0, 255]);
            assert.deepEqual(sample.transparent, [0, 0, 0, 0]);
            assert.deepEqual(sample.mask, [0, 0, 255, 255]);
            assert.deepEqual(sample.outsideMask, [0, 0, 0, 0]);
            if (renderer === 'webgl') {
              assert.equal(sample.glError, 0);
              assert.deepEqual(sample.renderTexture, [0, 255, 255, 255]);
            }
          }
          assert.deepEqual(result.worldPoints[0], result.worldPoints[1]);
          assert.deepEqual(result.resize, [1000, 500]);
          console.log(`PASS ${name} ${renderer}: pixels, masks, generated textures, quality changes, camera coordinates, resizing, delayed/failed audio, teardown`);
          await page.close();
        }
      } finally { await browser.close(); }
    }
  } finally { server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
