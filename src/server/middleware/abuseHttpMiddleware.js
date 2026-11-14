const { isAccountBanned } = require("../../shared/moderation/accountBan");
const { HTTP_BUCKETS, HTTP_ROUTE_POLICIES } = require("../services/moderation/abusePolicy");
const { setBanHoldCookies } = require("../services/auth/banHold");

const { createRequestWindow } = require("../lib/requestWindow");

function getClientIp(req) {
  // Express resolves req.ip against the configured trusted proxy addresses.
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function createAbuseHttpMiddleware({ abuseControl, resolveUser = async () => null }) {
  const networkRequests = createRequestWindow();
  return async function abuseHttpMiddleware(req, res, next) {
    try {
      const routeKey = `${String(req.method || "GET").toUpperCase()} ${String(req.path || "").toLowerCase().replace(/\/+$/, "")}`;
      const policy = HTTP_ROUTE_POLICIES[routeKey];
      if (!policy) return next();

      const bucket =
        HTTP_BUCKETS[String(policy.bucket || "lenient")] ||
        HTTP_BUCKETS.lenient;
      const ip = getClientIp(req);
      if (networkRequests.count(ip, 10000) > 300) {
        res.set?.("Retry-After", "10");
        return res.status(429).json({ success: false, error: "Too many requests." });
      }
      const user = await resolveUser(req, res);
      req.abuseResolvedUser = user || null;

      if (isAccountBanned(user) && !policy.allowBanned) {
        setBanHoldCookies({
          req,
          res,
          userId: user.user_id,
          expiresAt: user.ban_expires_at,
          reason: String(user?.ban_reason || "Abuse policy violation"),
        });
        return res
          .status(403)
          .json({ success: false, banned: true, redirect: "/banned", error: "Your account has been banned.", message: String(user.ban_reason || "Your account has been banned."), banExpiresAt: user.ban_expires_at || null });
      }

      // Login stays available to restricted accounts; rate-limit those attempts
      // by IP so the account's gameplay restriction cannot block authentication.
      const rateLimitUser = policy.allowBanned && isAccountBanned(user) ? null : user;
      const identityKey = rateLimitUser?.user_id
        ? `u:${Number(rateLimitUser.user_id)}`
        : `ip:${getClientIp(req)}`;

      const decision = await abuseControl.guardHttpAction({
        userId: Number(rateLimitUser?.user_id) || 0,
        identityKey,
        source: routeKey,
        limit: bucket.limit,
        windowMs: bucket.windowMs,
        anonLimit: bucket.anonLimit,
        scope: bucket.scope,
        enforceActiveSuspension: policy.enforceActiveSuspension !== false,
        countFailuresOnly: policy.countFailuresOnly === true,
      });

      if (decision?.allowed) {
        if (policy.countFailuresOnly) {
          // Count completed client failures only, never successful purchases or
          // server errors. Register after the guard so blocked retries don't count.
          res.once("finish", () => {
            if (res.statusCode >= 400 && res.statusCode < 500) {
              abuseControl.recordHttpFailure({
                identityKey,
                source: routeKey,
                windowMs: bucket.windowMs,
              });
            }
          });
        }
        return next();
      }

      console.warn(
        `[abuse] http blocked route=${routeKey} user=${Number(user?.user_id) || 0} identity=${identityKey} type=${String(decision?.type || "rate_limited")}`,
      );

      if (decision?.type === "ban" || decision?.clearAuth) {
        if (decision?.type === "ban") {
          setBanHoldCookies({
            req,
            res,
            userId: user?.user_id,
            expiresAt: user?.ban_expires_at,
            reason: String(decision?.message || "Abuse policy violation"),
          });
        }
        if (decision?.type !== "ban") try {
          res.clearCookie("user_id", req.app.locals?.SIGNED_COOKIE_OPTS || {});
          res.clearCookie(
            "display_name",
            req.app.locals?.DISPLAY_COOKIE_OPTS || {},
          );
        } catch (_) {}
      }

      const status = decision?.type === "ban" ? 403 : 429;
      return res.status(status).json({
        success: false,
        error: decision?.message || "Too many requests.",
        type: decision?.type || "rate_limited",
        ...(decision?.type === "ban" ? { banned: true, redirect: "/banned" } : {}),
        suspendedUntilMs: Number(decision?.suspendedUntilMs || 0) || null,
      });
    } catch (error) {
      console.error("[abuse] HTTP middleware error:", error);
      return res.status(503).json({ success: false, error: "Service temporarily unavailable. Please retry." });
    }
  };
}

module.exports = {
  createAbuseHttpMiddleware,
};
