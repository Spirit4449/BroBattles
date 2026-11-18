const { API_PATHS } = require("../../../shared/net/apiPaths.js");

const path = require("path");

function registerAdminShopRoutes({
  app,
  requireAdminUser,
  sendUnauthorized,
  shopService,
  stripeShopService,
}) {
  // ---- Shop catalog editor ----
  // The catalog JSON is the shop's source of truth. Admins edit a draft in the
  // panel and publish the whole document; it is validated with the same rules
  // the server uses at runtime, then written atomically and reloaded.
  const fs = require("fs");
  const crypto = require("crypto");
  const shopCatalog = require("../../services/shop/shopCatalog");
  const PUBLIC_DIR = path.resolve(__dirname, "../../../../public");
  const catalogPath = () => shopCatalog.CATALOG_PATH;
  const revisionOf = (text) => crypto.createHash("sha1").update(text).digest("hex");
  const listAssets = (dir, pattern) => {
    try {
      return fs
        .readdirSync(path.join(PUBLIC_DIR, dir))
        .filter((name) => pattern.test(name))
        .sort()
        .map((name) => `/${dir}/${name}`);
    } catch (_) {
      return [];
    }
  };

  app.get(API_PATHS.API_ADMIN_SHOP_CATALOG, async (req, res) => {
    if (!(await requireAdminUser(req, res))) return sendUnauthorized(res);
    try {
      const text = fs.readFileSync(catalogPath(), "utf8");
      const catalog = JSON.parse(text);
      const { skins, cards, profileIcons, titles } = shopCatalog.getCosmeticCatalogs();
      const pick = ({ id, name, assetUrl, rarity, character }) => ({
        id,
        name,
        assetUrl,
        rarity,
        character,
      });
      return res.json({
        success: true,
        catalog,
        revision: revisionOf(text),
        errors: shopCatalog.validateCatalog(catalog),
        options: {
          skins: Object.entries(skins?.characters || {}).flatMap(([character, entry]) =>
            (entry.skins || []).map((skin) => pick({ character, ...skin })),
          ),
          cards: (cards?.cards || []).map((card) => ({
            ...pick(card),
            shopImage: card.shopAssetUrl || null,
          })),
          profileIcons: (profileIcons?.icons || []).map(pick),
          titles: (titles?.titles || []).map(({ id, name, rarity, color }) => ({
            id,
            name,
            rarity,
            color,
          })),
          banners: listAssets("assets/shop/banners", /^[a-z0-9-]+\.webp$/),
          icons: listAssets("assets/shop/icons", /^[a-z0-9-]+\.(webp|svg)$/),
        },
      });
    } catch (error) {
      console.error("[admin] shop catalog read", error);
      return res.status(500).json({ error: "Unable to read the shop catalog" });
    }
  });

  app.get(API_PATHS.API_ADMIN_SHOP_STATUS, async (req, res) => {
    if (!(await requireAdminUser(req, res))) return sendUnauthorized(res);
    try {
      return res.json({
        success: true,
        ...(await shopService.getAdminStatus()),
        payment: {
          ...stripeShopService.getConfigurationStatus(),
          listener: stripeShopService.listener.getStatus(),
        },
      });
    } catch (error) {
      console.error("[admin] shop status", error);
      return res.status(500).json({ error: "Unable to load shop status" });
    }
  });

  app.put(API_PATHS.API_ADMIN_SHOP_CATALOG, async (req, res) => {
    const admin = await requireAdminUser(req, res);
    if (!admin) return sendUnauthorized(res);
    const catalog = req.body?.catalog;
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog))
      return res.status(400).json({ error: "Invalid catalog" });
    try {
      const current = fs.readFileSync(catalogPath(), "utf8");
      if (req.body?.revision !== revisionOf(current)) {
        return res
          .status(409)
          .json({
            error:
              "The shop changed since you opened it. Reload the store to get the latest version.",
          });
      }
      const errors = shopCatalog.validateCatalog(catalog);
      if (errors.length)
        return res.status(422).json({ error: "Fix these problems before publishing", errors });
      const text = `${JSON.stringify(catalog, null, 2)}\n`;
      const temp = `${catalogPath()}.${process.pid}.tmp`;
      fs.writeFileSync(temp, text);
      fs.renameSync(temp, catalogPath());
      shopCatalog.invalidateCatalog();
      console.log(
        `[admin] ${admin.user_id} published the shop catalog (${catalog.offers?.length || 0} offers)`,
      );
      return res.json({ success: true, catalog, revision: revisionOf(text) });
    } catch (error) {
      console.error("[admin] shop catalog write", error);
      return res.status(500).json({ error: "Unable to publish the shop catalog" });
    }
  });

  // Validates a draft and returns what a new player would see, `weeks` sales
  // rotations and `days` daily rotations from now. Nothing is written.
  app.post(API_PATHS.API_ADMIN_SHOP_PREVIEW, async (req, res) => {
    if (!(await requireAdminUser(req, res))) return sendUnauthorized(res);
    const catalog = req.body?.catalog;
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog))
      return res.status(400).json({ error: "Invalid catalog" });
    const offset = (value) => Math.max(-52, Math.min(52, Number.parseInt(value, 10) || 0));
    let errors;
    try {
      errors = shopCatalog.validateCatalog(catalog);
    } catch (error) {
      errors = [`The catalog could not be read: ${error.message}`];
    }
    try {
      const preview = await shopService.buildAdminPreview(catalog, {
        weeks: offset(req.body?.weeks),
        days: offset(req.body?.days),
      });
      return res.json({ success: true, errors, ...preview });
    } catch (error) {
      console.error("[admin] shop preview", error);
      return res.json({
        success: true,
        errors,
        previewError: "The preview could not be built from this draft.",
      });
    }
  });

  app.post(API_PATHS.API_ADMIN_SHOP_REFRESH, async (req, res) => {
    const admin = await requireAdminUser(req, res);
    if (!admin) return sendUnauthorized(res);
    try {
      const section = String(req.body?.section || "").trim();
      if (!new Set(["dailies", "sales"]).has(section)) {
        return res.status(400).json({
          success: false,
          error: "section must be dailies or sales",
        });
      }
      const rotation = await shopService.rotationService.forceRefresh(section, admin.user_id);
      console.log(`[admin] ${admin.name} refreshed shop ${section}`);
      return res.json({ success: true, section, rotation });
    } catch (error) {
      console.error("[admin] shop refresh error", error);
      return res.status(500).json({
        success: false,
        error: "Failed to refresh the shop",
      });
    }
  });
}

module.exports = { registerAdminShopRoutes };
