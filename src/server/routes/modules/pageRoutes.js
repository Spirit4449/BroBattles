const path = require("path");

function registerPageRoutes({
  app,
  db,
  getOrCreateCurrentUser,
  pageRoot,
  distDir,
}) {
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
    res.sendFile(path.join(distDir, "signup.html"));
  });
  app.get("/login", (req, res) => {
    res.sendFile(path.join(distDir, "login.html"));
  });

  app.get("/", async (req, res) => {
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
