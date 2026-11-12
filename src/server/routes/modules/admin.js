const path = require("path");

function registerAdminRoutes({
  app,
  db,
  auth,
  pageRoot,
  distDir,
  runtimeConfig,
  shopService,
  stripeShopService,
}) {
  const { requireAdminUser } = auth;

  function sendUnauthorized(res) {
    return res
      .status(403)
      .json({ success: false, error: "Admin access required" });
  }

  app.get("/admin", async (req, res) => {
    const user = await requireAdminUser(req, res);
    if (!user) {
      if (!req.signedCookies?.user_id) {
        return res.redirect(302, "/login?next=/admin");
      }
      return res.status(403).send("<h1>403</h1><p>Admin access required.</p>");
    }
    const root = path.join(pageRoot || distDir, "admin.html");
    return res.sendFile(root);
  });

  app.get("/api/admin/bootstrap", async (req, res) => {
    const user = await requireAdminUser(req, res);
    if (!user) return sendUnauthorized(res);
    try {
      const [{ users = 0 }] = await db.runQuery(
        "SELECT COUNT(*) AS users FROM users"
      );
      const [{ guests = 0 }] = await db.runQuery(
        "SELECT COUNT(*) AS guests FROM users WHERE expires_at > NOW()"
      );
      const [{ parties = 0 }] = await db.runQuery(
        "SELECT COUNT(*) AS parties FROM parties"
      );
      const [{ live_matches = 0 }] = await db.runQuery(
        "SELECT COUNT(*) AS live_matches FROM matches WHERE status = 'live'"
      );
      const recentMatches = await db.runQuery(
        "SELECT match_id, status, mode, map, created_at FROM matches ORDER BY match_id DESC LIMIT 6"
      );
      const recentUsers = await db.runQuery(
        `SELECT user_id, name, coins, gems, trophies, status, char_class,
                selected_profile_icon_id, expires_at, created_at
           FROM users
          ORDER BY updated_at DESC
          LIMIT 6`
      );
      const runtimeData =
        runtimeConfig && typeof runtimeConfig.get === "function"
          ? runtimeConfig.get()
          : runtimeConfig || {};
      let shop = null;
      try {
        shop = {
          ...(await shopService.getAdminStatus()),
          payment: stripeShopService.getConfigurationStatus(),
        };
      } catch (error) {
        shop = {
          error: error?.message || "Shop schema is unavailable",
          payment: stripeShopService.getConfigurationStatus(),
        };
      }
      return res.json({
        success: true,
        admin: { name: user.name, userId: user.user_id },
        stats: {
          users,
          guests,
          parties,
          live_matches,
        },
        recentMatches,
        recentUsers,
        runtime: runtimeData,
        shop,
      });
    } catch (err) {
      console.error("[admin] bootstrap error", err);
      return res
        .status(500)
        .json({ success: false, error: "Failed to load admin dashboard" });
    }
  });

  const userFields = `user_id, name, coins, gems, trophies, trophy_peak, status,
    char_class, char_levels, expires_at, created_at, updated_at,
    selected_card_id, selected_profile_icon_id, selected_skin_id_by_char,
    is_banned, banned_at, ban_reason, chat_suspended_until, mm_suspended_until`;
  const { LEVEL_CAP } = require("../../../shared/characters/characterStats");
  const { characterDefinitions } = require("../../../shared/characters");

  app.post("/api/admin/user-search", async (req, res) => {
    if (!await requireAdminUser(req, res)) return sendUnauthorized(res);
    try {
      const query = String(req.body?.query || "").trim().slice(0, 100);
      const page = Math.max(1, Math.min(100000, Number.parseInt(req.body?.page, 10) || 1));
      const where = /^[0-9]+$/.test(query) ? "user_id = ?" : "name LIKE ?";
      const value = /^[0-9]+$/.test(query) ? Number(query) : `%${query}%`;
      const [count] = await db.runQuery(`SELECT COUNT(*) AS total FROM users WHERE ${where}`, [value]);
      const users = await db.runQuery(`SELECT ${userFields} FROM users WHERE ${where} ORDER BY updated_at DESC, user_id DESC LIMIT 20 OFFSET ?`, [value, (page - 1) * 20]);
      return res.json({ success: true, users, total: count.total, page });
    } catch (err) {
      console.error("[admin] search", err);
      return res.status(500).json({ success: false, error: "Unable to search players" });
    }
  });

  app.get("/api/admin/users/:id", async (req, res) => {
    if (!await requireAdminUser(req, res)) return sendUnauthorized(res);
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid player ID" });
    try {
      const [user] = await db.runQuery(`SELECT ${userFields} FROM users WHERE user_id = ?`, [id]);
      if (!user) return res.status(404).json({ error: "Player not found" });
      const queries = {
        matches: `SELECT m.match_id, m.mode, m.map, m.status, m.created_at, m.winner_team, p.team, p.char_class, p.kills, p.damage, p.trophies_delta, p.coins_awarded, p.gems_awarded FROM match_participants p JOIN matches m ON m.match_id = p.match_id WHERE p.user_id = ? ORDER BY m.match_id DESC LIMIT 20`,
        orders: `SELECT order_id, offer_id, status, amount_cents, currency, created_at, fulfilled_at, last_error FROM shop_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
        currency: `SELECT currency, amount, source_type, created_at FROM shop_currency_ledger WHERE user_id = ? ORDER BY ledger_id DESC LIMIT 20`,
        moderation: `SELECT category, source, action_taken, offense_level, created_at FROM user_abuse_events WHERE user_id = ? ORDER BY event_id DESC LIMIT 20`,
      };
      const history = {};
      await Promise.all(Object.entries(queries).map(async ([key, sql]) => {
        try { history[key] = { rows: await db.runQuery(sql, [id]) }; }
        catch (error) { console.error(`[admin] ${key}`, error); history[key] = { error: "This history is temporarily unavailable" }; }
      }));
      return res.json({ success: true, user, history });
    } catch (error) {
      console.error("[admin] detail", error);
      return res.status(500).json({ error: "Unable to load player" });
    }
  });

  app.post("/api/admin/user-update", async (req, res) => {
    const admin = await requireAdminUser(req, res);
    if (!admin) return sendUnauthorized(res);
    const userId = Number(req.body?.userId);
    const changes = req.body?.changes;
    if (!Number.isSafeInteger(userId) || userId <= 0 || !changes || typeof changes !== "object" || Array.isArray(changes)) return res.status(400).json({ error: "Invalid update" });
    const sets = [], values = [];
    for (const [key, value] of Object.entries(changes)) {
      if (key === "char_levels") {
        if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length || Object.entries(value).some(([character, level]) => !Object.hasOwn(characterDefinitions, character) || !Number.isInteger(level) || level < 0 || level > LEVEL_CAP)) return res.status(400).json({ error: "Invalid character levels" });
        sets.push(`char_levels = JSON_SET(COALESCE(char_levels, '{}'), ${Object.keys(value).map(() => "?, ?").join(", ")})`);
        for (const [character, level] of Object.entries(value)) values.push(`$.${character}`, level);
        continue;
      }
      let valid = false;
      if (["coins", "gems", "trophies"].includes(key)) valid = Number.isInteger(value) && value >= 0 && value <= 2147483647;
      if (key === "name") valid = typeof value === "string" && value.trim() === value && value.length >= 3 && value.length <= 50 && !/[\x00-\x1f\x7f]/.test(value);
      if (key === "char_class") valid = Object.hasOwn(characterDefinitions, value);
      if (key === "status") valid = ["online", "idle", "ready", "offline"].includes(value);
      if (!valid) return res.status(400).json({ error: `Invalid value for ${key}` });
      sets.push(`${key} = ?`); values.push(value);
    }
    if (!sets.length) return res.status(400).json({ error: "No changes supplied" });
    try {
      await db.runQuery(`UPDATE users SET ${sets.join(", ")}, updated_at = NOW() WHERE user_id = ?`, [...values, userId]);
      const [user] = await db.runQuery(`SELECT ${userFields} FROM users WHERE user_id = ?`, [userId]);
      if (!user) return res.status(404).json({ error: "Player not found" });
      console.log(`[admin] ${admin.user_id} updated player ${userId}: ${Object.keys(changes).join(", ")}`);
      return res.json({ success: true, user });
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "That username is already in use" });
      console.error("[admin] update", error);
      return res.status(500).json({ error: "Unable to save player" });
    }
  });

  // Adds (or removes) coins and gems for one or more players in one
  // transaction. Balances never drop below zero; the ledger records the
  // amount actually applied, tagged with the admin and an optional note.
  const GRANT_LIMIT = 10_000_000;
  const MAX_GRANT_RECIPIENTS = 50;
  app.post("/api/admin/grant", async (req, res) => {
    const admin = await requireAdminUser(req, res);
    if (!admin) return sendUnauthorized(res);
    const body = req.body || {};
    const userIds = [...new Set(Array.isArray(body.userIds) ? body.userIds : [body.userId])];
    if (!userIds.length || userIds.length > MAX_GRANT_RECIPIENTS || userIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      return res.status(400).json({ error: `Choose between 1 and ${MAX_GRANT_RECIPIENTS} players` });
    }
    const amounts = {};
    for (const currency of ["coins", "gems"]) {
      const value = body[currency] ?? 0;
      if (!Number.isInteger(value) || Math.abs(value) > GRANT_LIMIT) {
        return res.status(400).json({ error: `${currency} must be a whole number up to ${GRANT_LIMIT.toLocaleString("en-US")}` });
      }
      if (value) amounts[currency] = value;
    }
    if (!Object.keys(amounts).length) return res.status(400).json({ error: "Enter an amount of coins or gems" });
    const note = typeof body.note === "string" ? body.note.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 40) : "";
    const batch = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    try {
      const users = await db.withTransaction(async (_conn, q) => {
        const rows = await q(`SELECT user_id, name, coins, gems FROM users WHERE user_id IN (${userIds.map(() => "?").join(", ")}) FOR UPDATE`, userIds);
        if (rows.length !== userIds.length) {
          const found = new Set(rows.map((row) => Number(row.user_id)));
          const error = new Error(`Player not found: #${userIds.filter((id) => !found.has(id)).join(", #")}`);
          error.status = 404;
          throw error;
        }
        const results = [];
        for (const row of rows) {
          const applied = {};
          const next = {};
          for (const currency of ["coins", "gems"]) {
            const before = Number(row[currency]) || 0;
            next[currency] = Math.min(2147483647, Math.max(0, before + (amounts[currency] || 0)));
            applied[currency] = next[currency] - before;
          }
          await q("UPDATE users SET coins = ?, gems = ?, updated_at = NOW() WHERE user_id = ?", [next.coins, next.gems, row.user_id]);
          for (const currency of ["coins", "gems"]) {
            if (!applied[currency]) continue;
            await q(
              "INSERT INTO shop_currency_ledger (user_id, currency, amount, source_type, source_id) VALUES (?, ?, ?, ?, ?)",
              [row.user_id, currency, applied[currency], "admin_grant", `${admin.user_id}:${batch}:${row.user_id}${note ? `:${note}` : ""}`.slice(0, 96)],
            );
          }
          results.push({ user_id: row.user_id, name: row.name, coins: next.coins, gems: next.gems, applied });
        }
        return results;
      });
      console.log(`[admin] ${admin.user_id} granted ${JSON.stringify(amounts)} to ${userIds.join(", ")}${note ? ` (${note})` : ""}`);
      return res.json({ success: true, users });
    } catch (error) {
      if (error.status === 404) return res.status(404).json({ error: error.message });
      console.error("[admin] grant", error);
      return res.status(500).json({ error: "Unable to grant currency" });
    }
  });

  app.get("/api/admin/grants", async (req, res) => {
    if (!await requireAdminUser(req, res)) return sendUnauthorized(res);
    try {
      const rows = await db.runQuery(
        `SELECT l.ledger_id, l.user_id, u.name, l.currency, l.amount, l.source_id, l.created_at
           FROM shop_currency_ledger l LEFT JOIN users u ON u.user_id = l.user_id
          WHERE l.source_type = 'admin_grant'
          ORDER BY l.ledger_id DESC LIMIT 30`,
      );
      return res.json({ success: true, grants: rows.map(({ source_id, ...row }) => ({ ...row, note: String(source_id || "").split(":").slice(3).join(":") })) });
    } catch (error) {
      console.error("[admin] grants", error);
      return res.status(500).json({ error: "Grant history is unavailable" });
    }
  });

  app.post("/api/admin/runtime", async (req, res) => {
    const admin = await requireAdminUser(req, res);
    if (!admin) return sendUnauthorized(res);
    try {
      const body = req.body || {};
      const patch = {};
      if (typeof body.maintenanceUntil !== "undefined") {
        const until = body.maintenanceUntil;
        if (until !== null && (typeof until !== "string" || !Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.now())) return res.status(400).json({ error: "Choose a maintenance end time in the future" });
        patch.maintenanceUntil = until === null ? null : new Date(until).toISOString();
        patch.maintenanceMode = until !== null;
      }
      if (typeof body.announcements !== "undefined") {
        if (typeof body.announcements !== "string" || body.announcements.length > 500) return res.status(400).json({ error: "Announcement must be at most 500 characters" });
        patch.announcements = body.announcements.trim();
      }
      if (
        body.rewardMultipliers &&
        typeof body.rewardMultipliers === "object"
      ) {
        patch.rewardMultipliers = {};
        if (typeof body.rewardMultipliers.coins !== "undefined") {
          const c = Number(body.rewardMultipliers.coins);
          if (Number.isFinite(c) && c > 0) patch.rewardMultipliers.coins = c;
        }
        if (typeof body.rewardMultipliers.gems !== "undefined") {
          const g = Number(body.rewardMultipliers.gems);
          if (Number.isFinite(g) && g > 0) patch.rewardMultipliers.gems = g;
        }
      }
      if (typeof body.rewardFloor !== "undefined") {
        const floor = Number(body.rewardFloor);
        if (Number.isFinite(floor)) patch.rewardFloor = floor;
      }
      if (typeof body.rewardCeiling !== "undefined") {
        const ceil = Number(body.rewardCeiling);
        if (Number.isFinite(ceil)) patch.rewardCeiling = ceil;
      }
      const updated =
        runtimeConfig && typeof runtimeConfig.update === "function"
          ? runtimeConfig.update(patch)
          : patch;
      console.log(`[admin] ${admin.name} updated runtime config`, patch);
      return res.json({ success: true, runtime: updated });
    } catch (err) {
      console.error("[admin] runtime update error", err);
      return res
        .status(500)
        .json({ success: false, error: "Failed to update runtime" });
    }
  });

  // ---- Shop catalog editor ----
  // The catalog JSON is the shop's source of truth. Admins edit a draft in the
  // panel and publish the whole document; it is validated with the same rules
  // the server uses at runtime, then written atomically and reloaded.
  const fs = require("fs");
  const crypto = require("crypto");
  const shopCatalog = require("../../services/shop/shopCatalog");
  const PUBLIC_DIR = path.resolve(__dirname, "../../../../public");
  const catalogPath = () => shopCatalog.CATALOG_PATH;
  const revisionOf = (text) => crypto.createHash("sha1").update(text).digest("hex");
  const listAssets = (dir, pattern) => {
    try {
      return fs.readdirSync(path.join(PUBLIC_DIR, dir)).filter((name) => pattern.test(name)).sort().map((name) => `/${dir}/${name}`);
    } catch (_) { return []; }
  };

  app.get("/api/admin/shop/catalog", async (req, res) => {
    if (!await requireAdminUser(req, res)) return sendUnauthorized(res);
    try {
      const text = fs.readFileSync(catalogPath(), "utf8");
      const catalog = JSON.parse(text);
      const { skins, cards, profileIcons } = shopCatalog.getCosmeticCatalogs();
      const pick = ({ id, name, assetUrl, rarity, character }) => ({ id, name, assetUrl, rarity, character });
      return res.json({
        success: true,
        catalog,
        revision: revisionOf(text),
        errors: shopCatalog.validateCatalog(catalog),
        options: {
          skins: Object.values(skins?.characters || {}).flatMap((entry) => entry.skins || []).map(pick),
          cards: (cards?.cards || []).map(pick),
          profileIcons: (profileIcons?.icons || []).map(pick),
          banners: listAssets("assets/shop/banners", /^[a-z0-9-]+\.webp$/),
          icons: listAssets("assets/shop/icons", /^[a-z0-9-]+\.(webp|svg)$/),
        },
      });
    } catch (error) {
      console.error("[admin] shop catalog read", error);
      return res.status(500).json({ error: "Unable to read the shop catalog" });
    }
  });

  app.get("/api/admin/shop/status", async (req, res) => {
    if (!await requireAdminUser(req, res)) return sendUnauthorized(res);
    try {
      return res.json({ success: true, ...(await shopService.getAdminStatus()), payment: stripeShopService.getConfigurationStatus() });
    } catch (error) {
      console.error("[admin] shop status", error);
      return res.json({ success: true, error: error?.message || "Shop schema is unavailable", payment: stripeShopService.getConfigurationStatus() });
    }
  });

  app.put("/api/admin/shop/catalog", async (req, res) => {
    const admin = await requireAdminUser(req, res);
    if (!admin) return sendUnauthorized(res);
    const catalog = req.body?.catalog;
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return res.status(400).json({ error: "Invalid catalog" });
    try {
      const current = fs.readFileSync(catalogPath(), "utf8");
      if (req.body?.revision !== revisionOf(current)) {
        return res.status(409).json({ error: "The shop changed since you opened it. Reload the store to get the latest version." });
      }
      const errors = shopCatalog.validateCatalog(catalog);
      if (errors.length) return res.status(422).json({ error: "Fix these problems before publishing", errors });
      const text = `${JSON.stringify(catalog, null, 2)}\n`;
      const temp = `${catalogPath()}.${process.pid}.tmp`;
      fs.writeFileSync(temp, text);
      fs.renameSync(temp, catalogPath());
      shopCatalog.invalidateCatalog();
      console.log(`[admin] ${admin.user_id} published the shop catalog (${catalog.offers?.length || 0} offers)`);
      return res.json({ success: true, catalog, revision: revisionOf(text) });
    } catch (error) {
      console.error("[admin] shop catalog write", error);
      return res.status(500).json({ error: "Unable to publish the shop catalog" });
    }
  });

  app.post("/api/admin/shop/refresh", async (req, res) => {
    const admin = await requireAdminUser(req, res);
    if (!admin) return sendUnauthorized(res);
    try {
      const section = String(req.body?.section || "").trim();
      if (!new Set(["dailies", "sales"]).has(section)) {
        return res.status(400).json({
          success: false,
          error: "section must be dailies or sales",
        });
      }
      const rotation = await shopService.rotationService.forceRefresh(
        section,
        admin.user_id,
      );
      console.log(`[admin] ${admin.name} refreshed shop ${section}`);
      return res.json({ success: true, section, rotation });
    } catch (error) {
      console.error("[admin] shop refresh error", error);
      return res.status(500).json({
        success: false,
        error: "Failed to refresh the shop",
      });
    }
  });
}

module.exports = { registerAdminRoutes };
