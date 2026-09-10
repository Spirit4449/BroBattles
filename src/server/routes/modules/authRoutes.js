const {
  completeSignupFromGuest,
  loginPermanentUser,
} = require("../../services/authAccountService");
const { setBanHoldCookies } = require("../../helpers/banHold");

function registerAuthRoutes({ app, db, requireCurrentUser }) {
  app.post("/signup", async (req, res) => {
    try {
      const result = await completeSignupFromGuest({
        app,
        db,
        requireCurrentUser,
        req,
        res,
      });
      if (result?.payload?.banned) {
        setBanHoldCookies({
          req,
          res,
          reason: String(
            result?.payload?.reason ||
              result?.payload?.error ||
              "Your account has been banned.",
          ),
        });
      }
      return res.status(result.statusCode || 400).json(result.payload || {});
    } catch (error) {
      console.error("[auth] signup error:", error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });

  app.post("/login", async (req, res) => {
    try {
      const result = await loginPermanentUser({ app, db, req });
      if (!result.ok) {
        if (result?.payload?.banned) {
          setBanHoldCookies({
            req,
            res,
            reason: String(
              result?.payload?.reason ||
                result?.payload?.error ||
                "Your account has been banned.",
            ),
          });
        }
        return res.status(result.statusCode || 401).json(result.payload || {});
      }

      await app.locals.authSessions.revokeRequest(req, res);
      await app.locals.authSessions.create(result.user, res);
      res.cookie(
        "display_name",
        result.user.name,
        app.locals?.DISPLAY_COOKIE_OPTS || {},
      );

      return res.status(result.statusCode || 200).json(result.payload || {});
    } catch (err) {
      console.error("[auth] login error:", err);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });

  app.post("/logout", async (req, res) => {
    try {
      await app.locals.authSessions.revokeRequest(req, res);
    } catch (error) {
      console.error("[auth] logout failed", error?.message);
      return res.status(503).json({ success: false, error: "Unable to sign out. Please retry." });
    }
    return res.status(200).json({ success: true });
  });
}

module.exports = { registerAuthRoutes };
