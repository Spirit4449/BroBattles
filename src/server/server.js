// server.js (moved to src/server)

// Load environment variables from .env file
require("dotenv").config();

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcrypt");

// Resolve repository root (two levels up from src/server)
const ROOT_DIR = path.resolve(__dirname, "..", "..");

// Shared libs
const {
  DEFAULT_CHARACTER,
  LEVEL_CAP,
  defaultCharacterList,
  upgradePrice,
  unlockPrice,
} = require(path.join(ROOT_DIR, "src", "lib", "characterStats"));

// Core & modular routes/jobs
const db = require("./core/sql.js");
const { registerRoutes } = require("./routes/routes.js");
const { registerEconomyRoutes } = require("./routes/economy.js");
const { makeAuthHelpers } = require("./helpers/auth.js");
const { startCleanupJobs } = require("./jobs/cleanup.js");
const { initSocket } = require("./core/socket.js");
const { createRuntimeConfig } = require("./helpers/runtimeConfig.js");
const { registerAdminRoutes } = require("./routes/admin.js");
const { createPartyChatService } = require("./services/chatService.js");
const { createAbuseControlService } = require("./services/abuseControlService");
const { createShopService } = require("./services/shopService");
const { createStripeShopService } = require("./services/stripeShopService");
const { registerStripeWebhookRoute } = require("./routes/stripeWebhook");
const {
  createAbuseHttpMiddleware,
} = require("./middleware/abuseHttpMiddleware");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const port = Number(process.env.PORT) || 3002;

// Config
const IS_PROD = process.env.NODE_ENV === "production";
// Allow overriding cookie security for HTTP deployments (e.g., Raspberry Pi dev)
// Production defaults to Secure; plain HTTP development can explicitly disable it.
const SECURE_COOKIES =
  String(process.env.SECURE_COOKIES || (IS_PROD ? "true" : "false")).toLowerCase() === "true";
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const PAGE_ROOT = IS_PROD ? DIST_DIR : PUBLIC_DIR;

// Resolve a persistent cookie secret (env, then file, then random persisted)
function resolveCookieSecretLocal() {
  const fromEnv = process.env.COOKIE_SECRET;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv);
  const secretPath = path.join(ROOT_DIR, ".cookie-secret");
  try {
    if (fs.existsSync(secretPath)) {
      const s = fs.readFileSync(secretPath, "utf8").trim();
      if (s) return s;
    }
  } catch (_) {}
  const newSecret = crypto.randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(secretPath, newSecret, { encoding: "utf8" });
  } catch (_) {}
  return newSecret;
}
const COOKIE_SECRET = resolveCookieSecretLocal();

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
const chatService = createPartyChatService({ db, io });
app.locals.chatService = chatService;
const abuseControl = createAbuseControlService({ db, io });
app.locals.abuseControl = abuseControl;
const shopService = createShopService({ db });
const stripeShopService = createStripeShopService({ db, shopService });
app.locals.shopService = shopService;
app.locals.stripeShopService = stripeShopService;

// Stripe signature verification requires the unparsed request body.
registerStripeWebhookRoute({ app, stripeShopService });

app.use(["/api/admin/maps", "/api/admin/map-playtests"], express.json({ limit: "12mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(COOKIE_SECRET));
// If running behind a reverse proxy, trust it so req.secure works when HTTPS is terminated at proxy
// Trust only explicitly named proxies; direct connections ignore forwarded headers.
app.set("trust proxy", process.env.TRUST_PROXY ? process.env.TRUST_PROXY.split(",").map(x => x.trim()).filter(Boolean) : false);

// Static and dev middleware
if (!IS_PROD) {
  const webpack = require("webpack");
  const webpackDevMiddleware = require("webpack-dev-middleware");
  const webpackHotMiddleware = require("webpack-hot-middleware");
  const config = require(path.join(ROOT_DIR, "webpack.config.js"))({}, { mode: "development" });
  const compiler = webpack(config);
  app.use(
    webpackDevMiddleware(compiler, {
      publicPath: config.output.publicPath,
      serverSideRender: false,
    }),
  );
  app.use(webpackHotMiddleware(compiler));
  app.use(express.static(PUBLIC_DIR));
} else {
  app.use(express.static(DIST_DIR));
}

const auth = makeAuthHelpers(db, { SIGNED_COOKIE_OPTS, DISPLAY_COOKIE_OPTS });
app.locals.authSessions = auth.sessions;

// Bootstrap sockets early and attach to app.locals
const matchResults = require("./services/matchResultService").createMatchResultService({ db, journalDir: process.env.MATCH_RESULT_DIR || path.join(ROOT_DIR, "data", "match-results") });
const socketApi = initSocket({
  io,
  COOKIE_SECRET,
  sessions: auth.sessions,
  matchResults,
  db,
  runtimeConfig,
  chatService,
  abuseControl,
});
app.locals.socketApi = socketApi;

// Prepare auth helpers
require('./services/mapPlaytestService').mapPlaytests.attach(io, async socket => {
  const cookies = require('cookie').parse(socket.handshake.headers.cookie || '');
  const signed = cookieParser.signedCookies(cookies, COOKIE_SECRET);
  return auth.sessions.authenticateSocket(socket, signed.user_id);
}, auth.isAdminUser);


app.use(
  createAbuseHttpMiddleware({
    abuseControl,
    db,
    resolveUser: auth.requireCurrentUser,
  }),
);

// Register routes
registerEconomyRoutes({ app, db, auth, io });
registerAdminRoutes({
  app,
  db,
  auth,
  pageRoot: PAGE_ROOT,
  distDir: DIST_DIR,
  runtimeConfig,
  shopService,
  stripeShopService,
});
registerRoutes({
  app,
  io,
  db,
  auth,
  pageRoot: PAGE_ROOT,
  distDir: DIST_DIR,
  chatService,
  abuseControl,
  shopService,
  stripeShopService,
});

// Server start
(async function startServer() {
  try {
    const ownership = await require("./services/runtimeOwnershipService").acquireRuntimeOwnership({
      connect: db.openRuntimeConnection, database: db.databaseName,
      onLost: error => { console.error("[runtime] ownership lost", error.message); process.exit(1); },
    });
    // Fail at startup if the hardening migration has not been applied.
    await db.runQuery("SELECT token_hash FROM auth_sessions LIMIT 0");
    await db.runQuery("SELECT match_id FROM match_reward_commits LIMIT 0");
    await db.runQuery("SELECT event_id FROM shop_webhook_inbox LIMIT 0");
    if (!(await abuseControl.ensureSchema())) throw new Error("Apply the abuse controls migration before starting the server");
    await matchResults.prepare();
    await matchResults.reconcile();
    // A stopped process cannot resume an in-memory simulation from its initial roster.
    // Preserve unsettled outcomes so journal reconciliation can finish their rewards.
    const pendingIds = await matchResults.pendingMatchIds();
    await db.withTransaction(async (_conn, q) => {
      const exclusion = pendingIds.length ? ` AND m.match_id NOT IN (${pendingIds.map(() => "?").join(",")})` : "";
      await q(`UPDATE parties p JOIN match_participants mp ON mp.party_id = p.party_id JOIN matches m ON m.match_id = mp.match_id SET p.status = 'idle' WHERE m.status = 'live'${exclusion}`, pendingIds);
      await q(`UPDATE matches m SET m.status = 'cancelled' WHERE m.status = 'live'${exclusion}`, pendingIds);
    });
    process.once("SIGTERM", () => { server.close(() => { void ownership.release().finally(() => process.exit(0)); }); setTimeout(() => process.exit(0), 5000).unref(); });
    startCleanupJobs({ db, io, matchResults, getGameRoom: socketApi.getGameRoom });
    setInterval(() => { void matchResults.reconcile().catch(error => console.error("[rewards] reconciliation failed", error.message)); }, 30000).unref();
    setInterval(() => { void stripeShopService.reconcileWebhooks().catch(error => console.error("[shop:stripe] reconciliation failed", error.message)); }, 60000).unref();
    console.log("✅ Database connected");
    server.listen(port, "0.0.0.0", () => {
      console.log(
        `Server listening on 0.0.0.0:${port} (cookies secure=${SECURE_COOKIES}, env=${
          process.env.NODE_ENV || "undefined"
        })`,
      );
    });
  } catch (e) {
    console.error("❌ Failed to connect to DB:", e);
    process.exit(1);
  }
})();
