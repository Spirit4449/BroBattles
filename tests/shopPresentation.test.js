const test = require('node:test');
const assert = require('node:assert/strict');
const { createLobbyFixture } = require('./helpers/lobbyFixture');

function fixture() {
  let observer;
  const requests = [];
  const bundle = { id: 'custom-bundle', name: 'Custom Bundle', kind: 'bundle', rarity: 'rare',
    price: { type: 'virtual', currency: 'gems', amount: 40 }, originalPrice: { type: 'virtual', currency: 'gems', amount: 50 }, discountPercent: 20,
    state: { owned: false, available: true }, isNew: true,
    grants: [{ kind: 'currency', currency: 'coins', name: 'Coins', amount: 10 }] };
  const data = {
    serverNow: new Date().toISOString(), wallet: { coins: 0, gems: 0 },
    sectionMeta: [{ id: 'sales', name: 'New Collection', icon: '/icon.svg', rotation: 'sales', collapsible: false }],
    sections: { sales: [bundle] },
    rotations: { sales: { nextRefreshAt: new Date(Date.now() + 60000).toISOString() } },
    notifications: { hasNew: true, sections: { sales: { cycleKey: 'cycle', refreshed: true, offerIds: [bundle.id, 'collapsed-pack'], hasNew: true } } },
  };
  const f = createLobbyFixture({ globals: {
    IntersectionObserver: class {
      constructor(callback) { observer = callback; }
      observe() {} disconnect() {}
    },
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      return { ok: true, json: async () => url.endsWith('/bootstrap') ? structuredClone(data) : { success: true } };
    },
  } });
  f.document.visibilityState = 'visible';
  const shop = f.load('src/client/lobby/shop/shop.js').initializeShop({ userData: { name: 'Owner', coins: 0, gems: 0 } });
  return { ...f, shop, data, bundle, requests,
    intersect(target, visible = true) { observer([{ target, isIntersecting: visible, intersectionRatio: visible ? 0.75 : 0 }]); },
  };
}

test('shop renders server grants and pricing, blocks unavailable purchases, and distinguishes purchased and owned offers', async () => {
  const f = fixture();
  await f.shop.open();
  const card = () => f.document.querySelector('[data-shop-item-id="custom-bundle"]');
  assert.ok(f.document.querySelector('.shop-scroll').textContent.includes('New Collection'));
  assert.ok(card().textContent.includes('Custom Bundle') && card().textContent.includes('10 Coins'));
  assert.ok(card().textContent.includes('20%'));
  assert.equal(card().querySelector('[data-shop-action]').disabled, false);
  f.bundle.state.available = false;
  await f.shop.refresh();
  assert.equal(card().querySelector('[data-shop-action]').disabled, true);
  f.bundle.state.purchased = true;
  await f.shop.refresh();
  assert.ok(card().textContent.includes('PURCHASED'));
  assert.ok(!card().textContent.includes('UNAVAILABLE'));
  f.bundle.state.purchased = false;
  f.bundle.state.owned = true;
  f.data.sectionMeta[0].collapsible = true;
  await f.shop.refresh();
  assert.equal(card(), null);
  await f.shop.close();
});

test('NEW tags survive the visit; closing saves fully viewed sections but not a fleeting intersection', async () => {
  const f = fixture();
  const views = () => f.requests.filter(request => request.url.endsWith('/viewed'));
  const tag = () => f.document.querySelector('#shop-button [data-shop-new]');
  await f.shop.refreshNotifications();
  assert.ok(tag());
  assert.equal(views().length, 0);
  await f.shop.open();
  const card = f.document.querySelector('[data-shop-item-id="custom-bundle"]');
  f.intersect(card); f.intersect(card, false);
  await f.runTimers(1000);
  assert.equal(views().length, 0);
  f.intersect(f.document.querySelector('.shop-section-head'));
  await f.runTimers(1000);
  assert.equal(views().length, 0);
  assert.ok(tag());
  const loadsBefore = f.requests.length;
  await f.shop.refreshNotifications();
  assert.equal(f.requests.length, loadsBefore);
  await f.shop.close();
  assert.equal(views().length, 1);
  assert.deepEqual(JSON.parse(views()[0].options.body), { rotations: { sales: 'cycle' }, offerIds: ['custom-bundle', 'collapsed-pack'] });
  assert.equal(tag(), null);
  await f.shop.open();
  f.intersect(f.document.querySelector('.shop-section-head'));
  await f.shop.close();
  await f.runTimers(1000);
  assert.equal(views().length, 1, 'leaving before the visibility delay must not save a second view');
});
