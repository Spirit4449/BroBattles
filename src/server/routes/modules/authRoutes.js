const {
  completeSignupFromGuest,
  loginPermanentUser,
} = require("../../services/authAccountService");
const { setBanHoldCookies } = require("../../helpers/banHold");

function registerAuthRoutes({ app, db, requireCurrentUser }) {
  app.get("/username-availability", async (req, res) => {
    if (!require("./siteRoutes").isSameOrigin(req)) {
      return res.status(403).json({ error: "Same-origin request required." });
    }

    const username =
      typeof req.query?.username === "string" ? req.query.username.trim() : "";
    const usernamePattern = /^[a-zA-Z0-9_.-]{3,14}$/;

    if (!usernamePattern.test(username)) {
      return res.json({ available: false, valid: false });
    }

    try {
      // `name` has a unique index, so this remains a cheap lookup even as the
      // player base grows. Signup still checks the unique constraint to handle
      // another player claiming a name between this request and submission.
      const rows = await db.runQuery(
        "SELECT 1 FROM users WHERE name = ? LIMIT 1",
        [username],
      );
      return res.json({ available: rows.length === 0, valid: true });
    } catch (error) {
      console.error("[auth] username availability error:", error);
      return res.status(503).json({ error: "Unable to check username." });
    }
  });

  const signupLimits = require('../../helpers/requestWindow').createRequestWindow();
  const signupService = require('../../services/signupVerificationService');
  app.use(['/signup', '/signup/pending', '/signup/verify', '/signup/resend', '/signup/cancel'], (req,res,next) => {
    res.set('Cache-Control','no-store');
    if (req.method !== 'GET' && !require('./siteRoutes').isSameOrigin(req)) return res.status(403).json({error:'Same-origin request required.'});
    if (signupLimits.count(req.ip, 3600000) > 60) return res.status(429).json({error:'Too many attempts. Try again in an hour.'});
    next();
  });
  for (const [method,path,action] of [['get','/signup/pending','pendingSignup'],['post','/signup/verify','verifySignup'],['post','/signup/resend','resendSignup'],['post','/signup/cancel','cancelSignup']]) {
    app[method](path,async(req,res)=>{
      try { const result=await signupService[action]({app,db,requireCurrentUser,req,res});res.status(result.statusCode).json(result.payload); }
      catch(error){console.warn('[signup] verification unavailable:',error.code||error.message);res.status(503).json({error:'Unable to complete this step. Please try again.'});}
    });
  }
  app.post("/signup", async (req, res) => {
    if (!require("./siteRoutes").isSameOrigin(req)) return res.status(403).json({ error: "Same-origin request required." });
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
