import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/gameScene/loadGameFonts.js', import.meta.url), 'utf8');
const { loadGameFonts } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('canvas startup waits for both HUD fonts, including a delayed font', async () => {
  const pending = new Map();
  let ready = false;
  const loading = loadGameFonts({ load: name => new Promise(resolve => pending.set(name, resolve)) }).then(() => { ready = true; });
  assert.equal(pending.size, 2);
  pending.get('16px "LilitaOne-Regular"')([]);
  await Promise.resolve();
  assert.equal(ready, false);
  pending.get('16px "Press Start 2P"')([]);
  await loading;
  assert.equal(ready, true);
});

test('a font failure reaches the startup retry path instead of baking fallback text', async () => {
  await assert.rejects(loadGameFonts({ load: async () => { throw new Error('font unavailable'); } }), /font unavailable/);
});
