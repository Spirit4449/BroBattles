const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  getShopCatalog,
  getShopCatalogErrors,
  validateCatalog,
} = require("../src/server/helpers/shopCatalog");

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
    amount: 20,
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
