const { createTransactionalDb } = require('./fakeDb');

class CommerceFakeDb {
  constructor(user) {
    this.runQuery = this.runQuery.bind(this);
    const state = {
      users: new Map([[user.user_id, structuredClone(user)]]),
      skins: new Map([[user.user_id, new Set()]]),
      cards: new Map([[user.user_id, new Set(["default"])]]),
      titles: new Map([[user.user_id, new Set()]]),
      icons: new Map([[user.user_id, new Set()]]),
      redemptions: [],
      views: [],
      ledger: [],
      rotations: new Map(),
      nextRedemptionId: 1,
    };
    this.db = createTransactionalDb({ state, query: (_state, sql, params) => this.query(sql, params) });
  }

  get state() {
    return this.db.state;
  }

  withTransaction(fn) {
    return this.db.withTransaction(fn);
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
    if (sql.startsWith("INSERT INTO shop_rotation_state")) {
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
    if (sql.startsWith("SELECT title_id FROM user_titles")) {
      return [...(this.state.titles.get(params[0]) || [])].map(title_id => ({ title_id }));
    }
    if (sql.startsWith("INSERT IGNORE INTO user_titles")) {
      this.state.titles.get(params[0]).add(String(params[1]));
      return { affectedRows: 1 };
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
      for (let i = 0; i < params.length; i += 3) {
        this.state.skins.get(params[i]).add(String(params[i + 1]));
      }
      return { affectedRows: params.length / 3 };
    }
    if (sql.startsWith("INSERT IGNORE INTO user_cards")) {
      this.state.cards.get(params[0]).add(String(params[1]));
      return { affectedRows: 1 };
    }
    if (sql.startsWith("INSERT IGNORE INTO user_profile_icons")) {
      for (let i = 0; i < params.length; i += 3) {
        this.state.icons.get(params[i]).add(String(params[i + 1]));
      }
      return { affectedRows: params.length / 3 };
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

// Synthetic offers preserve bundle/skin commerce coverage independently of live inventory.
// The live profile section shows a weekly window of its offers, chosen from the real date.
// Tests turn that off unless they are about rotation, so every profile offer is purchasable
// whatever the week and however many profile offers the live catalog has.

module.exports = { CommerceFakeDb };
