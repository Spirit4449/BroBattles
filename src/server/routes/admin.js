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
        `SELECT user_id, name, coins, gems, status, created_at
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
  const { LEVEL_CAP } = require("../../shared/characterStats");
  const { characterDefinitions } = require("../../shared/characters");

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
