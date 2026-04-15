const {
  HTTP_BUCKETS,
  HTTP_ROUTE_POLICIES,
} = require("../helpers/abusePolicy");
const { setBanHoldCookies } = require("../helpers/banHold");

function getClientIp(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (forwarded[0]) return forwarded[0];
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function createAbuseHttpMiddleware({ abuseControl, db }) {
  return async function abuseHttpMiddleware(req, res, next) {
    try {
      const routeKey = `${String(req.method || "GET").toUpperCase()} ${String(req.path || "")}`;
      const policy = HTTP_ROUTE_POLICIES[routeKey];
      if (!policy) return next();

      const bucket = HTTP_BUCKETS[String(policy.bucket || "lenient")] || HTTP_BUCKETS.lenient;
      const signedUserId = Number(req.signedCookies?.user_id) || 0;
      let user = null;
      if (signedUserId > 0) {
        user = await db.getUserById(signedUserId);
        req.abuseResolvedUser = user || null;
      }

      if (Number(user?.is_banned || 0) === 1) {
        setBanHoldCookies({
          req,
          res,
          reason: String(user?.ban_reason || "Abuse policy violation"),
        });
        try {
          res.clearCookie("user_id", req.app.locals?.SIGNED_COOKIE_OPTS || {});
          res.clearCookie("display_name", req.app.locals?.DISPLAY_COOKIE_OPTS || {});
        } catch (_) {}
        return res.status(403).json({ success: false, error: "Your account has been banned." });
      }

      const identityKey = user?.user_id
        ? `u:${Number(user.user_id)}`
        : `ip:${getClientIp(req)}`;

      const decision = await abuseControl.guardHttpAction({
        userId: Number(user?.user_id) || 0,
        identityKey,
        source: routeKey,
        limit: bucket.limit,
        windowMs: bucket.windowMs,
        anonLimit: bucket.anonLimit,
        enforceActiveSuspension: policy.enforceActiveSuspension !== false,
      });

      if (decision?.allowed) return next();

      console.warn(
        `[abuse] http blocked route=${routeKey} user=${Number(user?.user_id) || 0} identity=${identityKey} type=${String(decision?.type || "rate_limited")}`,
      );

      if (decision?.clearAuth) {
        if (decision?.type === "ban") {
          setBanHoldCookies({
            req,
            res,
            reason: String(decision?.message || "Abuse policy violation"),
          });
        }
        try {
          res.clearCookie("user_id", req.app.locals?.SIGNED_COOKIE_OPTS || {});
          res.clearCookie("display_name", req.app.locals?.DISPLAY_COOKIE_OPTS || {});
        } catch (_) {}
      }

      const status = decision?.type === "ban" ? 403 : 429;
      return res.status(status).json({
        success: false,
        error: decision?.message || "Too many requests.",
        type: decision?.type || "rate_limited",
        suspendedUntilMs: Number(decision?.suspendedUntilMs || 0) || null,
      });
    } catch (error) {
      console.error("[abuse] HTTP middleware error:", error);
      return next();
    }
  };
}

module.exports = {
  createAbuseHttpMiddleware,
};
