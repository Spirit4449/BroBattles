const path = require("path");

function registerAdminRoutes({
  app,
  db,
  auth,
  pageRoot,
  distDir,
  runtimeConfig,
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
        "SELECT COUNT(*) AS guests FROM users WHERE expires_at IS NOT NULL"
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
      });
    } catch (err) {
      console.error("[admin] bootstrap error", err);
      return res
        .status(500)
        .json({ success: false, error: "Failed to load admin dashboard" });
    }
  });

  app.post("/api/admin/user-search", async (req, res) => {
    const user = await requireAdminUser(req, res);
    if (!user) return sendUnauthorized(res);
    try {
      const query = String(req.body?.query || "").trim();
      if (!query)
        return res
          .status(400)
          .json({ success: false, error: "Search query required" });
      let rows;
      if (/^[0-9]+$/.test(query)) {
        rows = await db.runQuery(
          "SELECT user_id, name, coins, gems, trophies, status, char_class, expires_at FROM users WHERE user_id = ?",
          [Number(query)]
        );
      } else {
        rows = await db.runQuery(
          "SELECT user_id, name, coins, gems, trophies, status, char_class, expires_at FROM users WHERE name LIKE ? LIMIT 1",
          [`%${query}%`]
        );
      }
      if (!rows.length)
        return res
          .status(404)
          .json({ success: false, error: "User not found" });
      return res.json({ success: true, user: rows[0] });
    } catch (err) {
      console.error("[admin] user-search error", err);
      return res
        .status(500)
        .json({ success: false, error: "Failed to look up user" });
    }
  });

  app.post("/api/admin/user-update", async (req, res) => {
    const admin = await requireAdminUser(req, res);
    if (!admin) return sendUnauthorized(res);
    try {
      const userId = Number(req.body?.userId);
      const changes = req.body?.changes || {};
      if (!Number.isFinite(userId) || userId <= 0) {
        return res
          .status(400)
          .json({ success: false, error: "userId is required" });
      }
      const allowed = ["coins", "gems", "trophies", "char_class", "status"];
      const sets = [];
      const values = [];
      for (const key of allowed) {
        if (!(key in changes)) continue;
        if (key === "char_class") {
          const val = String(changes[key] || "").trim();
          if (!val) continue;
          sets.push("char_class = ?");
          values.push(val);
          continue;
        }
        if (key === "status") {
          const val = String(changes[key] || "").trim();
          sets.push("status = ?");
          values.push(val);
          continue;
        }
        const num = Number(changes[key]);
        if (!Number.isFinite(num)) continue;
        sets.push(`${key} = ?`);
        values.push(Math.round(num));
      }
      if (!sets.length) {
        return res
          .status(400)
          .json({ success: false, error: "No valid fields supplied" });
      }
      values.push(userId);
      await db.runQuery(
        `UPDATE users SET ${sets.join(
          ", "
        )}, updated_at = NOW() WHERE user_id = ? LIMIT 1`,
        values
      );
      const refreshed = await db.runQuery(
        "SELECT user_id, name, coins, gems, trophies, status, char_class FROM users WHERE user_id = ? LIMIT 1",
        [userId]
      );
      console.log(
        `[admin] ${admin.name} updated user ${userId}: ${sets.join(", ")}`
      );
      return res.json({ success: true, user: refreshed[0] });
    } catch (err) {
      console.error("[admin] user-update error", err);
      return res
        .status(500)
        .json({ success: false, error: "Failed to update user" });
    }
  });

  app.post("/api/admin/runtime", async (req, res) => {
    const admin = await requireAdminUser(req, res);
    if (!admin) return sendUnauthorized(res);
    try {
      const body = req.body || {};
      const patch = {};
      if (typeof body.maintenanceMode !== "undefined") {
        patch.maintenanceMode = !!body.maintenanceMode;
      }
      if (typeof body.announcements !== "undefined") {
        patch.announcements = String(body.announcements || "");
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
}

module.exports = { registerAdminRoutes };
