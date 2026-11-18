const { asyncRoute } = require("../http");
const { httpError } = require("../../services/httpError");
const {
  API_PATHS,
  adminInboxPath,
  supportRequestPath,
} = require("../../../shared/net/apiPaths.js");
const { isSameOrigin } = require("../../middleware/sameOrigin");
const { createSiteSupportService } = require("../../services/site/siteSupportService");
const { createRequestWindow } = require("../../lib/requestWindow");
const config = require("../../../shared/site/siteConfig.json");
const { createVersionService } = require("../../services/site/buildVersion");
const { hasLegalAcceptance } = require("../../services/auth/legalAcceptance");
const { registerSitePages } = require("../../services/site/siteContent");
const { createHelpSearchService } = require("../../services/site/helpSearchService");
function accepted(body) {
  return (
    body?.accepted === true &&
    body.termsVersion === config.termsVersion &&
    body.privacyVersion === config.privacyVersion
  );
}
function registerSiteRoutes({ app, db, auth }) {
  registerSitePages(app);
  const getVersion = createVersionService();
  app.get(API_PATHS.API_VERSION, async (_req, res) => {
    res.set("Cache-Control", "no-store").json(await getVersion());
  });
  app.use([API_PATHS.GAMEDATA], async (req, res, next) => {
    try {
      const user = await auth.requireCurrentUser(req, res);
      if (
        user &&
        !(await hasLegalAcceptance(db, user.user_id))
      )
        return res
          .status(403)
          .json({ error: "Please accept the current Terms in the lobby.", code: "TERMS_REQUIRED" });
      next();
    } catch (_) {
      res.status(503).json({ error: "Unable to verify terms acceptance." });
    }
  });
  const service = createSiteSupportService(db);
  const limits = createRequestWindow();
  const searchHelp = createHelpSearchService();
  const wrap = (admin, permanent, action, allowBanned = false) =>
    asyncRoute(
      "[site] request failed",
      async (req, res) => {
        if (req.method !== "GET" && !isSameOrigin(req))
          return res.status(403).json({ error: "Same-origin request required." });
        if (!admin && limits.count(`ip:${req.ip}`, 60000) > 120)
          return res.status(429).json({ error: "Too many requests. Try again shortly." });
        const user = await (admin ? auth.requireAdminUser : auth.requireCurrentUser)(req, res, {
          allowBanned,
        });
        if (!user || (permanent && auth.isGuest(user)))
          return res
            .status(admin ? 403 : 401)
            .json({ error: admin ? "Admin access required." : "Log in to use support." });
        if (!admin && req.method !== "GET" && limits.count(`write:${user.user_id}`, 60000) > 12)
          return res.status(429).json({ error: "Please wait a minute before sending more." });
        const result = await action(req, user);
        res.set("Cache-Control", "no-store");
        return res.json(result);
      },
      { shape: "bare", defaultStatus: 503, fallback: "Service unavailable. Please retry later." },
    );
  app.get(API_PATHS.API_SITE_SESSION, async (req, res) => {
    try {
      const user = await auth.requireCurrentUser(req, res, { allowBanned: true });
      let unread = 0;
      if (user && !auth.isGuest(user)) {
        const rows = await db.runQuery(
          `SELECT COUNT(*) AS total FROM site_requests r WHERE r.user_id=? AND r.kind='support'
          AND EXISTS(SELECT 1 FROM site_request_messages m WHERE m.request_id=r.id AND m.sender='admin' AND (r.player_read_at IS NULL OR m.created_at>r.player_read_at))`,
          [user.user_id],
        );
        unread = Number(rows[0].total);
      }
      const member = !!user && !auth.isGuest(user);
      const icon = member
        ? String(user.selected_profile_icon_id || user.char_class || "").replace(
            /[^a-z0-9_-]/gi,
            "",
          ) || null
        : null;
      res
        .set("Cache-Control", "no-store")
        .json({
          member,
          guest: !!user && auth.isGuest(user),
          username: member ? user.name : null,
          icon,
          admin: !!user && auth.isAdminUser(user),
          unread,
        });
    } catch (_) {
      res.status(503).json({ error: "Support is temporarily unavailable." });
    }
  });
  app.post(
    API_PATHS.API_SITE_HELP_SEARCH,
    asyncRoute(
      "[site] AI help search unavailable",
      async (req, res) => {
        if (!isSameOrigin(req))
          return res.status(403).json({ error: "Same-origin request required." });
        if (limits.count(`help-search:${req.ip}`, 60000) > 20)
          return res.status(429).json({ error: "Too many searches. Try again shortly." });
        const result = await searchHelp(req.body?.query);
        res.set("Cache-Control", "private, max-age=60").json(result);
      },
      { shape: "bare", defaultStatus: 503, fallback: "AI search is temporarily unavailable." },
    ),
  );
  app.get(
    API_PATHS.API_LEGAL_STATUS,
    wrap(false, false, async (_req, user) => {
      const rows = await db.runQuery(
        "SELECT 1 FROM legal_acceptances WHERE user_id=? AND terms_version=? AND privacy_version=? LIMIT 1",
        [user.user_id, config.termsVersion, config.privacyVersion],
      );
      return { accepted: !!rows.length, ...config };
    }),
  );
  app.post(
    API_PATHS.API_LEGAL_ACCEPT,
    wrap(false, false, async (req, user) => {
      if (!accepted(req.body))
        throw httpError(400, "Please accept the current Terms and acknowledge the Privacy Policy.");
      await db.runQuery(
        "INSERT IGNORE INTO legal_acceptances (user_id,terms_version,privacy_version,context) VALUES (?,?,?,'play')",
        [user.user_id, config.termsVersion, config.privacyVersion],
      );
      return { success: true };
    }),
  );
  // Feedback is one-way and has no topic; support requests keep their categories.
  app.post(
    API_PATHS.API_FEEDBACK,
    wrap(false, false, (req, user) =>
      service.create(user, "feedback", { ...req.body, category: "feedback" }, ["feedback"]),
    ),
  );
  app.post(
    API_PATHS.API_SUPPORT_REPORTS,
    wrap(false, false, (req, user) => service.createReport(user, req.body)),
  );
  app.get(
    API_PATHS.API_SUPPORT_REQUESTS,
    wrap(false, true, (req, user) => service.list(user, false, req.query), true),
  );
  app.post(
    API_PATHS.API_SUPPORT_REQUESTS,
    wrap(false, true, (req, user) => service.create(user, "support", req.body), true),
  );
  app.get(
    supportRequestPath(),
    wrap(false, true, (req, user) => service.detail(user, false, req.params.id), true),
  );
  app.post(
    supportRequestPath(undefined, "messages"),
    wrap(false, true, (req, user) => service.reply(user, false, req.params.id, req.body), true),
  );
  for (const kind of ["feedback", "support"]) {
    app.get(
      adminInboxPath(kind),
      wrap(true, false, (req, user) => service.list(user, true, { ...req.query, kind })),
    );
    app.get(
      adminInboxPath(kind, ":id"),
      wrap(true, false, (req, user) => service.detail(user, true, req.params.id)),
    );
    app.post(
      adminInboxPath(kind, ":id", "status"),
      wrap(true, false, (req) => service.setStatus(req.params.id, req.body.status)),
    );
  }
  app.post(
    adminInboxPath("support", ":id", "messages"),
    wrap(true, false, (req, user) => service.reply(user, true, req.params.id, req.body)),
  );

}
module.exports = { registerSiteRoutes, isSameOrigin, accepted };
