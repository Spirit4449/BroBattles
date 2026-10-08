const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { authedRoute, sendShopError, purchaseGrantFromShop } = require('../src/server/routes/routeHelpers');
const { registerPlayerCardsRoutes } = require('../src/server/routes/modules/playerCardsRoutes');
const { getPlayerCardsCatalog } = require('../src/server/services/cosmetics/playerCardsCatalog');
const { playerCardImage, bindPlayerCardHover, positionPlayerCardCanvas, createPlayerCardMedia, restartPlayerCardMedia, pausePlayerCardPreparation } = require('../src/client/views/playerCardAnimation.cjs');
const { measurePlayerCardBounds } = require('../scripts/art/player-card-bounds.cjs');

test('full animation canvas preserves the card layout rectangle without cropping effects', () => {
  for (const card of getPlayerCardsCatalog().cards.filter(card => card.animationViewport)) {
    const image = { style: {} };
    positionPlayerCardCanvas(image, card);
    const view = card.animationViewport;
    const renderedWidth = parseFloat(image.style.width) / 100;
    const renderedHeight = parseFloat(image.style.height) / 100;
    const scale = card.renderScale || 1;
    const inset = (1 - scale) / 2;
    assert.ok(renderedWidth > 1 && renderedHeight > 1);
    assert.ok(Math.abs(parseFloat(image.style.left) / 100 + renderedWidth * view.x / view.width - inset) < 1e-10);
    assert.ok(Math.abs(parseFloat(image.style.top) / 100 + renderedHeight * view.y / view.height - inset) < 1e-10);
    assert.ok(Math.abs(renderedWidth * view.w / view.width - scale) < 1e-10);
    assert.ok(Math.abs(renderedHeight * view.h / view.height - scale) < 1e-10);
  }
});

test('common static cards shrink around their center', () => {
  const card = getPlayerCardsCatalog().cards.find(card => !card.animationViewport && card.renderScale);
  const image = { style: {} };
  positionPlayerCardCanvas(image, card);
  assert.ok(card.renderScale > 0 && card.renderScale < 1);
  assert.equal(image.style.transform, `scale(${card.renderScale})`);
  assert.equal(image.style.transformOrigin, 'center');
});

test('battle cards preserve proportions with a shared reduction and a larger Shuriken frame', () => {
  const catalog = getPlayerCardsCatalog();
  const box = catalog.renderGuides.fullCardSizePx;
  const reductions = new Map();
  for (const card of catalog.cards) {
    const image = { style: {} };
    positionPlayerCardCanvas(image, card, { battle: true });
    const view = card.battleViewport;
    const width = parseFloat(image.style.width) / 100 * box.w;
    const height = parseFloat(image.style.height) / 100 * box.h;
    const left = parseFloat(image.style.left) / 100 * box.w;
    const top = parseFloat(image.style.top) / 100 * box.h;
    const scale = width / view.width;
    assert.ok(Math.abs(scale - height / view.height) < 1e-10, card.id + ' must not stretch');
    assert.ok(Math.abs(left + (view.x + view.w / 2) * scale - box.w / 2) < 1e-10);
    assert.ok(Math.abs(top + (view.y + view.h / 2) * scale - box.h / 2) < 1e-10);
    const fit = Math.min(box.w / view.w, box.h / view.h);
    assert.ok(scale < fit && scale > fit * .8);
    reductions.set(card.id, scale / fit);
  }
  for (const [id, reduction] of reductions) {
    if (id === 'shuriken-strike') assert.ok(reduction > reductions.get('default'));
    else assert.ok(Math.abs(reduction - reductions.get('default')) < 1e-10);
  }
});

test('default battle viewport follows the visible bounds of its installed art', async () => {
  const card = getPlayerCardsCatalog().cards.find(card => card.id === 'default');
  const asset = path.join(__dirname, '../public', card.assetUrl);
  assert.deepEqual(card.battleViewport, await measurePlayerCardBounds(asset));
});

test('animated cards loop in automatic contexts and retain a still fallback', () => {
  for (const card of getPlayerCardsCatalog().cards) {
    assert.equal(playerCardImage(card.id), card.animationUrl || card.assetUrl);
    assert.equal(playerCardImage(card, { animate: false }), card.assetUrl);
    assert.equal(playerCardImage(card, { reducedMotion: true }), card.assetUrl);
  }
  assert.equal(playerCardImage({ assetUrl: '/assets/still.webp', animationUrl: 'https://outside.invalid/x.webp' }), '/assets/still.webp');
});

test('profile animations keep looping after hover and focus leave, then fall back on error', () => {
  const card = getPlayerCardsCatalog().cards.find(card => card.animationUrl);
  const events = {}, imageEvents = {};
  const tile = { addEventListener: (name, fn) => { events[name] = fn; }, contains: node => node === tile };
  const image = { src: card.assetUrl, addEventListener: (name, fn) => { imageEvents[name] = fn; } };
  bindPlayerCardHover(tile, image, card);
  assert.equal(image.src, card.assetUrl);
  events.mouseenter();
  assert.equal(image.src, card.animationUrl);
  events.focusin();
  events.mouseleave?.();
  assert.equal(image.src, card.animationUrl);
  events.focusout?.({ relatedTarget: null });
  assert.equal(image.src, card.animationUrl);
  events.mouseenter();
  imageEvents.error();
  assert.equal(image.src, card.assetUrl);
  events.mouseleave?.(); events.mouseenter();
  assert.equal(image.src, card.assetUrl);
});

test('profile videos prepare visible tiles and retain their decoder between hover plays', async () => {
  const card = getPlayerCardsCatalog().cards.find(card => card.animationUrl);
  const previousWindow = global.window, previousDocument = global.document;
  let deliver, observe, dispose, requests = 0, cancels = 0, plays = 0, loads = 0, pauses = 0;
  const priorities = [];
  const attributes = {};
  const video = {
    tagName: 'VIDEO', isConnected: true, dataset: {},
    setAttribute(key, value) { attributes[key] = value; },
    getAttribute(key) { return attributes[key]; }, removeAttribute(key) { delete attributes[key]; },
    set src(value) { attributes.src = value; }, get src() { return attributes.src; },
    addEventListener() {}, pause() { pauses++; }, load() { loads++; }, play() { plays++; return Promise.resolve(); },
  };
  global.window = {
    __BB_NAVIGATION__: { requestCardAnimation(entry, callback, options) {
      priorities.push(options.interactive);
      assert.equal(entry.id, card.id); requests++; deliver = callback;
      return () => { cancels++; };
    } },
    IntersectionObserver: class { constructor(fn) { observe = fn; } observe() {} disconnect() {} },
    __BB_PAGE_SCOPE__: { onDispose(fn) { dispose = fn; } },
  };
  global.document = { hidden: false, createElement: () => video, addEventListener() {}, removeEventListener() {} };
  try {
    const media = createPlayerCardMedia(card, { hover: true, verifyAlpha: async () => true });
    const events = {};
    const tile = { addEventListener: (name, fn) => { events[name] = fn; }, contains: node => node === tile };
    bindPlayerCardHover(tile, media, card);
    observe([{ isIntersecting: true }]);
    assert.equal(media.poster, card.assetUrl);
    assert.equal(media.src, undefined);
    assert.equal(requests, 1, 'visible tiles prepare before hovering');
    events.mouseenter();
    assert.equal(requests, 2, 'hover upgrades the pending preparation');
    assert.deepEqual(priorities, [false, true]);
    assert.equal(media.src, undefined, 'must not let the video element download independently');
    await deliver('blob:downloaded');
    assert.equal(media.src, 'blob:downloaded');
    assert.equal(plays, 1);
    const beforeLeave = pauses;
    events.mouseleave?.();
    events.focusout?.({ relatedTarget: null });
    assert.equal(pauses, beforeLeave, 'leaving a started tile must not pause it');
    assert.equal(cancels, 1);
    assert.equal(media.src, 'blob:downloaded');
    const preparedLoads = loads;
    events.mouseenter();
    assert.equal(loads, preparedLoads, 'hover replay must not reload the decoder');
    assert.equal(requests, 2, 'reuse the complete animation without another request');
    media.currentTime = 3;
    restartPlayerCardMedia(media);
    assert.equal(media.currentTime, 0, 'a new profile restarts the same card from the beginning');
    assert.equal(loads, preparedLoads, 'restarting a profile retains the loaded source');
    media.currentTime = 2;
    restartPlayerCardMedia(media);
    assert.equal(media.currentTime, 0, 'every profile opening restarts playback');
    observe([{ isIntersecting: false }]);
    assert.ok(pauses > beforeLeave, 'offscreen cards still pause');
    dispose();
    await deliver('blob:late');
    assert.equal(media.src, undefined);
    video.isConnected = false;
    const beforePreparation = plays;
    let alphaChecks = 0;
    const prepared = createPlayerCardMedia(card, { prepare: true, verifyAlpha: async () => { alphaChecks++; return true; } });
    pausePlayerCardPreparation(prepared, true);
    await deliver('blob:prepared');
    assert.equal(alphaChecks, 0, 'a late download must not probe alpha during the flythrough');
    assert.equal(prepared.src, undefined, 'a late download must not start a decoder during the flythrough');
    pausePlayerCardPreparation(prepared, false);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(alphaChecks, 1);
    assert.equal(prepared.src, 'blob:prepared', 'prepare the actual detached playback element');
    assert.equal(prepared.preload, 'auto');
    assert.equal(plays, beforePreparation, 'preparation must not play offscreen');
    const beforeMount = loads;
    video.isConnected = true;
    observe([{ isIntersecting: true }]);
    assert.equal(plays, beforePreparation + 1);
    assert.equal(loads, beforeMount, 'mounting reuses the prepared decoder');
    dispose();
    assert.equal(prepared.src, undefined, 'disposal releases the retained decoder');
    let probeAttempts = 0;
    const retrying = createPlayerCardMedia(card, { verifyAlpha: async () => ++probeAttempts === 1 ? null : true });
    observe([{ isIntersecting: true }]);
    await deliver('blob:retry-probe');
    assert.equal(retrying.dataset.animationState, 'retrying', 'a failed probe is not proof the codec is unsupported');
    await new Promise(resolve => setTimeout(resolve, 280));
    assert.equal(retrying.src, 'blob:retry-probe', 'transient alpha failure recovers without a new download');
    dispose();
    const unsupported = createPlayerCardMedia(card, { interactive: true, verifyAlpha: async () => false });
    observe([{ isIntersecting: true }]);
    await deliver('blob:opaque-green');
    assert.equal(unsupported.src, undefined, 'an alpha-ignoring decoder must never show the green frame');
    assert.equal(unsupported.poster, card.assetUrl);
    assert.equal(unsupported.dataset.animationState, 'unsupported');
    dispose();
  } finally {
    global.window = previousWindow; global.document = previousDocument;
  }
});

function fakeRes() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('showing a card again while an obsolete alpha check finishes prepares the current download', async () => {
  const previousWindow = global.window, previousDocument = global.document;
  let observe, visibility, dispose, finishProbe, announceProbe;
  const probing = new Promise(resolve => { announceProbe = resolve; });
  const deliveries = [], priorities = [];
  const attributes = {};
  const video = {
    tagName: 'VIDEO', isConnected: true, dataset: {},
    setAttribute(key, value) { attributes[key] = value; },
    getAttribute(key) { return attributes[key]; }, removeAttribute(key) { delete attributes[key]; },
    set src(value) { attributes.src = value; }, get src() { return attributes.src; },
    addEventListener() {}, pause() {}, load() {}, play() { return Promise.resolve(); },
  };
  global.window = {
    __BB_NAVIGATION__: { requestCardAnimation(_entry, callback, options) {
      deliveries.push(callback); priorities.push(options.interactive); return () => {};
    } },
    IntersectionObserver: class { constructor(fn) { observe = fn; } observe() {} disconnect() {} },
    __BB_PAGE_SCOPE__: { onDispose(fn) { dispose = fn; } },
  };
  global.document = { hidden: false, createElement: () => video,
    addEventListener(_event, callback) { visibility = callback; }, removeEventListener() {} };
  try {
    const card = getPlayerCardsCatalog().cards.find(card => card.animationUrl);
    createPlayerCardMedia(card, { verifyAlpha: url => url === 'blob:obsolete'
      ? new Promise(resolve => { finishProbe = resolve; announceProbe(); }) : Promise.resolve(true) });
    observe([{ isIntersecting: true }]);
    const oldPreparation = deliveries[0]('blob:obsolete');
    await probing;
    document.hidden = true; visibility();
    document.hidden = false; visibility();
    await deliveries[1]('blob:current');
    finishProbe(true);
    await oldPreparation;
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(video.src, 'blob:current', 'a replacement request must not be stranded by the old preparation');
    assert.ok(priorities.every(Boolean), 'visible automatic playback must have foreground priority');
    await deliveries[0]('blob:late-obsolete');
    assert.equal(video.src, 'blob:current', 'cancelled subscriptions cannot replace the active source');
  } finally {
    dispose?.(); global.window = previousWindow; global.document = previousDocument;
  }
});

test('alpha support is probed once per codec and persisted only after a decoded verdict', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../src/client/views/playerCardAnimation.cjs'), 'utf8');
  const saved = new Map();
  let probes = 0, alpha = 0, fails = false;
  function load() {
    const context = {
      module: { exports: {} }, require, setTimeout, clearTimeout,
      navigator: { userAgent: 'card-test-browser' },
      window: { localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) } },
      document: { createElement(tag) {
        if (tag === 'canvas') return { getContext: () => ({ drawImage() {}, getImageData: () => ({ data: [0, 0, 0, alpha] }) }) };
        probes++;
        return { pause() {}, removeAttribute() {}, load() {
          if (this.onloadeddata) queueMicrotask(() => fails ? this.onerror?.() : this.onloadeddata?.());
        } };
      } },
    };
    // Resolve the real module's relative dependencies from its own location.
    context.require = require('node:module').createRequire(require.resolve('../src/client/views/playerCardAnimation.cjs'));
    vm.runInNewContext(source, context);
    return context.module.exports.verifyPlayerCardAlpha;
  }
  let verify = load();
  assert.deepEqual(await Promise.all([verify('blob:a', 'webm'), verify('blob:b', 'webm')]), [true, true]);
  assert.equal(probes, 1);
  verify = load();
  assert.equal(await verify('blob:new-page', 'webm'), true);
  assert.equal(probes, 1, 'a page transition reuses the browser verdict');
  fails = true;
  assert.equal(await verify('blob:failed-mov', 'hevc'), null, 'load failure is distinct from a decoded opaque frame');
  fails = false;
  alpha = 255;
  assert.equal(await verify('blob:opaque-mov', 'hevc'), false);
  assert.equal(probes, 3, 'an inconclusive load must allow another probe');
  verify = load();
  assert.equal(await verify('blob:next-mov', 'hevc'), false);
  assert.equal(probes, 3, 'a decoded opaque verdict is reused for this codec only');
});

function quietly(fn) {
  const original = console.error;
  console.error = () => {};
  return Promise.resolve(fn()).finally(() => { console.error = original; });
}

test('authedRoute answers 401 when signed out and 500 on unexpected errors', async () => {
  const signedOut = fakeRes();
  await authedRoute(async () => null, 'x', () => assert.fail('handler ran'))({}, signedOut);
  assert.deepEqual([signedOut.statusCode, signedOut.body.error], [401, 'Not authenticated']);

  const failed = fakeRes();
  await quietly(() => authedRoute(async () => ({ user_id: 1 }), 'x', () => { throw new Error('boom'); })({}, failed));
  assert.deepEqual([failed.statusCode, failed.body.error], [500, 'Internal server error']);
});

test('authedRoute lets onError answer known shop failures', async () => {
  const res = fakeRes();
  const shopError = Object.assign(new Error('Not enough gems'), { status: 402, code: 'insufficient_funds', wallet: { gems: 1 } });
  await quietly(() => authedRoute(async () => ({ user_id: 1 }), 'x', () => { throw shopError; }, {
    onError: (error, r) => sendShopError(r, error, 'fallback'),
  })({}, res));
  assert.equal(res.statusCode, 402);
  assert.deepEqual(res.body, { success: false, code: 'insufficient_funds', error: 'Not enough gems', wallet: { gems: 1 } });
  assert.equal(sendShopError(fakeRes(), new Error('plain'), 'fallback'), false);
});

test('purchaseGrantFromShop buys the matching offer with a stable key', async () => {
  const calls = [];
  const shopService = {
    findOfferForGrant: (type, id) => (type === 'skin' && id === 's1' ? { id: 'offer-1' } : null),
    purchaseVirtual: async (args) => { calls.push(args); return { success: true, wallet: { coins: 5, gems: 7 } }; },
  };
  const user = { user_id: 9 };
  assert.equal(await purchaseGrantFromShop({ shopService, req: { body: {} }, user, grantType: 'skin', grantId: 'nope', idempotencyPrefix: 'p' }), null);
  const result = await purchaseGrantFromShop({ shopService, req: { body: { idempotencyKey: 'k1' } }, user, grantType: 'skin', grantId: 's1', idempotencyPrefix: 'p' });
  assert.deepEqual(calls, [{ userId: 9, offerId: 'offer-1', idempotencyKey: 'k1' }]);
  assert.deepEqual(result, { success: true, wallet: { coins: 5, gems: 7 }, owned: true, coins: 5, gems: 7 });
});

test('player card routes validate ids and ownership before selecting', async () => {
  const routes = {};
  const app = { get: (path, fn) => { routes[`GET ${path}`] = fn; }, post: (path, fn) => { routes[`POST ${path}`] = fn; } };
  const selected = [];
  const cardId = String(getPlayerCardsCatalog().cards[0].id);
  const db = { userOwnsCard: async (_u, id) => id === cardId, setUserSelectedCardId: async (_u, id) => selected.push(id) };
  registerPlayerCardsRoutes({ app, db, requireCurrentUser: async () => ({ user_id: 3 }), shopService: null });

  const select = routes['POST /player-cards/select'];
  const missing = fakeRes();
  await select({ body: {} }, missing);
  assert.equal(missing.statusCode, 400);
  const unknown = fakeRes();
  await select({ body: { cardId: 'definitely-not-a-card' } }, unknown);
  assert.equal(unknown.statusCode, 404);
  const ok = fakeRes();
  await select({ body: { cardId } }, ok);
  assert.deepEqual([ok.statusCode, ok.body, selected], [200, { success: true, selectedCardId: cardId }, [cardId]]);
});
