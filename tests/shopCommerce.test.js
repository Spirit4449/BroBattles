const test = require("node:test");
const assert = require("node:assert/strict");

const { createShopService } = require("../src/server/services/shopService");

class CommerceFakeDb {
  constructor(user) {
    this.state = {
      users: new Map([[user.user_id, structuredClone(user)]]),
      skins: new Map([[user.user_id, new Set()]]),
      cards: new Map([[user.user_id, new Set(["default"])]]),
      icons: new Map([[user.user_id, new Set()]]),
      redemptions: [],
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
    if (sql.startsWith("SELECT coins, gems FROM users")) {
      return user ? [{ coins: user.coins, gems: user.gems }] : [];
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
  assert.equal(stored.gems, 0);
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
  const { db, service } = createFixture({ gems: 249 });
  await assert.rejects(
    service.purchaseVirtual({
      userId: 7,
      offerId: "ironbound-arsenal",
      idempotencyKey: "bundle-too-expensive",
    }),
    (error) => error.code === "insufficient_funds",
  );
  assert.equal(db.state.users.get(7).gems, 249);
  assert.equal(db.state.users.get(7).coins, 0);
  assert.equal(db.state.redemptions.length, 0);
  assert.equal(db.state.skins.get(7).size, 0);
});

test("Shuriken Strike costs 20 gems and never charges coins or equips itself", async () => {
  const { db, service } = createFixture({ gems: 20, coins: 123 });
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
