const path = require("node:path");

const rootDir = path.resolve(__dirname, "../..");
const enabled = value => /^(1|true)$/i.test(String(value || ""));
const trueString = value => String(value).toLowerCase() === "true";
const stripped = value => String(value || "").trim();
const freeze = Object.freeze;

function loadConfig(env = process.env, { cookieSecret = env.COOKIE_SECRET } = {}) {
  const isProd = env.NODE_ENV === "production";
  const publicBaseUrl = env.PUBLIC_BASE_URL || "";
  const port = Number(String(env.PORT ?? "").trim() || 3002);
  const bcryptRounds = Number(String(env.BCRYPT_ROUNDS ?? "").trim() || 12);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port");
  if (!Number.isInteger(bcryptRounds) || bcryptRounds < 4 || bcryptRounds > 31) throw new Error("BCRYPT_ROUNDS must be between 4 and 31");
  const traceToken = String(env.BB_NET_TRACE_TOKEN || "");
  const cpuProfileSeconds = Number(env.BB_NET_TRACE_CPU_PROFILE_S);
  return freeze({
    isProd, port, bcryptRounds, publicBaseUrl,
    nodeEnv: env.NODE_ENV,
    cookies: freeze({ secret: cookieSecret, secure: trueString(env.SECURE_COOKIES || isProd) }),
    trustProxy: env.TRUST_PROXY ? freeze(env.TRUST_PROXY.split(",").map(value => value.trim()).filter(Boolean)) : false,
    admin: freeze({ users: freeze(String(env.ADMIN_USERS || "").split(",").map(stripped).filter(Boolean)) }),
    db: freeze({
      host: env.DB_HOST || "localhost",
      port: Math.max(1, Number(env.DB_PORT) || 3306),
      user: env.DB_USER || "root",
      password: env.DB_PASSWORD || "",
      database: env.DB_NAME || "game",
      connectionLimit: Math.max(1, Number(env.DB_CONNECTION_LIMIT) || 10),
      queueLimit: Math.max(1, Math.min(1000, Number(env.DB_QUEUE_LIMIT) || 100)),
      acquireTimeoutMs: Math.max(100, Number(env.DB_ACQUIRE_TIMEOUT_MS) || 5000),
      queryTimeoutMs: Math.max(100, Number(env.DB_QUERY_TIMEOUT_MS) || 10000),
    }),
    email: freeze({
      apiKey: env.RESEND_API_KEY || env.EMAIL_API_KEY,
      from: env.EMAIL_FROM || "Bro Battles <noreply@brobattles.dev>",
      notificationsTo: env.EMAIL_NOTIFICATIONS_TO,
      verificationSecret: env.EMAIL_VERIFICATION_SECRET || cookieSecret,
    }),
    marketing: freeze({
      apiKey: env.RESEND_MARKETING_API_KEY || "",
      postalAddress: stripped(env.MARKETING_POSTAL_ADDRESS),
    }),
    stripe: freeze({
      publishableKey: stripped(env.STRIPE_PUBLISHABLE_KEY),
      secretKey: stripped(env.STRIPE_SECRET_KEY),
      webhookSecret: stripped(env.STRIPE_WEBHOOK_SECRET),
      publicBaseUrl: stripped(publicBaseUrl).replace(/\/$/, ""),
      automaticTax: trueString(env.STRIPE_AUTOMATIC_TAX),
      production: isProd,
    }),
    maps: freeze({ dir: env.BB_MAP_DIR || path.join(rootDir, "data", "maps") }),
    matchResultDir: env.MATCH_RESULT_DIR || path.join(rootDir, "data", "match-results"),
    gemini: freeze({ apiKey: env.GEMINI_API_KEY }),
    version: freeze({
      repository: env.BB_VERSION_REPOSITORY || "Spirit4449/APCSP-Create-Project---Final",
      branch: env.BB_DEPLOY_BRANCH || "main",
      token: env.BB_VERSION_GITHUB_TOKEN,
      production: isProd,
    }),
    netTrace: freeze({
      token: traceToken,
      enabled: traceToken.length >= 16,
      dir: path.resolve(env.BB_NET_TRACE_DIR || path.join(process.cwd(), "data", "net-traces")),
      cpuProfileSeconds: Number.isFinite(cpuProfileSeconds) && cpuProfileSeconds > 0 && cpuProfileSeconds * 1000 <= 2 ** 31 - 1
        ? cpuProfileSeconds
        : 0,
    }),
    diagnostics: freeze({
      socketEvents: enabled(env.DEBUG_SOCKET_EVENTS),
      hitEvents: enabled(env.DEBUG_HIT_EVENTS),
      netTestLogs: /^(1|true|on)$/i.test(env.NETTEST_LOGS || ""),
      snapshotHz: env.BB_SNAPSHOT_HZ,
      coalesceSnapshots: env.BB_COALESCE_SNAPSHOTS !== "0",
      timing: env.BB_TIMING_DIAG ? env.BB_TIMING_DIAG === "1" : !isProd,
    }),
  });
}

let runtimeConfig;
function initializeConfig(env = process.env) {
  if (!runtimeConfig) {
    const { resolveCookieSecret } = require("./lib/utils");
    runtimeConfig = loadConfig(env, { cookieSecret: resolveCookieSecret(rootDir, env.COOKIE_SECRET) });
  }
  return runtimeConfig;
}

// Standalone module consumers can supply a config or read their own environment.
function getConfig() {
  return runtimeConfig ?? loadConfig();
}

module.exports = { initializeConfig, loadConfig, getConfig };
