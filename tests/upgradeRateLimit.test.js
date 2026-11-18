const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createAbuseControlService } = require("../src/server/services/moderation/abuseControlService");
const { createAbuseHttpMiddleware } = require("../src/server/middleware/abuseHttpMiddleware");

function setup({ anonymous = false } = {}) {
  const user = { user_id: 1, is_banned: 0 };
  const db = {
    getUserById: async () => user,
    withTransaction: fn => fn(null, db.runQuery),
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

test("admin requests never consume gameplay allowances or trigger suspensions", async () => {
  const { HTTP_BUCKETS } = require("../src/server/services/moderation/abusePolicy");
  const { request, user } = setup();
  const paths = ["/api/admin/user-search", "/api/admin/user-update", "/api/admin/runtime",
    "/api/admin/shop/refresh", "/api/admin/map-editor/save-file"];
  for (let i = 0; i < 350; i++) {
    assert.equal((await request(200, paths[i % paths.length])).reachedRoute, true);
  }
  assert.equal(user.http_offense_level, undefined);
  assert.equal(user.mm_suspended_until, undefined);
  for (let i = 0; i < HTTP_BUCKETS.strict.limit; i++) {
    assert.equal((await request(200, "/buy")).reachedRoute, true);
  }
  assert.equal((await request(200, "/buy")).res.statusCode, 429);
  // An existing gameplay suspension must not lock the console either.
  for (const path of paths) assert.equal((await request(200, path)).reachedRoute, true);
  assert.equal((await request(200, "/buy")).res.body.type, "mm_suspended");
});

test("equipping counts apart from the shared allowance and outlasts it", async () => {
  const { HTTP_BUCKETS } = require("../src/server/services/moderation/abusePolicy");
  const { request } = setup();
  const equipPaths = ["/player-cards/select", "/profile-icons/select", "/skins/select"];
  for (let i = 0; i < HTTP_BUCKETS.medium.limit + 1; i++) {
    assert.equal((await request(200, equipPaths[i % equipPaths.length])).reachedRoute, true);
  }
  // Browsing cosmetics left the shared allowance untouched.
  for (let i = 0; i < HTTP_BUCKETS.medium.limit; i++) {
    assert.equal((await request(200, "/partydata")).reachedRoute, true);
  }
  for (let i = HTTP_BUCKETS.medium.limit + 1; i < HTTP_BUCKETS.equip.limit; i++) {
    assert.equal((await request(200, "/skins/select")).reachedRoute, true);
  }
  assert.equal((await request(200, "/skins/select")).res.statusCode, 429);
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

test('upgrade returns the committed coin balance, independently of the client balance', async () => {
  const { registerEconomyRoutes } = require('../src/server/routes/modules/economy');
  const { upgradePrice } = require('../src/shared/characters/characterStats');
  const coins = upgradePrice(1) + 37;
  const routes = {};
  registerEconomyRoutes({
    app: { post: (path, handler) => { routes[path] = handler; } },
    auth: { requireCurrentUser: async () => ({ name: 'wallet-test' }) },
    db: { withTransaction: async callback => callback(null, async sql => {
      if (sql.startsWith('SELECT')) return [{ coins, lvl: 1 }];
      return { affectedRows: 1 };
    }) },
  });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await routes['/upgrade']({ body: { character: 'ninja' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.coins, coins - res.body.spent);
});

test("character purchases still debit gems and grant the matching profile icon", async () => {
  const { registerEconomyRoutes } = require("../src/server/routes/modules/economy");
  const { unlockPrice } = require("../src/shared/characters/characterStats");
  const { fakeRes } = require("./helpers/fakeHttp");
  const character = "sparrow";
  const price = unlockPrice(character);
  const routes = new Map();
  const user = { user_id: 1, name: "Buyer" };
  const grants = [];
  let gems = price + 10;

  const query = async (sql, params) => {
    if (sql.includes("SET gems = gems - ?")) {
      assert.deepEqual(params, [price, `$.${character}`, user.name, price, `$.${character}`]);
      gems -= price;
      return { affectedRows: 1 };
    }
    if (sql.includes("AS lvl")) return [{ gems, lvl: 1 }];
    if (sql.includes("INSERT IGNORE INTO user_profile_icons")) {
      grants.push(params);
      return { affectedRows: 1 };
    }
    if (sql.includes("SELECT selected_profile_icon_id")) return [{ selected_profile_icon_id: "ninja" }];
    assert.fail(`Unexpected query: ${sql}`);
  };

  registerEconomyRoutes({
    app: { post: (path, handler) => routes.set(path, handler) },
    auth: { requireCurrentUser: async () => user },
    db: { runQuery: query, withTransaction: (fn) => fn(null, query) },
  });
  const res = fakeRes();
  await routes.get("/buy")({ body: { character } }, res);
  assert.deepEqual(res.body, { success: true, character, newLevel: 1, spent: price, gems: 10 });
  assert.deepEqual(grants, [[user.user_id, character, "character_unlock"]]);
});

test("simultaneous chat violations advance distinct levels and an automatic ban closes all sessions after commit", async () => {
  const { createTransactionalDb } = require("./helpers/fakeDb");
  const { CHAT_ACTION_LIMITS, CHAT_ESCALATION_STEPS } = require("../src/server/services/moderation/abusePolicy");
  const userId = 17;
  const events = [];
  const db = createTransactionalDb({
    state: { user_id: userId, chat_offense_level: 0 },
    async query(row, sql, args) {
      if (sql.includes("SELECT")) return [{ ...row }];
      if (sql.includes("UPDATE users SET chat_offense_level")) {
        Object.assign(row, { chat_offense_level: args[0], chat_last_violation_at: args[1], chat_suspended_until: args[2] });
      }
      if (sql.includes("UPDATE users SET is_banned")) row.is_banned = 1;
      if (sql.includes("INSERT INTO user_abuse_events")) events.push(args[3]);
      return { affectedRows: 1 };
    },
  });
  const transaction = db.withTransaction;
  db.withTransaction = async fn => {
    const result = await transaction(fn);
    events.push("commit");
    return result;
  };
  const io = { in(room) {
    events.push(room);
    return { emit: name => events.push(name), disconnectSockets: () => events.push("disconnect") };
  } };
  const policy = createAbuseControlService({ db, io });
  const send = () => policy.guardChatAction({ userId, source: "chat", actionType: "message" });
  for (let i = 0; i < CHAT_ACTION_LIMITS.message.limit; i++) await send();
  const decisions = await Promise.all([send(), send()]);
  assert.deepEqual(decisions.map(result => result.level).sort(), [1, 2]);
  assert.equal(db.state.chat_offense_level, 2);
  assert.equal(db.calls.filter(call => call.sql.includes("FOR UPDATE")).length, 2);
  db.state.chat_offense_level = CHAT_ESCALATION_STEPS.find(step => step.type === "ban").level - 1;
  assert.equal((await send()).type, "ban");
  assert.equal(db.state.is_banned, 1);
  assert.deepEqual(events.slice(-5), ["ban", "commit", "user:17", "auth:banned", "disconnect"]);
});

test("moderation surfaces storage faults and resumes enforcement after recovery", async () => {
  let attempts = 0;
  const service = createAbuseControlService({ db: { async runQuery() {
    if (++attempts === 1) throw new Error("temporary connection loss");
    return [{ user_id: 1, is_banned: 1 }];
  } } });
  const guard = () => service.guardChatAction({ userId: 1, actionType: "message" });
  await assert.rejects(guard(), /temporary connection loss/);
  assert.equal((await guard()).allowed, false);
  assert.equal(attempts, 2);
});
