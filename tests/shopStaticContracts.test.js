const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("both profile clients are equip-only", () => {
  for (const file of ["src/client/pages/lobby.js", "src/client/pages/profile.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /\/player-cards\/buy/);
    assert.doesNotMatch(source, /\/profile-icons\/buy/);
  }
  assert.match(read("public/index.html"), /Get More in Shop/);
  assert.match(read("public/profile.html"), /Get More in Shop/);
});

test("shop grant delivery never updates equipped cosmetics", () => {
  const source = read("src/server/services/shop/shopService.js");
  const grantBody = source.slice(
    source.indexOf("async function applyGrants"),
    source.indexOf("async function redeem"),
  );
  assert.doesNotMatch(grantBody, /selected_skin_id_by_char/);
  assert.doesNotMatch(grantBody, /selected_card_id/);
  assert.doesNotMatch(grantBody, /selected_profile_icon_id/);
});

test("all public shop interfaces and the raw webhook are registered", () => {
  const routes = read("src/server/routes/modules/shopRoutes.js");
  for (const endpoint of [
    "/api/shop/bootstrap",
    "/api/shop/claim-daily",
    "/api/shop/purchase",
    "/api/shop/checkout-session",
    "/api/shop/checkout-status",
  ]) {
    assert.match(routes, new RegExp(endpoint.replaceAll("/", "\\/")));
  }

  const server = read("src/server/server.js");
  assert.ok(
    server.indexOf("registerStripeWebhookRoute({ app") <
      server.indexOf("app.use(express.json())"),
  );
  assert.match(
    read("src/server/routes/modules/stripeWebhook.js"),
    /express\.raw\(\{ type: "application\/json" \}\)/,
  );
});

test("local environment files are ignored while the example remains trackable", () => {
  const ignore = read(".gitignore");
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.env\.\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
});

test("checkout explicitly opts out of Stripe Managed Payments", () => {
  const service = read("src/server/services/shop/stripeShopService.js");
  assert.match(service, /managed_payments:\s*\{\s*enabled:\s*false\s*\}/);
});

test("checkout uses the current Stripe embedded page UI mode", () => {
  const service = read("src/server/services/shop/stripeShopService.js");
  assert.match(service, /ui_mode:\s*["']embedded_page["']/);
  assert.doesNotMatch(service, /ui_mode:\s*["']embedded["']/);
});

test("shop rendering supports catalog sections, bundles, ownership and discount overrides", () => {
  const vm = require('node:vm');
  const source = read('src/client/lobby/shop/shop.js')
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replaceAll('export function', 'function');
  const { sectionMarkup, itemMarkup, getActionState } = vm.runInNewContext(
    source + '\n;({ sectionMarkup, itemMarkup, getActionState })',
    { escapeHtml: require('../src/shared/site/html.cjs').escapeHtml },
  );
  const bundle = {
    id: 'custom-bundle', name: 'Custom Bundle', kind: 'bundle', rarity: 'rare',
    price: { type: 'virtual', currency: 'gems', amount: 40 },
    originalPrice: { type: 'virtual', currency: 'gems', amount: 50 }, discountPercent: 20,
    state: { owned: false, available: true },
    grants: [{ kind: 'card', id: 'example', name: 'Example Card' }, { kind: 'currency', currency: 'coins', name: 'Coins', amount: 10 }],
  };
  const html = sectionMarkup({ id: 'custom', name: 'New Collection', icon: '/icon.svg', collapsible: true }, [bundle]);
  assert.ok(html.includes('New Collection'));
  assert.ok(html.includes('Custom Bundle') && html.includes('Example Card') && html.includes('10 Coins'));
  assert.ok(html.includes('20%') && html.includes('aria-expanded="false"'));
  assert.equal(getActionState(bundle).disabled, false);
  bundle.state.available = false;
  assert.equal(getActionState(bundle).disabled, true);
  assert.ok(!itemMarkup(bundle, 'custom', 0).includes('20%'));
  bundle.state.purchased = true;
  assert.equal(getActionState(bundle).label, 'PURCHASED');
  const purchasedHtml = itemMarkup(bundle, 'sales', 0);
  assert.ok(purchasedHtml.includes('PURCHASED'));
  assert.ok(!purchasedHtml.includes('UNAVAILABLE') && !purchasedHtml.includes('is-unavailable'));
  assert.ok(purchasedHtml.includes('is-owned'));
  bundle.state.purchased = false;
  bundle.state.owned = true;
  assert.ok(!sectionMarkup({ id: 'custom', name: 'New Collection', collapsible: true }, [bundle]).includes('Custom Bundle'));
});


test("Shop keeps tags while open and saves entire seen sections on close", async () => {
  const vm = require('node:vm');
  const source = read('src/client/lobby/shop/shop.js').replace(/^import[\s\S]*?;\n/gm, '').replaceAll('export function', 'function');
  const timers = new Map();
  let timerId = 0, observer, lobbyTag = false;
  const requests = [];
  const classes = { add() {}, remove() {}, toggle() {} };
  const button = {
    setAttribute() {},
    querySelector() { return lobbyTag ? { remove() { lobbyTag = false; } } : null; },
    insertAdjacentHTML() { lobbyTag = true; },
  };
  const section = { id: 'shop-section-sales', getBoundingClientRect: () => ({ top: 0 }) };
  const header = { dataset: {}, matches: () => true, closest: () => section };
  const card = { closest: () => section, dataset: { shopItemId: 'new-pack' }, matches: () => false, querySelector: () => ({ remove() {} }) };
  const scroll = {
    scrollTop: 0, clientHeight: 500, scrollHeight: 1000,
    addEventListener() {}, getBoundingClientRect: () => ({ top: 0 }),
    querySelector: () => section,
    querySelectorAll(selector) {
      if (selector === '.shop-section-head, .shop-offer') return [header, card];
      if (selector === '[data-shop-item-id]') return [card];
      return [];
    },
  };
  const nav = { addEventListener() {} };
  const checkout = { classList: classes, setAttribute() {}, querySelector() { return null; } };
  const overlay = {
    classList: classes, setAttribute() {},
    querySelector(selector) {
      return { '.shop-tabs': nav, '.shop-scroll': scroll, '.shop-checkout': checkout }[selector] || null;
    },
    querySelectorAll: () => [],
  };
  const document = {
    visibilityState: 'visible', addEventListener() {},
    getElementById: () => button, createElement: () => overlay,
    body: { classList: classes, appendChild() {} },
  };
  const data = () => ({
    serverNow: new Date().toISOString(), wallet: { coins: 0, gems: 0 },
    sectionMeta: [{ id: 'sales', name: 'Sales', icon: '/icon', rotation: 'sales' }],
    sections: { sales: [{ id: 'new-pack', name: 'Pack', kind: 'currency-pack', grants: [], state: {}, isNew: true }] },
    rotations: { sales: { nextRefreshAt: new Date(Date.now() + 60000).toISOString() } },
    notifications: { hasNew: true, sections: { sales: { cycleKey: 'cycle', refreshed: true, offerIds: ['new-pack', 'collapsed-pack'], hasNew: true } } },
  });
  const { initializeShop } = vm.runInNewContext(source + '\n;({ initializeShop })', {
    ...(await import('../src/client/lobby/wallet.mjs')),
    document, URL, CSS: { escape: value => value }, console,
    escapeHtml: require('../src/shared/site/html.cjs').escapeHtml,
    playSound() {}, requestAnimationFrame() {},
    window: {
      location: { href: 'https://game.test/' }, setInterval() {}, clearInterval() {},
      requestAnimationFrame() {},
      setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; },
      clearTimeout(id) { timers.delete(id); },
    },
    IntersectionObserver: class {
      constructor(callback) { observer = this; this.callback = callback; }
      observe() {} disconnect() {}
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => url.endsWith('/bootstrap') ? data() : { success: true } };
    },
  });
  const runTimers = async ms => {
    for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); await timer.fn(); }
  };
  const intersect = (node, visible = true) => observer.callback([{ target: node, isIntersecting: visible, intersectionRatio: visible ? 0.75 : 0 }]);
  const shop = initializeShop();
  await shop.refreshNotifications();
  assert.equal(lobbyTag, true);
  assert.equal(requests.filter(request => request.url.endsWith('/viewed')).length, 0, 'background loads do not acknowledge views');
  await shop.open();
  intersect(card);
  intersect(card, false);
  await runTimers(1000);
  await runTimers(100);
  assert.equal(requests.filter(request => request.url.endsWith('/viewed')).length, 0, 'scrolling past a card does not clear it');
  intersect(header);
  await runTimers(1000);
  assert.equal(requests.filter(request => request.url.endsWith('/viewed')).length, 0, 'viewing a section queues its items without saving or clearing tags');
  assert.equal(lobbyTag, true, 'NEW stays visible for the whole visit');
  const loadsBefore = requests.length;
  await shop.refreshNotifications();
  assert.equal(requests.length, loadsBefore, 'background notifications do not rerender an open shop');
  await shop.close();
  const saved = requests.find(request => request.url.endsWith('/viewed'));
  assert.equal(saved.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(saved.options.body), { rotations: { sales: 'cycle' }, offerIds: ['new-pack', 'collapsed-pack'] });
  assert.equal(lobbyTag, false, 'tags clear after closing and successfully saving');
  await shop.open();
  intersect(header);
  await shop.close();
  await runTimers(1000);
  assert.equal(requests.filter(request => request.url.endsWith('/viewed')).length, 1, 'a section left before the visibility delay stays unread');

});
