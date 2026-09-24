const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const webpack = require('webpack');
const devMiddleware = require('webpack-dev-middleware');
const { isolateDevAssetResponse } = require('../src/server/helpers/devAssetMiddleware');

test('warmed development bundles revalidate without a body and rebuilds invalidate the ETag', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-cache-'));
  let middleware, server;
  try {
    const entry = path.join(directory, 'entry.js');
    await fs.writeFile(entry, 'window.buildVersion = 1;');
    const compiler = webpack({ mode: 'development', devtool: false, context: directory,
      entry, output: { path: path.join(directory, 'dist'), filename: 'game.js', publicPath: '/' } });
    const options = require('../webpack.config')({}, { mode: 'development' }).devServer.devMiddleware;
    middleware = devMiddleware(compiler, { ...options, stats: 'errors-only' });
    const app = express();
    app.use(isolateDevAssetResponse(middleware));
    const fallthrough = [];
    const errors = [];
    app.use((req, res, next) => { fallthrough.push(req.path); next(); });
    // Match production's development chain: a second static handler sees the
    // same filename if webpack accidentally forwards a completed response.
    await fs.writeFile(path.join(directory, 'game.js'), 'wrong fallback');
    await fs.writeFile(path.join(directory, 'public-only.txt'), 'public fallback');
    app.use(express.static(directory));
    app.use((_req, res) => res.status(404).send('missing'));
    app.use((error, _req, res, _next) => {
      errors.push(error);
      if (!res.headersSent) res.status(500).end();
    });
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const url = `http://127.0.0.1:${server.address().port}/game.js`;
    const first = await fetch(url);
    const tag = first.headers.get('etag');
    assert.equal(first.status, 200);
    assert.ok(tag);
    assert.match(first.headers.get('cache-control'), /max-age=0.*must-revalidate/);
    assert.match(await first.text(), /buildVersion = 1/);
    // Node fetch adds no-cache with conditional headers unless overridden.
    const headers = { 'If-None-Match': tag, 'Cache-Control': 'max-age=0' };
    const repeat = await fetch(url, { headers });
    assert.equal(repeat.status, 304);
    assert.equal(await repeat.text(), '');
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const failedPrecondition = await fetch(url, { headers: { 'If-Match': '"stale"' } });
    assert.equal(failedPrecondition.status, 412);
    await failedPrecondition.text();
    const range = await fetch(url, { headers: { Range: 'bytes=0-9' } });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 10);
    const publicOnly = await fetch(url.replace('game.js', 'public-only.txt'));
    assert.equal(await publicOnly.text(), 'public fallback');
    const missing = await fetch(url.replace('game.js', 'missing.txt'));
    assert.equal(missing.status, 404);
    await missing.text();
    const rebuilt = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('changed bundle was not rebuilt')), 10000);
      compiler.hooks.done.tap('WaitForChangedAsset', stats => {
        const source = compiler.outputFileSystem.readFileSync(path.join(directory, 'dist', 'game.js'), 'utf8');
        if (!source?.includes('buildVersion = 2')) return;
        clearTimeout(timeout);
        resolve();
      });
    });
    await fs.writeFile(entry, 'window.buildVersion = 2;');
    await rebuilt;
    const changed = await fetch(url, { headers });
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.get('etag'), tag);
    assert.match(await changed.text(), /buildVersion = 2/);
    assert.deepEqual(fallthrough, ['/public-only.txt', '/missing.txt']);
    assert.deepEqual(errors, []);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (middleware) await new Promise(resolve => middleware.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
