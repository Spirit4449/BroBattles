// Run npm run build before starting this smoke test.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright-core');
const map = require('../../src/shared/maps/1.json');
const { API_PATHS } = require('../../src/shared/net/apiPaths');

const dist = path.resolve(__dirname, '../../dist');
const origin = 'http://localhost:16588';
const timeout = 10_000;
const contentTypes = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg',
};

async function main() {
  await fs.access(path.join(dist, 'map-editor.html'));
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : { channel: 'chrome' }),
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    const requests = [];
    const playtestPayloads = [];
    let published = { document: map, revision: "fixture" };
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      const method = request.method();
      const pathname = url.pathname;
      requests.push(`${method} ${pathname}`);
      if (pathname === API_PATHS.API_ADMIN_MAPS) return route.fulfill({ json: { maps: [map] } });
      if (pathname === `${API_PATHS.API_ADMIN_MAPS}/${map.id}`) {
        if (method === 'PUT') {
          const { document, revision } = request.postDataJSON();
          if (revision !== published.revision) return route.fulfill({ status: 409, json: { error: 'Stale revision' } });
          published = { document, revision: 'fixture-edited' };
        }
        return route.fulfill({ json: published });
      }
      if (pathname === API_PATHS.API_ADMIN_MAP_PLAYTESTS && method === 'POST') {
        playtestPayloads.push(request.postDataJSON());
        return route.fulfill({ json: { session: 'fixture-session', matchId: 123 } });
      }
      if (pathname === `${API_PATHS.API_ADMIN_MAP_PLAYTESTS}/fixture-session` && method === 'DELETE') {
        return route.fulfill({ json: {} });
      }
      if (pathname === '/map-editor/playtest' && url.search === '?session=fixture-session&match=123') {
        return route.fulfill({
          contentType: 'text/html',
          body: '<title>Fixture playtest</title><button onclick="parent.postMessage({type:\'bb-map-playtest-exit\'}, location.origin)">Return to editor</button>',
        });
      }
      if (pathname.startsWith('/api/')) return route.fulfill({ json: {} });
      const file = path.join(dist, pathname === '/map-editor' ? 'map-editor.html' : pathname);
      try {
        const body = await fs.readFile(file);
        return route.fulfill({ body, contentType: contentTypes[path.extname(file)] });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return route.fulfill({ status: 404 });
      }
    });
    await page.goto(`${origin}/map-editor?variant=2v2`);
    await page.locator('#canvas canvas').waitFor({ timeout });
    await page.locator('[data-tab="world"]').click({ timeout });
    const label = page.getByLabel('Map name', { exact: true });
    const edited = 'Fixture edited in Map Studio';
    await label.fill(edited);
    await label.press('Tab');
    await page.locator('#save').click({ timeout });
    await page.locator('#save-state').filter({ hasText: /^Saved$/ }).waitFor({ timeout });
    assert.equal(published.document.label, edited);
    await page.reload();
    await page.locator('#canvas canvas').waitFor({ timeout });
    await page.locator('[data-tab="world"]').click({ timeout });
    assert.equal(await label.inputValue(), edited);
    await page.locator('#undo').click({ timeout });
    await page.getByRole('heading', { name: map.label, exact: true }).waitFor({ timeout });
    assert.equal(await label.inputValue(), map.label);
    await page.locator('#redo').click({ timeout });
    await page.getByRole('heading', { name: edited, exact: true }).waitFor({ timeout });
    assert.equal(await label.inputValue(), edited);
    await page.locator('#preview').click({ timeout });
    const frame = page.frameLocator('#playtest-frame');
    const deleteRequest = page.waitForRequest(request =>
      request.method() === 'DELETE' &&
      request.url() === `${origin}${API_PATHS.API_ADMIN_MAP_PLAYTESTS}/fixture-session`, { timeout });
    await Promise.all([
      deleteRequest,
      frame.getByRole('button', { name: 'Return to editor' }).click({ timeout }),
    ]);
    await page.locator('#playtest-frame').waitFor({ state: 'detached', timeout });
    assert.deepEqual(errors, []);
    assert.equal(playtestPayloads.length, 1);
    assert.equal(playtestPayloads[0].document.id, map.id);
    assert.equal(playtestPayloads[0].modeVariantId, 'duels-2v2');
    assert.ok(requests.some(request => /^GET \/bundles\/phaser-arcade-physics\.min\.[a-f0-9]{16}\.js$/.test(request)),
      'Map Studio loaded the shared versioned Phaser bundle');
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('preview')), false);
    console.log('Map Studio browser checks passed: saved undo/redo after reload, editor canvas, 2v2 playtest launch, iframe exit, and session deletion.');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
