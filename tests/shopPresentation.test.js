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

test('shop renders available offers, hides unavailable offers, and distinguishes purchased and owned offers', async () => {
  const f = fixture();
  await f.shop.open();
  const card = () => f.document.querySelector('[data-shop-item-id="custom-bundle"]');
  assert.ok(f.document.querySelector('.shop-scroll').textContent.includes('New Collection'));
  assert.ok(card().textContent.includes('Custom Bundle') && card().textContent.includes('10 Coins'));
  assert.ok(card().textContent.includes('20%'));
  assert.equal(card().querySelector('[data-shop-action]').disabled, false);
  f.bundle.state.available = false;
  await f.shop.refresh();
  assert.equal(card(), null);
  assert.match(f.document.querySelector('.shop-scroll').textContent, /Nothing available right now/);
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

test('clicking an offer previews its shortfall or its rewards before purchase', async () => {
  const f = fixture();
  f.data.sections.currency = [{
    id: 'gem-pack', name: 'Gem Pouch', state: { available: true }, kind: 'currency-pack',
    price: { type: 'money', amountCents: 99 }, grants: [{ kind: 'currency', currency: 'gems', amount: 60 }],
  }];
  await f.shop.open();
  const card = () => f.document.querySelector('[data-shop-item-id="custom-bundle"]');
  const dialog = () => f.document.querySelector('.purchase-review');
  card().click();
  assert.match(dialog().textContent, /40 more gems/);
  assert.ok(dialog().querySelector('[data-pack="gem-pack"]'));
  dialog().querySelector('[data-dismiss]').click();
  await f.settle();
  f.data.wallet.gems = 100;
  await f.shop.refresh();
  card().click();
  assert.match(dialog().textContent, /10 Coins/);
  assert.doesNotMatch(dialog().textContent, /Remaining|After purchase/);
  assert.match(dialog().querySelector('[data-confirm]').textContent, /Buy.*40/);
  dialog().querySelector('[data-dismiss]').click();
  assert.equal(f.requests.some(request => request.url.endsWith('/purchase')), false);
});

test('character shortfalls keep their pack picker open beneath a purchase review', async () => {
  const f = fixture();
  f.data.sections.currency = [{
    id: 'gem-pack', name: '60 Gems', state: { available: true }, kind: 'currency-pack',
    price: { type: 'money', amountCents: 99 }, grants: [{ kind: 'currency', currency: 'gems', name: 'Gems', amount: 60 }],
  }];
  const pending = f.shop.characterShortfall({ currency: 'gems', missing: 40 });
  await f.settle();
  const picker = f.document.querySelector('.purchase-review');
  picker.querySelector('[data-pack]').click();
  const dialogs = f.document.querySelectorAll('.purchase-review');
  assert.equal(dialogs.length, 2);
  assert.match(dialogs[1].textContent, /Confirm purchase/i);
  assert.equal(f.document.body.classList.contains('shop-is-open'), false);
  dialogs[1].querySelector('[data-dismiss]').click();
  await f.settle();
  assert.equal(f.document.querySelector('.purchase-review'), picker);
  picker.querySelector('[data-dismiss]').click();
  await pending;
});
