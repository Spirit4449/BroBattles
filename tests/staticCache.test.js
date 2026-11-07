const test = require('node:test');
const assert = require('node:assert/strict');
const { setStaticCacheHeaders } = require('../src/server/middleware/staticCache');

test('only content-addressed JS and CSS get immutable caching', () => {
  for (const [file, expected] of [
    ['/dist/bundles/game.bundle.0123456789abcdef.js', 'public, max-age=31536000, immutable'],
    ['/dist/bundles/index.0123456789abcdef.css', 'public, max-age=31536000, immutable'],
    ['/dist/bundles/game.bundle.js', 'public, max-age=0'],
    ['/dist/bundles/mode-bank-bust.js', 'public, max-age=0'],
    ['/dist/game.html', 'public, max-age=0'],
    ['/dist/battle-preload.json', 'public, max-age=0'],
    ['/dist/assets/ninja/spritesheet.webp', 'public, max-age=0'],
    [`/dist/assets/map-revisions/${'a'.repeat(64)}.webp`, 'public, max-age=31536000, immutable'],
    [`/dist/assets/map-revisions/${'b'.repeat(64)}.json`, 'public, max-age=31536000, immutable'],
    ['/dist/assets/map-revisions/current.webp', 'public, max-age=0'],
  ]) {
    let header;
    setStaticCacheHeaders({ setHeader: (name, value) => { assert.equal(name, 'Cache-Control'); header = value; } }, file);
    assert.equal(header, expected, file);
  }
});

test('card animations are immutable only when the requested version matches their bytes', () => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const crypto = require('node:crypto');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'card-cache-'));
  const file = path.join(root, 'assets/player-cards/test/test-animated.webm');
  const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
  const headerFor = version => {
    let result;
    setStaticCacheHeaders({ req: { originalUrl: `/assets/player-cards/test/test-animated.webm?v=${version}` },
      setHeader: (_, value) => { result = value; } }, file, fs.statSync(file));
    return result;
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'old video');
    assert.match(headerFor(hash('old video')), /immutable/);
    assert.equal(headerFor('unknown'), 'public, max-age=0');
    assert.equal(headerFor(hash('other')), 'public, max-age=0');
    fs.writeFileSync(file, 'replacement video');
    assert.equal(headerFor(hash('old video')), 'public, max-age=0');
    assert.match(headerFor(hash('replacement video')), /immutable/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('HTTP compresses text, negotiates identity and leaves event streams unbuffered', async t => {
  const http = require('node:http'), express = require('express');
  const { gunzipSync } = require('node:zlib');
  const app = express();
  app.use(require('../src/server/middleware/httpCompression'));
  const body = 'const example = "hello world";\n'.repeat(1000);
  app.get('/bundle.js', (_, res) => res.type('js').send(body));
  app.get('/events', (_, res) => res.type('text/event-stream').send(body));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  async function get(path, encoding) {
    return new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: server.address().port, path,
        headers: { 'Accept-Encoding': encoding } }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      }).on('error', reject);
    });
  }
  const gzip = await get('/bundle.js', 'gzip');
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.match(gzip.headers.vary, /Accept-Encoding/);
  assert.equal(gunzipSync(gzip.body).toString(), body);
  assert.ok(gzip.body.length < Buffer.byteLength(body));
  const identity = await get('/bundle.js', 'identity');
  assert.equal(identity.headers['content-encoding'], undefined);
  assert.equal(identity.body.toString(), body);
  assert.equal((await get('/events', 'gzip')).headers['content-encoding'], undefined);
});
