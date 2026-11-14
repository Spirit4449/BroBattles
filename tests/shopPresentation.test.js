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
  assert.ok(card().textContent.includes('Custom Bundle') && card().textContent.includes('BUNDLE · 1 ITEM'));
  assert.ok(card().querySelector('[data-shop-preview="custom-bundle"]'), 'bundles list their contents behind the info button');
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
  f.data.sectionMeta[0].hideOwned = true;
  await f.shop.refresh();
  assert.equal(card(), null);
  assert.match(f.document.querySelector('.shop-scroll').textContent, /Collection complete/, 'owning everything in a rotating section still reads as complete');
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

test('the buy button previews its shortfall or rewards; clicking the card itself does nothing', async () => {
  const f = fixture();
  f.data.sections.currency = [{
    id: 'gem-pack', name: 'Gem Pouch', state: { available: true }, kind: 'currency-pack',
    price: { type: 'money', amountCents: 99 }, grants: [{ kind: 'currency', currency: 'gems', amount: 60 }],
  }];
  await f.shop.open();
  const card = () => f.document.querySelector('[data-shop-item-id="custom-bundle"]');
  const dialog = () => f.document.querySelector('.purchase-review');
  card().querySelector('.shop-offer-body').click();
  card().click();
  assert.equal(dialog(), null, 'only the buy button starts a purchase');
  card().querySelector('.shop-buy-button').click();
  assert.match(dialog().textContent, /40 more gems/);
  assert.ok(dialog().querySelector('[data-pack="gem-pack"]'));
  dialog().querySelector('[data-dismiss]').click();
  await f.settle();
  f.data.wallet.gems = 100;
  await f.shop.refresh();
  card().querySelector('.shop-buy-button').click();
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

test('refreshing replaces only changed cards and keeps expanded sections open', async () => {
  const f = fixture();
  f.data.sections.sales.push({ id: 'other', name: 'Other', kind: 'item', rarity: 'common', price: { type: 'virtual', currency: 'gems', amount: 5 },
    state: { available: true }, grants: [{ kind: 'currency', currency: 'coins', name: 'Coins', amount: 5 }] });
  Object.assign(f.data.sectionMeta[0], { collapsible: true, rows: 1 });
  await f.shop.open();
  const node = id => f.document.querySelector(`[data-shop-item-id="${id}"]`);
  const bundleBefore = node('custom-bundle');
  const otherBefore = node('other');
  f.document.querySelector('.shop-expand').click();
  f.bundle.state.purchased = true;
  await f.shop.refresh();
  assert.equal(node('other'), otherBefore, 'an unchanged card keeps its DOM node');
  assert.notEqual(node('custom-bundle'), bundleBefore);
  assert.match(node('custom-bundle').textContent, /PURCHASED/);
  assert.ok(f.document.querySelector('.shop-section').classList.contains('is-expanded'));
  assert.equal(f.document.querySelector('.shop-expand').textContent, 'Show less');
  await f.shop.close();
});

test('free daily rewards are granted without a confirmation dialog', async () => {
  const f = fixture();
  f.data.sectionMeta.push({ id: 'dailies', name: 'Dailies', icon: '/icon.svg', rotation: 'dailies', layout: 'list' });
  f.data.sections.dailies = [{ id: 'daily-coins', name: 'Coin Drop', kind: 'daily', rarity: 'common',
    state: { available: true, claimed: false }, grants: [{ kind: 'currency', currency: 'coins', name: 'Coins', amount: 40 }] }];
  await f.shop.open();
  f.document.querySelector('[data-shop-item-id="daily-coins"] .shop-buy-button').click();
  await f.settle();
  assert.equal(f.document.querySelector('.purchase-review'), null);
  assert.equal(f.requests.filter(request => request.url.endsWith('/claim-daily')).length, 1);
});

test('a tab jump keeps the clicked tab lit until the user scrolls again', async () => {
  const f = fixture();
  f.data.sectionMeta.push({ id: 'skins', name: 'Skins', icon: '/icon.svg' }, { id: 'currency', name: 'Gems', icon: '/icon.svg' });
  await f.shop.open();
  const scroll = f.document.querySelector('.shop-scroll');
  const active = () => f.document.querySelector('.shop-tabs .is-active')?.dataset.shopJump;
  f.document.querySelector('[data-shop-jump="skins"]').click();
  f.event(scroll, 'scroll');
  await f.advance(20);
  assert.equal(active(), 'skins', 'scroll events from the jump must not move the highlight');
  await f.advance(400);
  f.event(scroll, 'wheel');
  f.event(scroll, 'scroll');
  await f.advance(20);
  assert.notEqual(active(), 'skins', 'the scroll spy resumes for user scrolling');
  await f.shop.close();
});

test('confirming a purchase keeps the dimmed backdrop up until the reveal takes over', async () => {
  const f = fixture();
  f.data.wallet.gems = 100;
  await f.shop.open();
  f.document.querySelector('[data-shop-item-id="custom-bundle"] .shop-buy-button').click();
  f.document.querySelector('.purchase-review [data-confirm]').click();
  assert.ok(f.document.querySelector('.cs-confirm-backdrop.is-handing-off'), 'the dim must not drop while the purchase is in flight');
  for (let i = 0; i < 5 && !f.document.querySelector('.shop-reward-reveal'); i += 1) await f.settle();
  assert.ok(f.document.querySelector('.shop-reward-reveal.is-seamless'), 'the reveal mounts without a second fade-in');
  assert.equal(f.document.querySelector('.cs-confirm-backdrop'), null, 'the bridge is released once the reveal is up');
  assert.equal(f.requests.filter(request => request.url.endsWith('/purchase')).length, 1);
});

test('an empty collection section shows Collection complete, not Nothing available', async () => {
  const f = fixture();
  f.data.sectionMeta.push({ id: 'skins', name: 'Skins', icon: '/icon.svg', hideOwned: true, rows: 2, collapsible: true });
  f.data.sections.skins = [];
  await f.shop.open();
  const skins = f.document.querySelector('#shop-section-skins').textContent;
  assert.match(skins, /Collection complete/);
  assert.doesNotMatch(skins, /Nothing available/);
});
