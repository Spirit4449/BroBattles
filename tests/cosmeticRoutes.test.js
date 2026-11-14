const test = require('node:test');
const assert = require('node:assert/strict');

const { authedRoute, sendShopError, purchaseGrantFromShop } = require('../src/server/routes/routeHelpers');
const { registerPlayerCardsRoutes } = require('../src/server/routes/modules/playerCardsRoutes');
const { getPlayerCardsCatalog } = require('../src/server/services/cosmetics/playerCardsCatalog');
const { playerCardImage, bindPlayerCardHover, positionPlayerCardCanvas, createPlayerCardMedia, restartPlayerCardMedia, pausePlayerCardPreparation } = require('../src/client/views/playerCardAnimation.cjs');

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

test('titles start empty, reject unowned or unknown selections, and allow equip and removal', async () => {
  const { registerTitlesRoutes } = require('../src/server/routes/modules/titlesRoutes');
  const { getTitlesCatalog } = require('../src/server/services/cosmetics/titlesCatalog');
  const routes = new Map();
  const user = { user_id: 7, selected_title_id: null };
  const owned = [];
  const db = { async runQuery(sql, params) {
    if (sql.startsWith('SELECT title_id')) return owned.map(title_id => ({ title_id }));
    if (sql.startsWith('UPDATE users SET selected_title_id')) { user.selected_title_id = params[0]; return {}; }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  registerTitlesRoutes({ app: { get: (url, handler) => routes.set(url, handler), post: (url, handler) => routes.set(url, handler) }, db,
    requireCurrentUser: async () => user });
  async function call(url, body) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await routes.get(url)({ body }, res);
    return res;
  }
  assert.deepEqual((await call('/titles/owned')).body.ownedTitleIds, []);
  const title = getTitlesCatalog().titles[0];
  assert.equal((await call('/titles/select', { titleId: title.id })).statusCode, 403);
  assert.equal((await call('/titles/select', { titleId: 'missing' })).statusCode, 400);
  assert.equal((await call('/titles/select', {})).statusCode, 400);
  owned.push(title.id);
  assert.equal((await call('/titles/select', { titleId: title.id })).body.selectedTitleId, title.id);
  assert.equal(user.selected_title_id, title.id);
  assert.equal((await call('/titles/select', { titleId: null })).body.selectedTitleId, null);
  assert.equal(user.selected_title_id, null);
  assert.deepEqual(owned, [title.id], 'removing a title preserves ownership');
});
