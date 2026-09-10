const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createAbuseControlService } = require("../src/server/services/abuseControlService");
const { createAbuseHttpMiddleware } = require("../src/server/middleware/abuseHttpMiddleware");

function setup({ anonymous = false } = {}) {
  const user = { user_id: 1, is_banned: 0 };
  const db = {
    getUserById: async () => user,
    runQuery: async (sql, args) => {
      if (sql.includes("UPDATE users") && sql.includes("http_offense_level")) {
        user.http_offense_level = args[0];
        user.mm_suspended_until = args[2];
      }
      return [user];
    },
  };
  const abuseControl = createAbuseControlService({ db });
  const middleware = createAbuseHttpMiddleware({ abuseControl, resolveUser: async () => anonymous ? null : user });
  async function request(statusCode = 200, path = "/upgrade", defer = false) {
    const req = {
      method: "POST", path, signedCookies: anonymous ? {} : { user_id: 1 },
      ip: "127.0.0.1", app: { locals: {} },
    };
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; res.emit("finish"); return res; };
    res.clearCookie = () => {};
    let reachedRoute = false;
    await middleware(req, res, () => {
      reachedRoute = true;
      res.statusCode = statusCode;
      if (!defer) res.emit("finish");
    });
    return { res, reachedRoute };
  }
  return { request, user, abuseControl };
}

test("many successful upgrades never consume the upgrade or shared allowance", async () => {
  const { request } = setup();
  for (let i = 0; i < 100; i++) assert.equal((await request()).reachedRoute, true);
  for (let i = 0; i < 8; i++) assert.equal((await request(200, "/buy")).reachedRoute, true);
  assert.equal((await request(200, "/buy")).res.statusCode, 429);
});

test("eight failed upgrades trigger protection; successes and server errors do not count", async () => {
  const { request } = setup();
  for (let i = 0; i < 8; i++) {
    assert.equal((await request(200)).reachedRoute, true);
    assert.equal((await request(500)).reachedRoute, true);
    assert.equal((await request([400, 403, 409][i % 3])).reachedRoute, true);
  }
  const blocked = await request();
  assert.equal(blocked.reachedRoute, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.equal(blocked.res.body.type, "mm_suspended");
});

test("concurrent successful upgrades are never provisionally counted", async () => {
  const { request, abuseControl } = setup();
  await abuseControl.ensureSchema();
  const pending = await Promise.all(Array.from({ length: 30 }, () => request(200, "/upgrade", true)));
  for (const { res, reachedRoute } of pending) {
    assert.equal(reachedRoute, true);
    res.emit("finish");
  }
  assert.equal((await request()).reachedRoute, true);
});

test("anonymous failed upgrades retain their lower limit", async () => {
  const { request } = setup({ anonymous: true });
  for (let i = 0; i < 4; i++) assert.equal((await request(401)).reachedRoute, true);
  assert.equal((await request(401)).res.body.type, "anon_rate_limited");
});

test("failure counters expire after the configured window", async (t) => {
  t.mock.method(Date, "now", () => 100000);
  const { request } = setup({ anonymous: true });
  for (let i = 0; i < 4; i++) await request(401);
  assert.equal((await request()).res.statusCode, 429);
  Date.now.mock.mockImplementation(() => 110000);
  assert.equal((await request()).reachedRoute, true);
});

test("existing account suspensions still prevent upgrades", async () => {
  const { request, user } = setup();
  user.mm_suspended_until = new Date(Date.now() + 30000);
  assert.equal((await request()).res.body.type, "mm_suspended");
});
