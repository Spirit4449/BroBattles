const test = require("node:test");
const assert = require("node:assert/strict");

const { createShopService } = require("../src/server/services/shop/shopService");

class CommerceFakeDb {
  constructor(user) {
    this.runQuery = this.runQuery.bind(this);
    this.state = {
      users: new Map([[user.user_id, structuredClone(user)]]),
      skins: new Map([[user.user_id, new Set()]]),
      cards: new Map([[user.user_id, new Set(["default"])]]),
      icons: new Map([[user.user_id, new Set()]]),
      redemptions: [],
      views: [],
      ledger: [],
      rotations: new Map(),
      nextRedemptionId: 1,
    };
    this.lock = Promise.resolve();
  }

  async withTransaction(fn) {
    const previous = this.lock;
    let release;
    this.lock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshot = structuredClone(this.state);
    try {
      return await fn(null, (sql, params = []) => this.query(sql, params));
    } catch (error) {
      this.state = snapshot;
      throw error;
    } finally {
      release();
    }
  }

  async runQuery(sql, params = []) {
    return this.query(sql, params);
  }

  async query(rawSql, params) {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    const user = this.state.users.get(Number(params.at(-1) || params[0]));

    if (sql.startsWith("SELECT view_kind, view_key FROM shop_views")) {
      return this.state.views.filter(row => row.user_id === params[0]);
    }
    if (sql.startsWith("INSERT IGNORE INTO shop_views")) {
      for (let i = 0; i < params.length; i += 3) {
        const [user_id, view_kind, view_key] = params.slice(i, i + 3);
        if (!this.state.views.some(row => row.user_id === user_id && row.view_kind === view_kind && row.view_key === view_key)) {
          this.state.views.push({ user_id, view_kind, view_key });
        }
      }
      return { affectedRows: 1 };
    }
    if (sql.startsWith("INSERT IGNORE INTO shop_rotation_state")) {
      const section = params[0];
      if (!this.state.rotations.has(section)) {
        this.state.rotations.set(section, {
          section,
          period_key: params[1],
          generation: 0,
          refreshed_at: new Date(),
        });
        return { affectedRows: 1 };
      }
      return { affectedRows: 0 };
    }
    if (sql.startsWith("SELECT * FROM shop_rotation_state")) {
      return [this.state.rotations.get(params[0])].filter(Boolean);
    }
    if (sql.includes("generation = generation + 1")) {
      const row = this.state.rotations.get(params[3]);
      row.period_key = params[0];
      row.generation += 1;
      row.refreshed_at = new Date();
      return { affectedRows: 1 };
    }
    if (sql.startsWith("UPDATE shop_rotation_state SET period_key")) {
      const row = this.state.rotations.get(params[2]);
      row.period_key = params[0];
      row.generation = 0;
      row.refreshed_at = new Date();
      return { affectedRows: 1 };
    }

    if (sql.startsWith("SELECT * FROM users WHERE user_id")) {
      return user ? [structuredClone(user)] : [];
    }
    if (sql.startsWith("SELECT selected_card_id FROM users")) {
      return user ? [{ selected_card_id: user.selected_card_id }] : [];
    }
    if (sql.startsWith("SELECT coins, gems FROM users")) {
      return user ? [{ coins: user.coins, gems: user.gems }] : [];
    }
    if (sql.startsWith("UPDATE users SET selected_profile_icon_id")) {
      this.state.users.get(params[1]).selected_profile_icon_id = params[0];
      return { affectedRows: 1 };
    }
    if (sql.startsWith("UPDATE users SET selected_skin_id_by_char")) {
      this.state.users.get(params[1]).selected_skin_id_by_char = params[0];
      return { affectedRows: 1 };
    }
    if (sql.startsWith("SELECT offer_id, limit_key, status FROM shop_redemptions")) {
      return this.state.redemptions.filter(entry => entry.user_id === params[0] && entry.status === 'fulfilled');
    }
    if (sql.startsWith("SELECT * FROM shop_redemptions")) {
      const [userId, key, offerId, limitKey] = params;
      return this.state.redemptions.filter(
        (entry) =>
          entry.user_id === userId &&
          (entry.idempotency_key === key ||
            (entry.offer_id === offerId && entry.limit_key === limitKey)),
      );
    }
    if (sql.startsWith("SELECT skin_id FROM user_skins")) {
      return [...(this.state.skins.get(params[0]) || [])].map((skin_id) => ({
        skin_id,
      }));
    }
    if (sql.startsWith("SELECT card_id FROM user_cards")) {
      return [...(this.state.cards.get(params[0]) || [])].map((card_id) => ({
        card_id,
      }));
    }
    if (sql.startsWith("SELECT icon_id FROM user_profile_icons")) {
      return [...(this.state.icons.get(params[0]) || [])].map((icon_id) => ({
        icon_id,
      }));
    }
    if (sql.startsWith("INSERT INTO shop_redemptions")) {
      const id = this.state.nextRedemptionId++;
      const [userId, offerId, limitKey, kind, key, price, reward] = params;
      this.state.redemptions.push({
        redemption_id: id,
        user_id: userId,
        offer_id: offerId,
        limit_key: limitKey,
        redemption_kind: kind,
        idempotency_key: key,
        price_snapshot: price,
        reward_snapshot: reward,
        status: "pending",
      });
      return { insertId: id, affectedRows: 1 };
    }
    if (/^UPDATE users SET (coins|gems) = \1 - \?/.test(sql)) {
      const currency = sql.match(/^UPDATE users SET (coins|gems)/)[1];
      const target = this.state.users.get(params[1]);
      target[currency] -= Number(params[0]);
      return { affectedRows: 1 };
    }
    if (sql.startsWith("UPDATE users SET coins = coins + ?")) {
      const target = this.state.users.get(params[2]);
      target.coins += Number(params[0]);
      target.gems += Number(params[1]);
      return { affectedRows: 1 };
    }
    if (sql.startsWith("INSERT IGNORE INTO shop_currency_ledger")) {
      this.state.ledger.push(structuredClone(params));
      return { affectedRows: 1 };
    }
    if (sql.startsWith("INSERT IGNORE INTO user_skins")) {
      this.state.skins.get(params[0]).add(String(params[1]));
      return { affectedRows: 1 };
    }
    if (sql.startsWith("INSERT IGNORE INTO user_cards")) {
      this.state.cards.get(params[0]).add(String(params[1]));
      return { affectedRows: 1 };
    }
    if (sql.startsWith("INSERT IGNORE INTO user_profile_icons")) {
      this.state.icons.get(params[0]).add(String(params[1]));
      return { affectedRows: 1 };
    }
    if (sql.startsWith("UPDATE shop_redemptions SET status")) {
      const entry = this.state.redemptions.find(
        (candidate) => candidate.redemption_id === params[0],
      );
      entry.status = "fulfilled";
      return { affectedRows: 1 };
    }
    throw new Error(`Unexpected SQL in commerce test: ${sql}`);
  }
}

function createFixture({ gems = 250, coins = 0 } = {}) {
  const user = {
    user_id: 7,
    coins,
    gems,
    selected_card_id: "default",
    selected_skin_id_by_char: JSON.stringify({ thorg: "thorg-default" }),
  };
  const db = new CommerceFakeDb(user);
  return { db, user, service: createShopService({ db }) };
}

test("concurrent bundle purchases charge and grant exactly once without equipping", async () => {
  const { db, service } = createFixture();
  const sale = (await service.buildBootstrap({ user_id: 7 })).sections.sales.find(item => item.id === "ironbound-arsenal");
  const offers = require('../src/server/services/shop/shopCatalog').getShopCatalog().offers;
  const standaloneCosmetics = sale.grants.filter(grant => grant.kind !== 'currency').map(grant =>
    offers.find(offer => offer.grants.length === 1 && offer.grants[0].kind === grant.kind && offer.grants[0].id === grant.id));
  assert.equal(sale.originalPrice.amount, standaloneCosmetics.reduce((sum, offer) => sum + offer.price.amount, 0));
  assert.equal(sale.bundleValue.bonusCurrencies.coins, sale.grants.find(grant => grant.kind === 'currency').amount);
  assert.equal(sale.price.amount, offers.find(offer => offer.id === sale.id).price.amount);
  assert.equal(sale.discountPercent, null);
  const [first, second] = await Promise.all([
    service.purchaseVirtual({
      userId: 7,
      offerId: "ironbound-arsenal",
      idempotencyKey: "bundle-request-1",
    }),
    service.purchaseVirtual({
      userId: 7,
      offerId: "ironbound-arsenal",
      idempotencyKey: "bundle-request-2",
    }),
  ]);

  assert.equal([first, second].filter((result) => result.duplicate).length, 1);
  const stored = db.state.users.get(7);
  assert.equal(stored.gems, 250 - sale.price.amount);
  assert.equal(JSON.parse(db.state.redemptions[0].price_snapshot).amount, sale.price.amount);
  assert.equal(stored.coins, 500);
  assert.ok(db.state.skins.get(7).has("thorg-iron"));
  assert.ok(db.state.cards.get(7).has("shuriken-strike"));
  assert.equal(stored.selected_card_id, "default");
  assert.equal(
    JSON.parse(stored.selected_skin_id_by_char).thorg,
    "thorg-default",
  );
});

test("insufficient funds roll back the complete offer", async () => {
  const { db, service } = createFixture({ gems: 0 });
  const sale = (await service.buildBootstrap({ user_id: 7 })).sections.sales.find(item => item.id === "ironbound-arsenal");
  db.state.users.get(7).gems = sale.price.amount - 1;
  await assert.rejects(
    service.purchaseVirtual({
      userId: 7,
      offerId: "ironbound-arsenal",
      idempotencyKey: "bundle-too-expensive",
    }),
    (error) => error.code === "insufficient_funds",
  );
  assert.equal(db.state.users.get(7).gems, sale.price.amount - 1);
  assert.equal(db.state.users.get(7).coins, 0);
  assert.equal(db.state.redemptions.length, 0);
  assert.equal(db.state.skins.get(7).size, 0);
});

test("Shuriken Strike charges its catalog gem price and never charges coins or equips itself", async () => {
  const price = require('../src/server/services/shop/shopCatalog').getShopCatalog().offers.find(offer => offer.id === 'card-shuriken-strike').price.amount;
  const { db, service } = createFixture({ gems: price, coins: 123 });
  await service.purchaseVirtual({
    userId: 7,
    offerId: "card-shuriken-strike",
    idempotencyKey: "card-purchase-1",
  });
  const stored = db.state.users.get(7);
  assert.equal(stored.gems, 0);
  assert.equal(stored.coins, 123);
  assert.equal(stored.selected_card_id, "default");
  assert.ok(db.state.cards.get(7).has("shuriken-strike"));
});

test("concurrent daily claims grant the current reward only once", async () => {
  const { db, service } = createFixture({ gems: 0, coins: 0 });
  const [first, second] = await Promise.all([
    service.claimDaily({ userId: 7, idempotencyKey: "daily-request-1" }),
    service.claimDaily({ userId: 7, idempotencyKey: "daily-request-2" }),
  ]);
  const actual = [first, second].find((result) => !result.duplicate);
  assert.equal([first, second].filter((result) => result.duplicate).length, 1);
  const grant = actual.grants[0];
  assert.equal(db.state.users.get(7)[grant.currency], grant.amount);
  assert.equal(db.state.redemptions.length, 1);
});

test('rotating card offers charge the displayed sale price and keep the wood default equipped', async () => {
  const catalog = require('../src/server/services/shop/shopCatalog').getShopCatalog();
  const offers = catalog.offers.filter(offer => catalog.rotation.sales.promotedOfferIds.includes(offer.id) && offer.grants.length === 1 && offer.grants[0].kind === 'card');
  assert.ok(offers.length > 0);
  for (const offer of offers) {
    const { db, service } = createFixture({ gems: offer.price.amount, coins: 123 });
    const sale = (await service.buildBootstrap({ user_id: 7 })).sections.sales.find(item => item.id === offer.id);
    const price = sale?.price.amount ?? offer.price.amount;
    if (sale) {
      assert.ok(price < sale.originalPrice.amount);
      assert.equal(sale.rarity, offer.rarity);
      const bootstrap = await service.buildBootstrap({ user_id: 7 });
      assert.ok(!bootstrap.sections.profile.some(item => item.offerId === offer.id));
    }
    const args = { userId: 7, offerId: offer.id, idempotencyKey: `purchase:${offer.id}` };
    await service.purchaseVirtual(args);
    const repeat = await service.purchaseVirtual(args);
    assert.equal(repeat.duplicate, true);
    assert.equal(db.state.users.get(7).gems, offer.price.amount - price);
    assert.equal(db.state.users.get(7).coins, 123);
    assert.equal(db.state.users.get(7).selected_card_id, 'default');
    assert.ok(db.state.cards.get(7).has(offer.grants[0].id));
    assert.equal(db.state.redemptions.length, 1);
  }
});

test('sale purchases reject a stale displayed price', async () => {
  const { db, service } = createFixture();
  const sale = (await service.buildBootstrap({ user_id: 7 })).sections.sales.find(item => item.id === 'ironbound-arsenal');
  await assert.rejects(service.purchaseVirtual({
    userId: 7,
    offerId: sale.id,
    expectedPrice: sale.originalPrice.amount,
    idempotencyKey: 'stale-sale-price',
  }), error => error.code === 'price_changed');
  assert.equal(db.state.redemptions.length, 0);
});

function configurableFixture() {
  const catalog = structuredClone(require('../src/server/services/shop/shopCatalog').getShopCatalog());
  const { db, user } = createFixture({ gems: 10000 });
  return { catalog, db, user, service: createShopService({ db, catalogProvider: () => catalog }) };
}

test('catalog sections display bundles and promoted skins only once at the charged price', async () => {
  const { catalog, service, user, db } = configurableFixture();
  const bundle = catalog.offers.find(offer => offer.kind === 'bundle');
  bundle.section = 'profile';
  catalog.rotation.sales.pinnedOfferIds = ['skin-thorg-iron'];
  const bootstrap = await service.buildBootstrap(user);
  assert.deepEqual(bootstrap.sectionMeta, catalog.sections);
  assert.ok(bootstrap.sections.profile.some(item => item.id === bundle.id && item.grants.length === bundle.grants.length));
  assert.ok(!bootstrap.sections.skins.some(item => item.id === 'skin-thorg-iron'));
  const sale = bootstrap.sections.sales.find(item => item.id === 'skin-thorg-iron');
  const before = db.state.users.get(user.user_id).gems;
  await service.purchaseVirtual({ userId: user.user_id, offerId: sale.id, expectedPrice: sale.price.amount, expectedCurrency: sale.price.currency, idempotencyKey: 'promoted-skin-test' });
  assert.equal(db.state.users.get(user.user_id).gems, before - sale.price.amount);
});

test('bundle ownership preserves currency bonuses and values only unowned cosmetics', async () => {
  const { catalog, service, user, db } = configurableFixture();
  const bundle = catalog.offers.find(offer => offer.kind === 'bundle');
  delete bundle.eligibility;
  for (const grant of bundle.grants) {
    if (grant.kind === 'skin') db.state.skins.get(user.user_id).add(grant.id);
    if (grant.kind === 'card') db.state.cards.get(user.user_id).add(grant.id);
  }
  const sale = (await service.buildBootstrap(user)).sections.sales.find(item => item.id === bundle.id);
  assert.equal(sale.state.owned, false);
  assert.equal(sale.state.available, true);
  assert.equal(sale.bundleValue.cosmeticPrice.amount, 0);
  await service.purchaseVirtual({ userId: user.user_id, offerId: bundle.id, idempotencyKey: 'owned-bundle-bonus' });
  const after = (await service.buildBootstrap(user)).sections.sales.find(item => item.id === bundle.id);
  assert.equal(after.state.available, false);
  assert.equal(after.state.purchased, true);
  assert.equal(db.state.users.get(user.user_id).coins, bundle.grants.find(grant => grant.currency === 'coins').amount);
});

test('free daily claims work with negative wallet balances', async () => {
  const { service, db, user } = createFixture({ gems: -50, coins: -100 });
  const result = await service.claimDaily({ userId: user.user_id, idempotencyKey: 'negative-wallet-daily' });
  for (const currency of ['coins', 'gems']) {
    const total = result.grants.filter(grant => grant.currency === currency).reduce((sum, grant) => sum + grant.amount, 0);
    assert.equal(db.state.users.get(user.user_id)[currency], user[currency] + total);
  }
});

test('purchase retries use their receipt after price changes but new requests reject stale currency', async () => {
  const { catalog, service, user, db } = configurableFixture();
  const offer = catalog.offers.find(offer => offer.kind === 'item');
  const request = { userId: user.user_id, offerId: offer.id, expectedPrice: offer.price.amount, expectedCurrency: offer.price.currency, idempotencyKey: 'price-retry-test' };
  await service.purchaseVirtual(request);
  offer.price.amount += 10;
  const retry = await service.purchaseVirtual(request);
  assert.equal(retry.duplicate, true);
  assert.equal(db.state.redemptions.length, 1);
  const next = catalog.offers.find(entry => entry.kind === 'item' && entry.id !== offer.id);
  await assert.rejects(service.purchaseVirtual({ ...request, offerId: next.id, expectedPrice: next.price.amount, expectedCurrency: 'coins', idempotencyKey: 'stale-currency-test' }), error => error.code === 'price_changed');
});

test('bundles can opt into a sale discount and inactive sales cannot be purchased directly', async () => {
  const { catalog, service, user } = configurableFixture();
  const bundle = catalog.offers.find(offer => offer.kind === 'bundle');
  bundle.saleDiscountPercent = 30;
  const sale = (await service.buildBootstrap(user)).sections.sales.find(item => item.id === bundle.id);
  assert.ok(sale.price.amount < bundle.price.amount);
  assert.deepEqual(sale.originalPrice, bundle.price);
  await service.purchaseVirtual({ userId: user.user_id, offerId: bundle.id, expectedPrice: sale.price.amount, idempotencyKey: 'discounted-bundle' });
  catalog.rotation.sales.pinnedOfferIds = [];
  await assert.rejects(service.purchaseVirtual({ userId: user.user_id, offerId: bundle.id, idempotencyKey: 'inactive-bundle' }), error => error.code === 'offer_unavailable');
});

test('grant failures roll back the wallet, receipt and earlier bundle grants', async () => {
  const { service, db, user } = createFixture();
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    if (sql.startsWith('INSERT IGNORE INTO user_cards')) throw new Error('grant failure');
    return query(sql, params);
  };
  await assert.rejects(service.purchaseVirtual({ userId: user.user_id, offerId: 'ironbound-arsenal', idempotencyKey: 'failing-bundle-grant' }), /grant failure/);
  assert.equal(db.state.users.get(user.user_id).gems, user.gems);
  assert.equal(db.state.redemptions.length, 0);
  assert.equal(db.state.ledger.length, 0);
  assert.equal(db.state.skins.get(user.user_id).size, 0);
});

test('checkout status displays saved reward snapshots without depending on the current offer', async () => {
  const { createStripeShopService } = require('../src/server/services/shop/stripeShopService');
  const { service } = createFixture();
  const db = { runQuery: async sql => {
    if (sql.startsWith('SELECT * FROM shop_orders')) return [{ order_id: 'saved', reward_snapshot: JSON.stringify([{ kind: 'currency', currency: 'gems', amount: 123 }]) }];
    if (sql.startsWith('SELECT order_id')) return [{ order_id: 'saved', offer_id: 'removed-offer', status: 'fulfilled' }];
    return [{ coins: 0, gems: 123 }];
  } };
  const stripe = createStripeShopService({ db, shopService: service, stripeClient: {} });
  const result = await stripe.getCheckoutStatus({ userId: 7, sessionId: 'session-saved' });
  assert.equal(result.grants[0].amount, 123);
  assert.equal(result.grants[0].name, 'Gems');
  assert.ok(result.grants[0].image);
});


test('bundle receipts distinguish purchased bundles from ownership-blocked offers', async () => {
  const { service, db, user } = createFixture();
  const offerId = 'ironbound-arsenal';
  const getState = async () => (await service.buildBootstrap(user)).sections.sales.find(item => item.id === offerId).state;
  assert.equal((await getState()).purchased, false);
  await service.purchaseVirtual({ userId: user.user_id, offerId, idempotencyKey: 'purchased-bundle-label' });
  const purchased = await getState();
  assert.equal(purchased.purchased, true);
  assert.equal(purchased.available, false);
  assert.equal(purchased.owned, false, 'currency bonuses do not count as owned collectibles');
  db.state.redemptions = [];
  const blocked = await getState();
  assert.equal(blocked.purchased, false, 'owning the skin alone does not imply a bundle purchase');
  assert.equal(blocked.available, false);
});


test("viewed Shop items persist across service instances and refreshes remain independently unread", async () => {
  const { db, service, user } = createFixture();
  const first = await service.buildBootstrap(user);
  const sale = first.sections.sales.find(item => item.isNew);
  assert.ok(sale);
  assert.equal(first.notifications.sections.sales.refreshed, true);
  const rotations = Object.fromEntries(Object.entries(first.rotations).filter(([key]) => ['sales', 'dailies'].includes(key)).map(([key, value]) => [key, value.cycleKey]));
  await service.markViewed({ userId: user.user_id, rotations, offerIds: [sale.id] });
  await service.markViewed({ userId: user.user_id, rotations, offerIds: [sale.id] });
  assert.equal(db.state.views.filter(row => row.view_kind === 'offer').length, 1);
  const otherDevice = createShopService({ db });
  const viewed = await otherDevice.buildBootstrap(user);
  assert.equal(viewed.sections.sales.find(item => item.id === sale.id).isNew, false);
  assert.equal(viewed.notifications.sections.sales.refreshed, false);
  assert.equal(viewed.notifications.sections.dailies.refreshed, false);
  assert.ok(viewed.notifications.sections.sales.offerIds.length > 0);
  await service.rotationService.forceRefresh('sales', user.user_id);
  await service.rotationService.forceRefresh('dailies', user.user_id);
  // A stale device cannot clear the new rotation.
  await service.markViewed({ userId: user.user_id, rotations, offerIds: [] });
  const refreshed = await otherDevice.buildBootstrap(user);
  assert.equal(refreshed.notifications.sections.sales.refreshed, true);
  assert.equal(refreshed.notifications.sections.dailies.refreshed, true);
  assert.ok(!refreshed.notifications.sections.sales.offerIds.includes(sale.id));
  assert.equal(db.state.views.filter(row => row.user_id !== user.user_id).length, 0);
});

test("viewed Shop state rejects unknown offers and sections before writing", async () => {
  const { db, service, user } = createFixture();
  for (const payload of [{ offerIds: ['unknown'] }, { offerIds: 'invalid' }, { rotations: { skins: 'invalid' } }]) {
    await assert.rejects(service.markViewed({ userId: user.user_id, ...payload }), error => error.code === 'invalid_views');
  }
  assert.equal(db.state.views.length, 0);
});

test("newly added offers are unread while price edits and owned cards do not become new", async () => {
  const { db, user } = createFixture();
  const catalog = structuredClone(require('../src/server/services/shop/shopCatalog').getShopCatalog());
  const service = createShopService({ db, catalogProvider: () => catalog });
  const before = await service.buildBootstrap(user);
  const offers = Object.values(before.sections).flat().filter(item => item.isNew).map(item => item.id);
  const rotations = Object.fromEntries(['sales', 'dailies'].map(key => [key, before.rotations[key].cycleKey]));
  await service.markViewed({ userId: user.user_id, rotations, offerIds: offers });
  const existing = catalog.offers.find(offer => offer.id === offers[0]);
  existing.price.amount += 1;
  assert.equal((await service.buildBootstrap(user)).notifications.hasNew, false);
  const added = structuredClone(catalog.offers.find(offer => offer.section === 'currency'));
  added.id = 'new-test-pack';
  catalog.offers.push(added);
  const after = await service.buildBootstrap(user);
  assert.equal(after.sections.currency.find(item => item.id === added.id).isNew, true);
  assert.equal(after.notifications.sections.currency.hasNew, true);
  assert.ok(Object.values(after.sections).flat().filter(item => item.state.owned).every(item => !item.isNew));
});
