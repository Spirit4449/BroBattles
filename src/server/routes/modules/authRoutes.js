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

      res.cookie("user_id", String(result.user.user_id), {
        ...(app.locals?.SIGNED_COOKIE_OPTS || {}),
        maxAge: 1000 * 60 * 60 * 24 * 20,
      });
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

  app.post("/logout", (req, res) => {
    try {
      res.clearCookie("user_id", app.locals?.SIGNED_COOKIE_OPTS || {});
      res.clearCookie("display_name", app.locals?.DISPLAY_COOKIE_OPTS || {});
    } catch (_) {}
    return res.status(200).json({ success: true });
  });
}

module.exports = { registerAuthRoutes };
