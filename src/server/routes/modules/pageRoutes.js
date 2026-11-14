const path = require("path");
const { isAccountBanned } = require("../../../shared/moderation/accountBan");
const { getBanHoldFromRequest, setBanHoldCookies } = require("../../services/auth/banHold");

async function currentBanHold(req, res, { db, requireCurrentUser }) {
  const user = await requireCurrentUser(req, res, { allowBanned: true });
  if (isAccountBanned(user)) {
    return { userId: user.user_id, reason: user.ban_reason, expiresAt: user.ban_expires_at };
  }
  return getBanHoldFromRequest(req, { db, res });
}

function createBanPageGuard(auth) {
  return async (req, res, next) => {
    try {
      if (await currentBanHold(req, res, auth)) return res.redirect("/banned");
      next();
    } catch (error) {
      console.error("[auth] restriction lookup failed", error);
      res.status(503).send("Unable to check account access. Please retry.");
    }
  };
}

function registerPageRoutes({
  app,
  db,
  getOrCreateCurrentUser,
  requireCurrentUser,
  pageRoot,
  distDir,
}) {
  const auth = { db, requireCurrentUser };
  async function redirectIfBanHold(req, res) {
    try {
      const hold = await currentBanHold(req, res, auth);
      if (!hold) return false;
      res.redirect("/banned");
      return true;
    } catch (error) {
      console.error("[auth] restriction lookup failed", error);
      res.status(503).send("Unable to check account access. Please retry.");
      return true;
    }
  }

  app.get("/banned", async (req, res) => {
    try {
      const hold = await currentBanHold(req, res, auth);
      if (!hold) return res.redirect("/");
      setBanHoldCookies({ req, res, userId: hold.userId, reason: hold.reason, expiresAt: hold.expiresAt });
      res.set("Cache-Control", "no-store");
      res.sendFile(path.join(pageRoot, "Errors", "banned.html"));
    } catch (error) {
      console.error("[auth] restriction lookup failed", error);
      res.status(503).send("Unable to check account access. Please retry.");
    }
  });

  app.get("/partyfull", (req, res) => {
    res.sendFile(path.join(pageRoot, "Errors", "partyfull.html"));
  });
  app.get("/cannotjoin", (req, res) => {
    res.sendFile(path.join(pageRoot, "Errors", "cannotjoin.html"));
  });
  app.get("/partynotfound", (req, res) => {
    res.sendFile(path.join(pageRoot, "Errors", "partynotfound.html"));
  });
  app.get("/signed-out", (req, res) => {
    res.sendFile(path.join(pageRoot, "Errors", "signed-out.html"));
  });
  app.get("/signup", async (req, res) => {
    if (await redirectIfBanHold(req, res)) return;
    res.sendFile(path.join(pageRoot, "signup.html"));
  });
  app.get("/login", async (req, res) => {
    res.sendFile(path.join(pageRoot, "login.html"));
  });
  app.get("/profile", (_req, res) => {
    res.redirect("/");
  });

  app.get("/", async (req, res) => {
    if (await redirectIfBanHold(req, res)) return;
    try {
      const [user] = await getOrCreateCurrentUser(req, res, {
        autoCreate: true,
      });

      const rows = await db.runQuery(
        "SELECT party_id FROM party_members WHERE name = ? LIMIT 1",
        [user?.name],
      );
      if (rows.length) return res.redirect(`/party/${rows[0].party_id}`);
    } catch (e) {
      console.error(e);
    }
    res.sendFile(path.join(pageRoot, "index.html"));
  });

  app.get("/party/:partyid", async (req, res) => {
    if (await redirectIfBanHold(req, res)) return;
    try {
      await getOrCreateCurrentUser(req, res, {
        autoCreate: true,
      });

      const rows = await db.runQuery(
        "SELECT 1 FROM parties WHERE party_id = ? LIMIT 1",
        [req.params.partyid],
      );
      if (!rows.length)
        return res.sendFile(path.join(distDir, "Errors", "partynotfound.html"));
    } catch (e) {
      console.error(e);
    }
    res.sendFile(path.join(pageRoot, "index.html"));
  });

  app.get("/game/:matchid", async (req, res) => {
    if (await redirectIfBanHold(req, res)) return;
    try {
      const rows = await db.runQuery(
        "SELECT status FROM matches WHERE match_id = ? LIMIT 1",
        [req.params.matchid],
      );
      if (!rows.length || ['completed', 'cancelled'].includes(rows[0].status))
        return res.redirect('/');
    } catch (e) {
      console.error(e);
    }
    res.sendFile(path.join(pageRoot, "game.html"));
  });
}

function registerNotFoundRoute({ app, pageRoot }) {
  app.use((req, res) => {
    return res.sendFile(path.join(pageRoot, "Errors", "404.html"));
  });
}

module.exports = { registerPageRoutes, registerNotFoundRoute, createBanPageGuard };
