const test = require('node:test');
const assert = require('node:assert/strict');
const { authedRoute, sendShopError, purchaseGrantFromShop } = require('../src/server/routes/routeHelpers');
const { registerPlayerCardsRoutes } = require('../src/server/routes/modules/playerCardsRoutes');
const { getPlayerCardsCatalog } = require('../src/server/services/cosmetics/playerCardsCatalog');

function fakeRes() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

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
