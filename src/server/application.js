const { API_PATHS } = require("../shared/net/apiPaths");

async function createApplication({ db, config }) {
  const express = require("express");
  const http = require("http");
  const socketIo = require("socket.io");
  const path = require("path");
  const cookieParser = require("cookie-parser");

  // Resolve repository root (two levels up from src/server)
  const ROOT_DIR = path.resolve(__dirname, "..", "..");

  // Core & modular routes/jobs
  const { registerRoutes } = require("./routes/routes.js");
  const { makeAuthHelpers } = require("./services/auth/auth.js");
  const { initSocket } = require("./core/socket.js");
  const navigation = require("./core/bots/navigationService").createNavigationService();
  const { createRuntimeConfig } = require("./lib/runtimeConfig.js");
  const { createPartyChatService } = require("./services/social/chatService.js");
  const { createFriendService } = require("./services/social/friendService.js");
  const { createAbuseControlService } = require("./services/moderation/abuseControlService");
  const { createShopService } = require("./services/shop/shopService");
  const {
    createStripeShopService,
    loadStripeClient,
  } = require("./services/shop/stripeShopService");
  const { registerStripeWebhookRoute } = require("./routes/modules/stripeWebhook");
  const { createAbuseHttpMiddleware } = require("./middleware/abuseHttpMiddleware");

  const disposers = [];
  async function dispose() {
    const results = await Promise.allSettled(
      disposers
        .splice(0)
        .reverse()
        .map((fn) => Promise.resolve().then(fn)),
    );
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
  disposers.push(() => navigation.close());
  try {
    const app = express();
    const server = http.createServer(app);
    const io = socketIo(server);
    disposers.push(() => new Promise((resolve) => io.close(resolve)));
    const {
      isProd: IS_PROD,
      cookies: { secret: COOKIE_SECRET, secure: SECURE_COOKIES },
    } = config;

    app.disable("x-powered-by");
    app.use(require("./middleware/httpCompression"));
    app.use((_req, res, next) => {
      // Only same-origin framing (Map Studio playtest) is allowed.
      res.set({ "X-Frame-Options": "SAMEORIGIN", "X-Content-Type-Options": "nosniff" });
      next();
    });

    const PUBLIC_DIR = path.join(ROOT_DIR, "public");
    const DIST_DIR = path.join(ROOT_DIR, "dist");
    const PAGE_ROOT = IS_PROD ? DIST_DIR : PUBLIC_DIR;

    const SIGNED_COOKIE_OPTS = {
      httpOnly: true,
      sameSite: "lax",
      secure: SECURE_COOKIES,
      signed: true,
    };
    const DISPLAY_COOKIE_OPTS = { sameSite: "lax", secure: SECURE_COOKIES };

    // Expose cookie opts for downstream modules
    app.locals.SIGNED_COOKIE_OPTS = SIGNED_COOKIE_OPTS;
    app.locals.DISPLAY_COOKIE_OPTS = DISPLAY_COOKIE_OPTS;

    // Runtime overrides editable via admin dashboard
    const runtimeConfig = createRuntimeConfig({ rootDir: ROOT_DIR });
    app.locals.runtimeConfig = runtimeConfig;
    app.get(API_PATHS.API_SITE_RUNTIME, (_req, res) => {
      const current = runtimeConfig.get();
      res.set("Cache-Control", "no-store").json({
        maintenanceMode: !!current.maintenanceMode,
        maintenanceUntil: current.maintenanceUntil,
        serverTime: Date.now(),
        announcements: String(current.announcements || "").slice(0, 500),
      });
    });
    const chatService = createPartyChatService({ db, io });
    app.locals.chatService = chatService;
    const friendService = createFriendService({ db, io });
    app.locals.friendService = friendService;
    const abuseControl = createAbuseControlService({ db, io });
    app.locals.abuseControl = abuseControl;
    const shopService = createShopService({ db });
    const { secretKey, webhookSecret, publicBaseUrl, production } = config.stripe;
    const { stripe, loadError } = loadStripeClient(secretKey);
    const stripeListener = require("./jobs/stripeListener").createStripeListener({
      stripe,
      secretKey,
      publicBaseUrl,
      configuredSecret: webhookSecret,
      production,
    });
    const stripeShopService = createStripeShopService({
      db,
      shopService,
      configuration: config.stripe,
      stripeClient: stripe,
      loadError,
      listener: {
        getSigningSecret: stripeListener.getSigningSecret,
        getStatus: stripeListener.getStatus,
      },
    });
    disposers.push(() => stripeListener.stop());
    app.locals.shopService = shopService;
    app.locals.stripeShopService = stripeShopService;

    // Stripe signature verification requires the unparsed request body.
    registerStripeWebhookRoute({ app, stripeShopService });

    app.use(
      [API_PATHS.API_ADMIN_MAPS, API_PATHS.API_ADMIN_MAP_PLAYTESTS],
      express.json({ limit: "12mb" }),
    );
    app.use(API_PATHS.API_ADMIN_SHOP_CATALOG, express.json({ limit: "1mb" }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(cookieParser(COOKIE_SECRET));
    // If running behind a reverse proxy, trust it so req.secure works when HTTPS is terminated at proxy
    // Trust only explicitly named proxies; direct connections ignore forwarded headers.
    app.set("trust proxy", config.trustProxy);

    const auth = makeAuthHelpers(db, { SIGNED_COOKIE_OPTS, DISPLAY_COOKIE_OPTS });
    app.locals.authSessions = auth.sessions;
    // Static middleware can serve the lobby without reaching the page routes.
    app.get(
      ["/", "/index.html", "/game.html"],
      require("./routes/modules/pageRoutes").createBanPageGuard({
        db,
        requireCurrentUser: auth.requireCurrentUser,
      }),
    );

    // Static and dev middleware
    // Older builds may still have a copy of the retired standalone profile page.
    app.get("/profile.html", (_req, res) => res.redirect("/"));
    let closeDevAssets;
    if (!IS_PROD) {
      const webpack = require("webpack");
      const webpackDevMiddleware = require("webpack-dev-middleware");
      const webpackHotMiddleware = require("webpack-hot-middleware");
      const config = require(path.join(ROOT_DIR, "webpack.config.js"))({}, { mode: "development" });
      const compiler = webpack(config);
      const development = webpackDevMiddleware(compiler, {
        publicPath: config.output.publicPath,
        serverSideRender: false,
        ...config.devServer.devMiddleware,
      });
      const hot = webpackHotMiddleware(compiler);
      closeDevAssets = () => {
        hot.close();
        return new Promise((resolve, reject) =>
          development.close((error) => (error ? reject(error) : resolve())),
        );
      };
      disposers.push(closeDevAssets);
      app.use(require("./middleware/devAssetMiddleware").isolateDevAssetResponse(development));
      app.use(hot);
      app.use(express.static(PUBLIC_DIR));
    } else {
      app.use(require("./middleware/precompressed").servePrecompressed(DIST_DIR));
      app.use(
        express.static(DIST_DIR, {
          setHeaders: require("./middleware/staticCache").setStaticCacheHeaders,
        }),
      );
    }

    // Bootstrap sockets early and attach to app.locals
    const matchResults = require("./services/match/matchResultService").createMatchResultService({
      db,
      journalDir: config.matchResultDir,
    });
    const socketApi = initSocket({
      io,
      COOKIE_SECRET,
      navigation,
      sessions: auth.sessions,
      matchResults,
      db,
      runtimeConfig,
      chatService,
      abuseControl,
      friendService,
    });
    app.locals.socketApi = socketApi;
    disposers.push(() => socketApi.dispose());

    // Prepare auth helpers
    const { MapPlaytestService } = require("./services/maps/mapPlaytestService");
    const mapPlaytests = new MapPlaytestService();
    disposers.push(() => mapPlaytests.dispose());
    mapPlaytests.attach(
      io,
      async (socket) => {
        const cookies = require("cookie").parse(socket.handshake.headers.cookie || "");
        const signed = cookieParser.signedCookies(cookies, COOKIE_SECRET);
        return auth.sessions.authenticateSocket(socket, signed.user_id);
      },
      auth.isAdminUser,
      navigation,
    );

    app.use(
      createAbuseHttpMiddleware({
        abuseControl,
        db,
        resolveUser: (req, res) => auth.requireCurrentUser(req, res, { allowBanned: true }),
      }),
    );

    // Register routes
    registerRoutes({
      mapPlaytests,
      app,
      io,
      db,
      auth,
      runtimeConfig,
      pageRoot: PAGE_ROOT,
      distDir: DIST_DIR,
      chatService,
      abuseControl,
      shopService,
      stripeShopService,
      friendService,
    });

    return { app, server, io, socketApi, matchResults, stripeShopService, stripeListener, dispose };
  } catch (error) {
    await dispose().catch((err) => console.error("[server] application cleanup failed", err));
    throw error;
  }
}
module.exports = { createApplication };
