const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  getShopCatalog,
  getShopCatalogErrors,
  validateCatalog,
} = require("../src/server/services/shop/shopCatalog");

test("the production shop catalog has the expected offers and no validation errors", () => {
  const catalog = getShopCatalog();
  assert.deepEqual(getShopCatalogErrors(), []);

  const byId = new Map(catalog.offers.map((offer) => [offer.id, offer]));
  assert.equal(catalog.timezone, "America/New_York");
  assert.deepEqual(
    catalog.rotation.dailies.rewards.map((reward) => reward.grants[0]),
    [
      { kind: "currency", currency: "coins", amount: 75 },
      { kind: "currency", currency: "gems", amount: 5 },
    ],
  );

  assert.deepEqual(byId.get("ironbound-arsenal").price, {
    type: "virtual",
    currency: "gems",
    amount: 250,
  });
  assert.deepEqual(byId.get("ironbound-arsenal").grants, [
    { kind: "skin", id: "thorg-iron" },
    { kind: "card", id: "shuriken-strike" },
    { kind: "currency", currency: "coins", amount: 500 },
  ]);
  assert.equal(byId.get("skin-thorg-iron").price.amount, 250);
  assert.deepEqual(byId.get("card-shuriken-strike").price, {
    type: "virtual",
    currency: "gems",
    amount: require('../src/shared/catalogs/playerCardsCatalog.json').cards.find(card => card.id === 'shuriken-strike').cost.gems,
  });
  assert.deepEqual(
    [
      "coins-1000-usd",
      "gems-250-usd",
      "gems-700-usd",
      "gems-1500-usd",
    ].map((id) => byId.get(id).price.amountCents),
    [99, 199, 499, 999],
  );

  for (const offer of catalog.offers) {
    assert.match(offer.banner, /^\/assets\/shop\/banners\/[a-z0-9-]+\.webp$/);
    assert.ok(
      fs.existsSync(path.join(__dirname, "..", "public", offer.banner)),
      `missing banner for ${offer.id}`,
    );
  }
  for (const reward of catalog.rotation.dailies.rewards) {
    assert.ok(fs.existsSync(path.join(__dirname, "..", "public", reward.banner)));
  }
});

test("invalid prices and cosmetic references fail validation", () => {
  const valid = getShopCatalog();
  const fixture = JSON.parse(JSON.stringify(valid));
  fixture.offers[0].price.amount = 0;
  fixture.offers[1].grants = [{ kind: "skin", id: "missing-skin" }];
  fixture.rotation.dailies.rewards[0].grants = [];

  const errors = validateCatalog(fixture);
  assert.ok(errors.some((error) => error.includes("invalid virtual price")));
  assert.ok(errors.some((error) => error.includes("unknown skin missing-skin")));
  assert.ok(
    errors.some((error) =>
      error.includes("daily reward 0: at least one grant is required"),
    ),
  );
});

test('wood is the free still default and the new animated cards have rotating gem offers', () => {
  const cards = require('../src/shared/catalogs/playerCardsCatalog.json');
  const shop = getShopCatalog();
  const defaultCard = cards.cards.find(card => card.id === cards.defaultCardId);
  assert.equal(defaultCard.id, 'default');
  assert.equal(defaultCard.animationUrl, undefined);
  assert.equal(defaultCard.cost.gems, 0);
  assert.ok(!cards.cards.some(card => card.id === 'sorcerers-decree'));
  assert.ok(!shop.offers.some(offer => offer.id === 'card-sorcerers-decree'));
  assert.ok(!shop.rotation.sales.promotedOfferIds.includes('card-sorcerers-decree'));
  const ids = ['radiant-silver', 'radiant-diamond', 'radiant-emerald', 'radiant-gold', 'radiant-ruby', 'mjolnirs-anvil', 'wizard-spell', 'astral-amethyst'];
  for (const id of ids) {
    const card = cards.cards.find(card => card.id === id);
    const offer = shop.offers.find(offer => offer.grants.length === 1 && offer.grants[0].kind === 'card' && offer.grants[0].id === id);
    assert.ok(card.animationUrl && card.animationAppleUrl, `${id} supports both video formats`);
    assert.equal(offer.price.currency, 'gems');
    assert.equal(offer.price.amount, card.cost.gems);
    assert.equal(offer.rarity, card.rarity);
    assert.ok(shop.rotation.sales.promotedOfferIds.includes(offer.id), `${id} participates in rotation`);
  }
  assert.ok(!shop.offers.some(offer => offer.grants.some(grant => grant.kind === 'card' && grant.id === defaultCard.id)));
});

test("money offers cannot grant cosmetics", () => {
  const fixture = JSON.parse(JSON.stringify(getShopCatalog()));
  const offer = fixture.offers.find((entry) => entry.price.type === "money");
  offer.grants.push({ kind: "card", id: "shuriken-strike" });

  assert.ok(
    validateCatalog(fixture).some((error) =>
      error.includes("real-money offers must grant currency only"),
    ),
  );
});

test("missing or external banner art fails closed", () => {
  const fixture = JSON.parse(JSON.stringify(getShopCatalog()));
  fixture.offers[0].banner = "https://example.com/not-local.png";
  fixture.rotation.dailies.rewards[0].banner =
    "/assets/shop/banners/does-not-exist.webp";

  const errors = validateCatalog(fixture);
  assert.ok(errors.some((error) => error.includes("invalid shop banner path")));
  assert.ok(errors.some((error) => error.includes("shop banner asset is missing")));
});


test('malformed sale settings report errors instead of crashing validation', () => {
  for (const value of [null, {}, 2, 'bad']) {
    const catalog = structuredClone(getShopCatalog());
    catalog.rotation.sales.promotedOfferIds = value;
    assert.ok(validateCatalog(catalog).some(error => error.includes('promotedOfferIds must be an array')));
  }
});

test('catalog validation rejects ambiguous grants, unsupported limits and unsafe amounts', () => {
  const catalog = structuredClone(getShopCatalog());
  const item = catalog.offers.find(offer => offer.kind === 'item');
  item.grants.push(item.grants[0]);
  item.price.amount = Number.MAX_SAFE_INTEGER + 1;
  const money = catalog.offers.find(offer => offer.price.type === 'money');
  money.purchaseLimit = 'lifetime';
  catalog.rotation.sales.promotedCount = -1;
  catalog.rotation.sales.pinnedOfferIds.push(catalog.rotation.sales.pinnedOfferIds[0]);
  const errors = validateCatalog(catalog);
  for (const expected of ['duplicate grants', 'invalid virtual price', 'real-money offers require unlimited', 'promotedCount', 'duplicate offers']) {
    assert.ok(errors.some(error => error.includes(expected)), expected);
  }
});

test('sale prices and selection are reusable catalog rules with optional discounts', () => {
  const { getSaleOfferIds, getSalePrice } = require('../src/server/services/shop/shopOfferRules');
  const catalog = { rotation: { sales: { pinnedOfferIds: ['a'], promotedOfferIds: ['a', 'b', 'b', 'c'], promotedCount: 2, discountPercent: 20 } } };
  assert.deepEqual(getSaleOfferIds(catalog, { ordinal: 0 }), ['a', 'b', 'c']);
  const offer = { kind: 'item', price: { type: 'virtual', currency: 'gems', amount: 1 } };
  assert.equal(getSalePrice(offer, catalog).amount, 1);
  offer.price.amount = 100;
  offer.saleDiscountPercent = 0;
  assert.deepEqual(getSalePrice(offer, catalog), offer.price);
  offer.saleDiscountPercent = 40;
  assert.equal(getSalePrice(offer, catalog).amount, 60);
});
