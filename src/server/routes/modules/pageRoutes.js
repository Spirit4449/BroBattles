const path = require("path");
const { getBanHoldFromRequest } = require("../../helpers/banHold");

function registerPageRoutes({
  app,
  db,
  getOrCreateCurrentUser,
  pageRoot,
  distDir,
}) {
  function redirectIfBanHold(req, res) {
    const hold = getBanHoldFromRequest(req);
    if (!hold) return false;
    if (req.path === "/banned") return false;
    return res.redirect("/banned");
  }

  app.get("/banned", (req, res) => {
    const hold = getBanHoldFromRequest(req);
    if (!hold) return res.redirect("/");
    res.sendFile(path.join(pageRoot, "Errors", "banned.html"));
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
  app.get("/signup", (req, res) => {
    if (redirectIfBanHold(req, res)) return;
    res.sendFile(path.join(pageRoot, "signup.html"));
  });
  app.get("/login", (req, res) => {
    if (redirectIfBanHold(req, res)) return;
    res.sendFile(path.join(pageRoot, "login.html"));
  });
  app.get("/profile", (_req, res) => {
    res.redirect("/");
  });

  app.get("/", async (req, res) => {
    if (redirectIfBanHold(req, res)) return;
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
    if (redirectIfBanHold(req, res)) return;
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
    if (redirectIfBanHold(req, res)) return;
    try {
      const rows = await db.runQuery(
        "SELECT 1 FROM matches WHERE match_id = ? LIMIT 1",
        [req.params.matchid],
      );
      if (!rows.length)
        return res.sendFile(path.join(distDir, "Errors", "gamenotfound.html"));
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

module.exports = { registerPageRoutes, registerNotFoundRoute };
