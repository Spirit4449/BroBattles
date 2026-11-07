const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe("Catalog validation and pricing", () => {
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

    const thorg = require('../src/shared/catalogs/skinsCatalog.json').characters.thorg;
    assert.deepEqual(thorg.skins.map(skin => skin.id), [thorg.defaultSkinId]);
    const { resolveSelectedSkinId } = require('../src/server/services/cosmetics/skinsCatalog');
    assert.equal(resolveSelectedSkinId({ character: 'thorg',
      selectedSkinMap: { thorg: 'retired-thorg-skin' },
      ownedSkinIds: ['retired-thorg-skin', thorg.defaultSkinId] }), thorg.defaultSkinId);

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
    catalog.rotation.sales.pinnedOfferIds = [item.id, item.id];
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
});

describe("Eastern calendar rotation", () => {
  const {
    createShopRotationService,
    getNaturalCycle,
  } = require("../src/server/services/shop/shopRotationService");

  test("daily reset follows Eastern midnight across spring DST", () => {
    const before = getNaturalCycle(
      "dailies",
      new Date("2026-03-08T04:59:00.000Z"),
    );
    const after = getNaturalCycle(
      "dailies",
      new Date("2026-03-08T05:01:00.000Z"),
    );

    assert.equal(before.periodKey, "day:2026-03-07");
    assert.equal(before.nextRefreshAt.toISOString(), "2026-03-08T05:00:00.000Z");
    assert.equal(after.periodKey, "day:2026-03-08");
    assert.equal(after.nextRefreshAt.toISOString(), "2026-03-09T04:00:00.000Z");
  });

  test("daily reset follows Eastern midnight across fall DST", () => {
    const before = getNaturalCycle(
      "dailies",
      new Date("2026-11-01T03:59:00.000Z"),
    );
    const after = getNaturalCycle(
      "dailies",
      new Date("2026-11-01T04:01:00.000Z"),
    );

    assert.equal(before.periodKey, "day:2026-10-31");
    assert.equal(before.nextRefreshAt.toISOString(), "2026-11-01T04:00:00.000Z");
    assert.equal(after.periodKey, "day:2026-11-01");
    assert.equal(after.nextRefreshAt.toISOString(), "2026-11-02T05:00:00.000Z");
  });

  test("sales reset at Monday midnight Eastern", () => {
    const sunday = getNaturalCycle(
      "sales",
      new Date("2026-08-31T03:59:00.000Z"),
    );
    const monday = getNaturalCycle(
      "sales",
      new Date("2026-08-31T04:01:00.000Z"),
    );

    assert.equal(sunday.periodKey, "week:2026-08-24");
    assert.equal(sunday.nextRefreshAt.toISOString(), "2026-08-31T04:00:00.000Z");
    assert.equal(monday.periodKey, "week:2026-08-31");
    assert.equal(monday.nextRefreshAt.toISOString(), "2026-09-07T04:00:00.000Z");
  });

  test("manual refresh advances the global generation without changing the natural reset", async () => {
    let row = null;
    const db = {
      withTransaction: async (fn) =>
        fn(null, async (sql, params) => {
          if (sql.startsWith("INSERT IGNORE INTO shop_rotation_state")) {
            if (!row) {
              row = {
                section: params[0],
                period_key: params[1],
                generation: 0,
                refreshed_at: new Date("2026-08-31T12:00:00.000Z"),
              };
            }
            return { affectedRows: row ? 0 : 1 };
          }
          if (sql.startsWith("SELECT * FROM shop_rotation_state")) return [row];
          if (sql.includes("generation = generation + 1")) {
            row = {
              ...row,
              period_key: params[0],
              generation: Number(row.generation) + 1,
              refreshed_at: new Date("2026-08-31T12:00:00.000Z"),
            };
            return { affectedRows: 1 };
          }
          if (sql.startsWith("UPDATE shop_rotation_state SET period_key")) {
            row = { ...row, period_key: params[0], generation: 0 };
            return { affectedRows: 1 };
          }
          throw new Error(`Unexpected SQL in test: ${sql}`);
        }),
    };
    const service = createShopRotationService({ db });
    const now = new Date("2026-08-31T12:00:00.000Z");
    const initial = await service.ensure("sales", now);
    const refreshed = await service.forceRefresh("sales", 42, now);

    assert.equal(initial.cycleKey, "week:2026-08-31:g0");
    assert.equal(refreshed.cycleKey, "week:2026-08-31:g1");
    assert.equal(refreshed.nextRefreshAt, initial.nextRefreshAt);
    await service.forceRefresh("sales", 42, now);
    const nextWeek = await service.forceRefresh("sales", 42, new Date("2026-09-07T12:00:00.000Z"));
    assert.equal(nextWeek.cycleKey, "week:2026-09-07:g1", "manual refresh resets the previous period generation first");
  });
});
