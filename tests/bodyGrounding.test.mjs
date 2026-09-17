import test from 'node:test';
import assert from 'node:assert/strict';
import { platformSurfaceOffset, refreshPlatformGrounding } from '../src/lobby/platformGrounding.mjs';
import { buildBroPortraitSvg, BRO_PORTRAIT_PALETTES } from '../src/lib/broPortrait.mjs';

test('square body bottom meets the shared frame interior edge', () => {
  const svg = buildBroPortraitSvg('body.webp', BRO_PORTRAIT_PALETTES.ninja);
  const image = svg.match(/<image [^>]+>/)[0];
  const y = Number(image.match(/ y="([\d.]+)"/)[1]);
  const height = Number(image.match(/ height="([\d.]+)"/)[1]);
  assert.equal(y + height, 250);
  assert.match(image, /preserveAspectRatio="xMidYMax meet"/);
});

test('platform surface offset follows rendered width for every built-in map', () => {
  for (const [map, y] of [['lushy',32],['mangrove',100],['serenity',54],['bank-bust',4]]) {
    for (const width of [130, 258, 420]) {
      const offset = platformSurfaceOffset(`url("http://localhost/assets/${map}/lobbyPlatform.webp")`, width);
      // Platform is pulled up by the exact distance from image top to ground.
      assert.equal(-offset + y * width / 638, 0);
    }
  }
  assert.equal(platformSurfaceOffset('url("/custom-platform.webp")', 300), 0);
});

test('resizing and switching map recomputes grounding and releases removed slots', async () => {
  const saved = { document:globalThis.document, getComputedStyle:globalThis.getComputedStyle, ResizeObserver:globalThis.ResizeObserver };
  let callback, disconnected = 0, observed = [];
  const values = new Map();
  const element = { clientWidth:319, backgroundImage:'url(/assets/mangrove/lobbyPlatform.webp)', style:{setProperty:(key,value)=>values.set(key,value)} };
  globalThis.document = { querySelectorAll:()=>[element] };
  globalThis.getComputedStyle = x=>x;
  globalThis.ResizeObserver = class { constructor(cb){callback=cb;} disconnect(){disconnected++; observed=[];} observe(e){observed.push(e);} };
  try {
    refreshPlatformGrounding();
    await Promise.resolve();
    assert.equal(values.get('--platform-surface-offset'),'50px');
    element.clientWidth=638;
    callback([{target:element}]);
    assert.equal(values.get('--platform-surface-offset'),'100px');
    element.backgroundImage='url(/assets/lushy/lobbyPlatform.webp)';
    refreshPlatformGrounding();
    await Promise.resolve();
    assert.equal(values.get('--platform-surface-offset'),'32px');
    assert.equal(disconnected,2);
    assert.deepEqual(observed,[element]);
  } finally { Object.assign(globalThis,saved); }
});
