const { registerAdminUsersRoutes } = require("./adminUsersRoutes");
const { registerAdminRuntimeRoutes } = require("./adminRuntimeRoutes");
const { registerAdminShopRoutes } = require("./adminShopRoutes");
const { getBootstrap } = require("../../services/admin/adminDashboardService");
const { API_PATHS } = require("../../../shared/net/apiPaths.js");

const path = require("path");

function registerAdminRoutes({
  app,
  io,
  db,
  auth,
  pageRoot,
  distDir,
  runtimeConfig,
  shopService,
  stripeShopService,
}) {
  const { requireAdminUser } = auth;

  function sendUnauthorized(res) {
    return res.status(403).json({ success: false, error: "Admin access required" });
  }

  app.get("/admin", async (req, res) => {
    const user = await requireAdminUser(req, res);
    if (!user) {
      if (!req.signedCookies?.user_id) {
        return res.redirect(302, API_PATHS.LOGIN + "?next=/admin");
      }
      return res.status(403).send("<h1>403</h1><p>Admin access required.</p>");
    }
    const root = path.join(pageRoot || distDir, "admin.html");
    return res.sendFile(root);
  });

  app.get(API_PATHS.API_ADMIN_BOOTSTRAP, async (req, res) => {
    const user = await requireAdminUser(req, res);
    if (!user) return sendUnauthorized(res);
    try {
      return res.json(
        await getBootstrap({ db, user, runtimeConfig, shopService, stripeShopService }),
      );
    } catch (err) {
      console.error("[admin] bootstrap error", err);
      return res.status(500).json({ success: false, error: "Failed to load admin dashboard" });
    }
  });

  const access = { app, requireAdminUser, sendUnauthorized };
  registerAdminUsersRoutes({ ...access, db, io });
  registerAdminShopRoutes({ ...access, shopService, stripeShopService });
  registerAdminRuntimeRoutes({ ...access, runtimeConfig });
}

module.exports = { registerAdminRoutes };
