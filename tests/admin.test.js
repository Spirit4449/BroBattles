const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Support inbox offers Reports and sends its category filter to the API', async () => {
  const { createBrowserFixture } = require('./helpers/browserFixture');
  const requests = [];
  const f = createBrowserFixture('<html><body><main id="inbox"></main></body></html>', { globals: {
    fetch: async url => { requests.push(url); return { ok: true, json: async () => ({ items: [], total: 0 }) }; },
  } });
  f.load('src/client/admin/inbox.js').initInbox(f.document.getElementById('inbox'), 'support');
  await f.settle();
  const filter = f.document.querySelector('[aria-label="Category"]');
  assert.equal(filter.querySelector('[value="reports"]').textContent, 'Reports');
  filter.value = 'reports';
  f.event(filter, 'change');
  await f.settle();
  assert.equal(new URL(requests.at(-1), 'http://localhost').searchParams.get('category'), 'reports');
});

test('report inbox shows counts, advisory reasoning, target account action and navigable report history', async () => {
  const { createBrowserFixture } = require('./helpers/browserFixture');
  const requests = [], opened = [];
  const date = '2026-11-12T12:00:00Z';
  const request = { id: 7, kind: 'support', category: 'reports', status: 'open', subject: 'Report: Target (#42)', userId: 12, userName: 'Reporter', created_at: date, updated_at: date };
  const summary = { targetUserId: 42, totalReports: 8, uniqueReporters: 4, recentReports: 5, recentReporters: 3, recentMemberReporters: 3, activeReports: 2 };
  const review = {
    ...summary, targetName: 'Target', targetExists: true, windowDays: 30, reviewThreshold: 3,
    recommendation: { code: 'consider_penalty', title: 'Consider punishment after review', explanation: 'Review chat or match evidence before deciding whether a violation occurred.' },
    history: [
      { id: 7, reason: 'Cheating or exploiting', reporterId: 12, reporterName: 'Reporter', created_at: date, status: 'open' },
      { id: 8, reason: 'Spam or scams', reporterId: 13, reporterName: 'AnotherReporter', created_at: date, status: 'closed' },
    ],
  };
  const f = createBrowserFixture('<html><body><span data-inbox-badge="support"></span><span data-inbox-badge="feedback"></span><main id="inbox"></main><div id="toast"><span id="toastText"></span></div></body></html>', { globals: {
    crypto: require('node:crypto').webcrypto,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/messages')) return { ok: true, json: async () => ({ id: 2 }) };
      if (/\/support\/\d+$/.test(url)) return { ok: true, json: async () => ({ request: { ...request, id: Number(url.split('/').at(-1)) }, messages: [{ id: 1, sender: 'player', body: 'The incident details.', created_at: date }], reportReview: review }) };
      return { ok: true, json: async () => ({ items: [{ ...request, reportSummary: summary }], total: 1 }) };
    },
  } });
  const api = f.load('src/client/admin/inbox.js');
  api.setInboxPlayerOpener(id => opened.push(id));
  api.initInbox(f.document.getElementById('inbox'), 'support');
  await f.settle();
  assert.equal(f.document.querySelector('.tag-report-count').textContent, '8 reports on player · 4 reporters');
  f.document.querySelector('.inbox-item').click();
  await f.settle();
  const panel = f.document.querySelector('[aria-label="Reported player history"]');
  assert.ok(panel, f.document.querySelector('.inbox-thread').textContent);
  assert.equal(panel.querySelector('h3').textContent, 'Target · #42');
  assert.deepEqual([...panel.querySelectorAll('dd')].map(node => node.textContent), ['8', '4', '5', '3']);
  assert.equal(panel.querySelector('h4').textContent, review.recommendation.title);
  assert.match(panel.querySelector('.report-review-advisory').title, /No automatic punishment/);
  assert.equal(panel.querySelectorAll('.report-review-suggestion p').length, 1, 'suggestion has one concise explanation');
  panel.querySelector('.report-review-heading button').click();
  f.document.querySelector('[title="Open the reporter\'s account"]').click();
  assert.deepEqual(opened, [42, 12], 'target and reporter account actions remain distinct');
  const history = panel.querySelectorAll('.report-review-history-item');
  assert.equal(history[0].disabled, true);
  history[1].click();
  await f.settle();
  assert.ok(requests.some(item => item.url === '/api/admin/support/8'));
  assert.equal(f.document.querySelector('.inbox-chat-heading h2').textContent, request.subject);
  assert.ok(requests.every(item => !item.options?.method || item.options.method === 'GET'), 'viewing recommendations never sends a punishment');
  const composer = f.document.querySelector('.bb-chat-composer');
  const reply = composer.querySelector('[aria-label="Reply message"]');
  assert.equal(reply.tagName, 'INPUT');
  assert.equal(reply.type, 'text');
  assert.equal(composer.querySelector('textarea'), null);
  assert.equal(composer.querySelector('input[type="checkbox"]'), null, 'close-after-sending option is removed');
  reply.value = 'Thanks for the details. We are reviewing this report.';
  f.event(reply, 'input');
  f.event(composer, 'submit');
  f.event(composer, 'submit');
  await f.settle();
  const writes = requests.filter(item => item.options?.method === 'POST');
  assert.deepEqual(writes.map(item => item.url), ['/api/admin/support/8/messages'], 'reply submits once without closing the request');
  assert.equal(JSON.parse(writes[0].options.body).message, reply.value);
  assert.equal(f.document.getElementById('toastText').textContent, 'Reply sent');
});

describe("Admin routes", () => {
  const { registerAdminRoutes } = require('../src/server/routes/modules/admin');
  function harness(admin = { user_id: 1, name: 'Admin' }) {
    const routes = {}, queries = [];
    registerAdminRoutes({ app: { get: (p, f) => routes[p] = f, post: (p, f) => routes[p] = f, put: (p, f) => routes[`PUT ${p}`] = f }, auth: { requireAdminUser: async () => admin }, db: { runQuery: async (sql, args) => { queries.push({sql,args}); if(sql.includes('COUNT')) return [{total: 23}]; if(sql.startsWith('UPDATE')) return {affectedRows: 1}; return [{user_id: 2,name:'Player',coins:4}]; } } });
    async function call(path, body = {}, params = {}) { const res = { code: 200, status(n) { this.code=n; return this; }, json(data) { this.data=data; return this; } }; await routes[path]({body,params},res); return res; }
    return { call, queries };
  }
  test('admin APIs deny non-admin access without queries', async()=>{const h=harness(null);for(const path of ['/api/admin/shop/preview','/api/admin/user-search','/api/admin/user-update','/api/admin/user-ban','/api/admin/user-suspend','/api/admin/user-unban','/api/admin/users/:id','/api/admin/users/:id/inventory','/api/admin/users/:id/streak']) assert.equal((await h.call(path)).code,403);assert.equal(h.queries.length,0);});
  function banHarness(target = { user_id: 2, name: 'Player', is_banned: 0 }, failAudit = false) {
    const routes = {}, queries = [], events = [];
    let saved = target && { ...target };
    const db = {
      async withTransaction(fn) {
        let draft = saved && { ...saved };
        const result = await fn(null, async (sql, args) => {
          queries.push({ sql, args });
          if (sql.startsWith('SELECT')) return draft ? [{ ...draft }] : [];
          if (sql.startsWith('UPDATE')) {
            if (sql.includes('is_banned = 0')) Object.assign(draft, { is_banned: 0, ban_reason: null, banned_at: null, ban_expires_at: null });
            else Object.assign(draft, { is_banned: 1, ban_reason: args[0], ban_expires_at: args[1], banned_at: new Date() });
          }
          if (sql.startsWith('INSERT') && failAudit) throw Error('Audit unavailable');
          return { affectedRows: 1 };
        });
        saved = draft;
        events.push('commit');
        return result;
      },
    };
    registerAdminRoutes({ app: { get: (p, f) => routes[p] = f, post: (p, f) => routes[p] = f, put: () => {} }, db,
      auth: { requireAdminUser: async () => ({ user_id: 1, name: 'Admin' }) },
      io: { in(room) { events.push(room); return { emit: (name, payload) => events.push({ name, payload }), disconnectSockets: close => events.push({ close }) }; } },
    });
    return { queries, events, get saved() { return saved; }, async call(body, action = 'ban') {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
      await routes[`/api/admin/user-${action}`]({ body }, res);
      return res;
    } };
  }
  test('banning saves the reason and admin audit before disconnecting all player sessions', async () => {
    const h = banHarness();
    const result = await h.call({ userId: 2, reason: '  Harassment  ' });
    assert.equal(result.code, 200);
    assert.equal(result.data.user.is_banned, 1);
    assert.equal(result.data.user.ban_reason, 'Harassment');
    assert.ok(result.data.user.banned_at instanceof Date);
    const audit = h.queries.find(q => q.sql.startsWith('INSERT'));
    assert.deepEqual(audit.args.slice(0, 5), [2, 'account', 'admin', 'ban', 0]);
    assert.deepEqual(JSON.parse(audit.args[5]), { adminUserId: 1, reason: 'Harassment', expiresAt: null });
    assert.deepEqual(h.events, ['commit', 'user:2', { name: 'auth:banned', payload: { reason: 'Harassment', expiresAt: null } }, { close: true }]);
  });
  test('ban rejects invalid targets, self-bans and invalid reasons without database access', async () => {
    for (const body of [{ userId: 1, reason: 'test' }, { userId: 0, reason: 'test' }, { userId: '2', reason: 'test' }, { userId: 2 }, { userId: 2, reason: '  ' }, { userId: 2, reason: 'x'.repeat(221) }, { userId: 2, reason: 'bad\nreason' }]) {
      const h = banHarness();
      assert.equal((await h.call(body)).code, 400);
      assert.equal(h.queries.length, 0);
      assert.deepEqual(h.events, []);
    }
  });
  test('missing players return 404 and existing bans preserve their reason without another audit', async () => {
    const missing = banHarness(null);
    assert.equal((await missing.call({ userId: 2, reason: 'test' })).code, 404);
    assert.ok(missing.queries.every(q => q.sql.startsWith('SELECT')));
    const existing = banHarness({ user_id: 2, is_banned: 1, ban_reason: 'Original reason' });
    const result = await existing.call({ userId: 2, reason: 'Replacement' });
    assert.equal(result.code, 200);
    assert.equal(result.data.user.ban_reason, 'Original reason');
    assert.ok(existing.queries.every(q => q.sql.startsWith('SELECT')));
  });
  test('a failed moderation audit rolls back the ban and does not disconnect sessions', async () => {
    const h = banHarness(undefined, true);
    assert.equal((await h.call({ userId: 2, reason: 'test' })).code, 500);
    assert.equal(h.saved.is_banned, 0);
    assert.deepEqual(h.events, []);
  });
  test('temporary suspensions persist an expiry and become inactive exactly at the deadline', async t => {
    const { isAccountBanned } = require('../src/shared/moderation/accountBan');
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const h = banHarness();
    const r = await h.call({ userId: 2, reason: 'Cooldown', durationMinutes: 30 }, 'suspend');
    assert.equal(r.code, 200);
    assert.equal(new Date(r.data.user.ban_expires_at).getTime(), now + 30 * 60000);
    assert.equal(isAccountBanned(h.saved), true);
    const audit = h.queries.find(q => q.sql.startsWith('INSERT'));
    assert.equal(audit.args[3], 'suspend');
    assert.equal(JSON.parse(audit.args[5]).expiresAt, r.data.user.ban_expires_at.toISOString());
    now = new Date(r.data.user.ban_expires_at).getTime();
    assert.equal(isAccountBanned(h.saved), false);
    assert.ok(h.events.some(event => event.close));
  });
  test('unban clears permanent and temporary restrictions, audits the admin and keeps sockets connected', async () => {
    for (const ban_expires_at of [null, new Date(Date.now() + 60000)]) {
      const h = banHarness({ user_id: 2, is_banned: 1, ban_expires_at, ban_reason: 'Old reason' });
      const r = await h.call({ userId: 2 }, 'unban');
      assert.equal(r.code, 200);
      assert.equal(r.data.user.is_banned, 0);
      assert.equal(r.data.user.ban_reason, null);
      assert.equal(r.data.user.ban_expires_at, null);
      assert.equal(h.queries.find(q => q.sql.startsWith('INSERT')).args[3], 'unban');
      assert.deepEqual(h.events, ['commit']);
    }
  });
  test('suspensions reject invalid durations and cannot downgrade permanent bans', async () => {
    for (const durationMinutes of [undefined, 0, -1, 1.5, '60', 525601]) {
      const h = banHarness();
      assert.equal((await h.call({ userId: 2, reason: 'test', durationMinutes }, 'suspend')).code, 400);
      assert.equal(h.queries.length, 0);
    }
    const h = banHarness({ user_id: 2, is_banned: 1, ban_reason: 'Permanent' });
    assert.equal((await h.call({ userId: 2, reason: 'test', durationMinutes: 60 }, 'suspend')).code, 409);
    assert.equal(h.saved.ban_reason, 'Permanent');
    assert.deepEqual(h.events, []);
  });
  test('a permanent ban replaces an expired suspension and removes its deadline', async () => {
    const h = banHarness({ user_id: 2, is_banned: 1, ban_expires_at: new Date(Date.now() - 1) });
    assert.equal((await h.call({ userId: 2, reason: 'New restriction' })).code, 200);
    assert.equal(h.saved.ban_expires_at, null);
    assert.equal(h.saved.ban_reason, 'New restriction');
  });
  test('search returns a paginated list and binds user input', async()=>{const h=harness();const r=await h.call('/api/admin/user-search',{query:"x' OR 1=1",page:2});assert.equal(r.data.total,23);assert.ok(Array.isArray(r.data.users));assert.deepEqual(h.queries[1].args,["%x' OR 1=1%",20]);assert.ok(!h.queries[1].sql.includes('password'));});
  test('rejects invalid balances, character, presence, and protected fields',async()=>{for(const changes of [{coins:-1},{gems:1.2},{trophies:2147483648},{char_class:'fake'},{status:'fake'},{password:'abc'},{name:' x'}]){const h=harness();assert.equal((await h.call('/api/admin/user-update',{userId:2,changes})).code,400);assert.equal(h.queries.length,0);}});
  test('updates only supplied valid fields',async()=>{const h=harness();const r=await h.call('/api/admin/user-update',{userId:2,changes:{name:'New name',coins:12}});assert.equal(r.code,200);assert.deepEqual(h.queries[0].args,['New name',12,2]);assert.ok(!h.queries[0].sql.includes('gems ='));});
  test('player detail returns bounded histories, statistics and inventory without auth secrets',async()=>{const h=harness();const r=await h.call('/api/admin/users/:id',{}, {id:'2'});assert.equal(r.code,200);assert.deepEqual(Object.keys(r.data.history).sort(),['currency','matches','moderation','orders']);assert.ok(h.queries.slice(1,5).every(q=>q.sql.includes('LIMIT 20')));assert.ok(r.data.stats);assert.deepEqual(Object.keys(r.data.inventory).sort(),['cards','icons','skins','titles']);assert.ok(h.queries.every(q=>!q.sql.includes('password')&&!q.sql.includes('token_hash')));});
  test('character edits preserve other levels and enforce the shared level cap',async()=>{const h=harness();assert.equal((await h.call('/api/admin/user-update',{userId:2,changes:{char_levels:{ninja:7}}})).code,200);assert.ok(h.queries[0].sql.includes('JSON_SET'));assert.deepEqual(h.queries[0].args,['$.ninja',7,2]);for(const levels of [{ninja:11},{fake:1},{ninja:-1},[],null]){const invalid=harness();assert.equal((await invalid.call('/api/admin/user-update',{userId:2,changes:{char_levels:levels}})).code,400);assert.equal(invalid.queries.length,0);}});
  function grantHarness(rows) {
    const routes = {}, queries = [];
    const run = async (sql, args) => { queries.push({ sql, args }); if (sql.startsWith('SELECT')) return rows.filter(r => args.includes(r.user_id)).map(r => ({ ...r })); return { affectedRows: 1 }; };
    registerAdminRoutes({ app: { get: (p, f) => routes[p] = f, post: (p, f) => routes[p] = f, put: (p, f) => routes[`PUT ${p}`] = f }, auth: { requireAdminUser: async () => ({ user_id: 1, name: 'Admin' }) }, db: { runQuery: run, withTransaction: fn => fn(null, run) } });
    const call = async body => { const res = { code: 200, status(n) { this.code = n; return this; }, json(data) { this.data = data; return this; } }; await routes['/api/admin/grant']({ body }, res); return res; };
    return { call, queries };
  }
  test('grant adds currency to several players and records each change in the ledger', async () => {
    const h = grantHarness([{ user_id: 2, name: 'A', coins: 10, gems: 0 }, { user_id: 3, name: 'B', coins: 0, gems: 5 }]);
    const r = await h.call({ userIds: [2, 3], coins: 500, gems: 20, note: 'giveaway' });
    assert.equal(r.code, 200);
    assert.deepEqual(r.data.users.map(u => [u.coins, u.gems]), [[510, 20], [500, 25]]);
    const ledger = h.queries.filter(q => q.sql.includes('shop_currency_ledger'));
    assert.equal(ledger.length, 4);
    assert.ok(ledger.every(q => q.args[3] === 'admin_grant' && q.args[4].endsWith(':giveaway')));
  });
  test('removing currency never drops a balance below zero and logs the applied amount', async () => {
    const h = grantHarness([{ user_id: 2, name: 'A', coins: 30, gems: 4 }]);
    const r = await h.call({ userId: 2, coins: -100 });
    assert.equal(r.code, 200);
    assert.deepEqual(r.data.users[0].applied, { coins: -30, gems: 0 });
    assert.equal(r.data.users[0].coins, 0);
    assert.deepEqual(h.queries.filter(q => q.sql.includes('shop_currency_ledger')).map(q => q.args[2]), [-30]);
  });
  test('grant rejects bad amounts, missing players and too many recipients without writes', async () => {
    for (const body of [{ userId: 2 }, { userId: 2, coins: 1.5 }, { userId: 2, gems: 1e9 }, { userId: 0, coins: 5 }, { userIds: Array.from({ length: 51 }, (_, i) => i + 1), coins: 1 }]) {
      const h = grantHarness([{ user_id: 2, name: 'A', coins: 0, gems: 0 }]);
      assert.equal((await h.call(body)).code, 400);
      assert.equal(h.queries.length, 0);
    }
    const missing = grantHarness([]);
    assert.equal((await missing.call({ userId: 9, coins: 5 })).code, 404);
    assert.ok(!missing.queries.some(q => q.sql.startsWith('UPDATE')));
  });
  test('shop catalog publishing refuses stale revisions and invalid catalogs without writing', async () => {
    const fs = require('node:fs');
    const { CATALOG_PATH } = require('../src/server/services/shop/shopCatalog');
    const before = fs.readFileSync(CATALOG_PATH, 'utf8');
    const routes = {};
    registerAdminRoutes({ app: { get: (p, f) => routes[p] = f, post: (p, f) => routes[p] = f, put: (p, f) => routes[`PUT ${p}`] = f }, auth: { requireAdminUser: async () => ({ user_id: 1, name: 'Admin' }) }, db: { runQuery: async () => [] } });
    const call = async (key, body = {}) => { const res = { code: 200, status(n) { this.code = n; return this; }, json(data) { this.data = data; return this; } }; await routes[key]({ body, params: {} }, res); return res; };
    const current = await call('/api/admin/shop/catalog');
    assert.equal(current.code, 200);
    assert.ok(current.data.revision);
    assert.ok(current.data.options.banners.length);
    assert.equal((await call('PUT /api/admin/shop/catalog', { catalog: current.data.catalog, revision: 'stale' })).code, 409);
    const invalid = await call('PUT /api/admin/shop/catalog', { catalog: { ...current.data.catalog, sections: [] }, revision: current.data.revision });
    assert.equal(invalid.code, 422);
    assert.ok(invalid.data.errors.length);
    assert.equal(fs.readFileSync(CATALOG_PATH, 'utf8'), before);
  });
  test('shop preview validates a draft and returns the player view without writing', async () => {
    const fs = require('node:fs');
    const { CATALOG_PATH } = require('../src/server/services/shop/shopCatalog');
    const before = fs.readFileSync(CATALOG_PATH, 'utf8');
    const routes = {};
    const previews = [];
    const shopService = { buildAdminPreview: async (catalog, offsets) => { previews.push(offsets); return { sectionMeta: catalog.sections, sections: { sales: [] }, rotations: {} }; } };
    registerAdminRoutes({ app: { get: (p, f) => routes[p] = f, post: (p, f) => routes[p] = f, put: (p, f) => routes[`PUT ${p}`] = f }, auth: { requireAdminUser: async () => ({ user_id: 1, name: 'Admin' }) }, db: { runQuery: async () => [] }, shopService });
    const call = async (key, body = {}) => { const res = { code: 200, status(n) { this.code = n; return this; }, json(data) { this.data = data; return this; } }; await routes[key]({ body, params: {} }, res); return res; };
    const { catalog } = (await call('/api/admin/shop/catalog')).data;
    const valid = await call('/api/admin/shop/preview', { catalog, weeks: 2, days: '1' });
    assert.equal(valid.code, 200);
    assert.deepEqual(valid.data.errors, []);
    assert.deepEqual(valid.data.sectionMeta, catalog.sections);
    assert.deepEqual(previews.at(-1), { weeks: 2, days: 1 });
    const broken = await call('/api/admin/shop/preview', { catalog: { ...catalog, offers: [{ ...catalog.offers[0], price: { type: 'virtual', currency: 'gems', amount: 0 } }, ...catalog.offers.slice(1)] }, weeks: 999 });
    assert.ok(broken.data.errors.some(error => error.startsWith('offers[0]')));
    assert.equal(previews.at(-1).weeks, 52);
    assert.equal((await call('/api/admin/shop/preview', { catalog: [] })).code, 400);
    assert.equal(fs.readFileSync(CATALOG_PATH, 'utf8'), before);
  });
  test('runtime rewards reject out-of-range multipliers and a floor above the ceiling', async () => {
    const routes = {};
    const updates = [];
    const runtimeConfig = { get: () => ({ rewardFloor: 5, rewardCeiling: 500 }), update: patch => { updates.push(patch); return patch; } };
    registerAdminRoutes({ app: { get: (p, f) => routes[p] = f, post: (p, f) => routes[p] = f, put: () => {} }, auth: { requireAdminUser: async () => ({ user_id: 1, name: 'Admin' }) }, db: { runQuery: async () => [] }, runtimeConfig });
    const call = async (body) => { const res = { code: 200, status(n) { this.code = n; return this; }, json(data) { this.data = data; return this; } }; await routes['/api/admin/runtime']({ body, params: {} }, res); return res; };
    for (const body of [{ rewardFloor: 600 }, { rewardFloor: 10, rewardCeiling: 9 }, { rewardMultipliers: { coins: 0 } }, { rewardMultipliers: { gems: 11 } }, { rewardCeiling: 1.5 }]) {
      assert.equal((await call(body)).code, 400, JSON.stringify(body));
    }
    assert.equal(updates.length, 0);
    const ok = await call({ rewardFloor: 10, rewardCeiling: 800, rewardMultipliers: { coins: 1.5 } });
    assert.equal(ok.code, 200);
    assert.deepEqual(updates[0], { rewardFloor: 10, rewardCeiling: 800, rewardMultipliers: { coins: 1.5 } });
  });
});

describe('Player admin tools', () => {
  const { getPlayerStats, getPlayerInventory, updatePlayerInventory, setPlayerStreak } = require('../src/server/services/admin/playerAdminService');
  const { getCurrentWinStreak } = require('../src/server/services/match/battleLog');
  function store({ matches = [], inventory = {}, failAudit = false, missingTitles = false } = {}) {
    let saved = {
      users: [
        { user_id: 2, name: 'Player', char_levels: { ninja: 1 }, selected_card_id: 'astral-amethyst', selected_profile_icon_id: 'ninja', selected_skin_id_by_char: { ninja: 'ninja-arena-sovereign' }, selected_title_id: 'brooo', highest_win_streak: 0, coins: 91, gems: 8, trophies: 20 },
        { user_id: 3, name: 'Opponent', highest_win_streak: 0 },
      ],
      matches: matches.map((match, index) => ({ match_id: 100 - index, status: 'completed', team: 'team1', summary: JSON.stringify({ winnerTeam: match.winner_team, players: [] }), ...match })),
      user_skins: ['ninja-default', 'ninja-arena-sovereign'], user_profile_icons: ['ninja'], user_cards: ['default', 'astral-amethyst'], user_titles: ['brooo'], ...inventory, audits: [],
    };
    async function run(state, sql, args = []) {
      if (missingTitles && (sql.includes('user_titles') || sql.includes('selected_title_id'))) throw Object.assign(Error('Missing titles'), { code: 'ER_NO_SUCH_TABLE' });
      const user = state.users.find(user => user.user_id === args[0]);
      if (sql.startsWith('SELECT') && sql.includes('FROM users')) return user ? [{ ...user }] : [];
      if (sql.startsWith('SELECT DISTINCT user_id')) return [{ user_id: 2 }, { user_id: 3 }];
      if (sql.startsWith('SELECT') && sql.includes('FROM match_participants')) {
        let rows = state.matches.filter(row => row.status === 'completed').map(row => ({ ...row, team: args[0] === 3 ? 'team2' : row.team }));
        if (sql.includes('COUNT(*)')) {
          return [{ total_matches: rows.length, wins: rows.filter(row => row.winner_team === row.team).length, losses: rows.filter(row => ['team1', 'team2'].includes(row.winner_team) && row.winner_team !== row.team).length, draws: rows.filter(row => row.winner_team === 'draw').length }];
        }
        if (sql.includes("m.winner_team IN ('team1', 'team2')")) rows = rows.filter(row => ['team1', 'team2'].includes(row.winner_team));
        if (sql.includes('m.match_id < ?')) rows = rows.filter(row => row.match_id < args[1]);
        return rows.sort((a,b) => b.match_id - a.match_id).slice(0, args.at(-1));
      }
      const table = Object.keys(state).find(key => key.startsWith('user_') && sql.includes(` ${key} `));
      if (table && sql.startsWith('SELECT')) {
        const column = { user_skins: 'skin_id', user_profile_icons: 'icon_id', user_cards: 'card_id', user_titles: 'title_id' }[table];
        return state[table].map(id => ({ [column]: id }));
      }
      if (sql.startsWith('INSERT INTO user_abuse_events')) {
        if (failAudit) throw Error('Audit unavailable');
        state.audits.push({ userId: args[0], action: args[3], detail: JSON.parse(args[5]) });
      } else if (table && sql.startsWith('INSERT')) { if (!state[table].includes(args[1])) state[table].push(args[1]); }
      else if (table && sql.startsWith('DELETE')) state[table] = state[table].filter(id => id !== args[1]);
      else if (sql.startsWith('UPDATE matches')) Object.assign(state.matches.find(row => row.match_id === args[2]), { winner_team: args[0], summary: args[1] });
      else if (sql.startsWith('UPDATE users')) {
        const target = state.users.find(user => user.user_id === args.at(-1));
        if (sql.includes('highest_win_streak =')) target.highest_win_streak = Math.max(target.highest_win_streak || 0, args[0]);
        else {
          const field = ['selected_skin_id_by_char', 'selected_profile_icon_id', 'selected_card_id', 'selected_title_id'].find(field => sql.includes(`${field} =`));
          if (field) target[field] = args[0];
        }
      } else throw Error(`Unexpected query: ${sql}`);
      return { affectedRows: 1 };
    }
    return {
      get state() { return saved; },
      runQuery: (sql, args) => run(saved, sql, args),
      async withTransaction(fn) { const draft = structuredClone(saved); const result = await fn(null, (sql, args) => run(draft, sql, args)); saved = draft; return result; },
    };
  }
  test('statistics count completed battles across the whole history, retain draws and expose unknown results', async () => {
    const db = store({ matches: [{ winner_team: 'team1' }, { winner_team: 'draw' }, { winner_team: 'team1' }, { winner_team: 'team2' }, { winner_team: null }, { winner_team: 'team1', status: 'live' }] });
    assert.deepEqual(await getPlayerStats(db, 2), { totalMatches: 5, wins: 2, losses: 1, draws: 1, unknown: 1, winRate: 40, winStreak: 2 });
    assert.deepEqual(await getPlayerStats(store(), 2), { totalMatches: 0, wins: 0, losses: 0, draws: 0, unknown: 0, winRate: 0, winStreak: 0 });
    const many = store({ matches: Array.from({ length: 125 }, () => ({ winner_team: 'team1' })) });
    assert.equal((await getPlayerStats(many, 2)).winStreak, 125);
    assert.equal((await getPlayerStats(many, 2)).totalMatches, 125);
  });
  test('inventory exposes ownership and automatic unlocks; missing titles do not block other cosmetics', async () => {
    const db = store({ missingTitles: true });
    const inventory = await getPlayerInventory(db, db.state.users[0]);
    assert.equal(inventory.skins.items.find(item => item.id === 'ninja-default').automatic, true);
    assert.equal(inventory.cards.items.find(item => item.id === 'astral-amethyst').equipped, true);
    assert.ok(inventory.titles.error);
    assert.equal((await updatePlayerInventory(db, 2, 1, [{ kind: 'cards', id: 'astral-amethyst', owned: false }])).changed, 1);
    assert.equal(db.state.users[0].selected_card_id, 'default');
  });
  test('inventory patches grant and revoke items, repair equipped selections, and audit only applied changes', async () => {
    const db = store();
    const result = await updatePlayerInventory(db, 2, 1, [
      { kind: 'skins', id: 'ninja-arena-sovereign', owned: false },
      { kind: 'cards', id: 'astral-amethyst', owned: false },
      { kind: 'titles', id: 'brooo', owned: false },
      { kind: 'titles', id: 'unbothered', owned: true },
    ]);
    assert.equal(result.changed, 4);
    assert.deepEqual(db.state.user_skins, ['ninja-default']);
    assert.deepEqual(db.state.user_cards, ['default']);
    assert.deepEqual(db.state.user_titles, ['unbothered']);
    assert.deepEqual(JSON.parse(db.state.users[0].selected_skin_id_by_char), { ninja: 'ninja-default' });
    assert.equal(db.state.users[0].selected_card_id, 'default');
    assert.equal(db.state.users[0].selected_title_id, null);
    assert.equal(db.state.audits[0].action, 'inventory_edit');
    assert.equal(db.state.audits[0].detail.adminUserId, 1);
    assert.equal(db.state.audits[0].detail.changes.length, 4);
    await updatePlayerInventory(db, 2, 1, [{ kind: 'titles', id: 'unbothered', owned: true }]);
    assert.equal(db.state.audits.length, 1);
  });
  test('inventory validation and audit failures preserve the original inventory', async () => {
    for (const changes of [[], [{ kind: 'nope', id: 'x', owned: true }], [{ kind: 'cards', id: 'missing', owned: true }], [{ kind: 'cards', id: 'default', owned: false }], [{ kind: 'skins', id: 'ninja-default', owned: false }], [{ kind: 'titles', id: 'brooo', owned: true }, { kind: 'titles', id: 'brooo', owned: false }]]) {
      const db = store(); const before = structuredClone(db.state);
      await assert.rejects(updatePlayerInventory(db, 2, 1, changes), error => error.status === 400);
      assert.deepEqual(db.state, before);
    }
    const db = store({ failAudit: true }); const before = structuredClone(db.state);
    await assert.rejects(updatePlayerInventory(db, 2, 1, [{ kind: 'titles', id: 'brooo', owned: false }]), /Audit unavailable/);
    assert.deepEqual(db.state, before);
  });
  test('setting streak changes shared winners and summaries, preserves draws and rewards, and updates affected peaks', async () => {
    const db = store({ matches: [{ winner_team: 'team2' }, { winner_team: 'draw' }, { winner_team: 'team2' }, { winner_team: 'team1' }, { winner_team: 'team1' }] });
    const result = await setPlayerStreak(db, 2, 1, 2);
    assert.deepEqual(result, { streak: 2, changedMatches: 3 });
    assert.equal(await getCurrentWinStreak(db, 2), 2);
    assert.deepEqual(db.state.matches.map(row => row.winner_team), ['team1', 'draw', 'team1', 'team2', 'team1']);
    for (const row of db.state.matches) assert.equal(JSON.parse(row.summary).winnerTeam, row.winner_team);
    assert.equal(db.state.users[0].highest_win_streak, 2);
    assert.equal(db.state.users[1].highest_win_streak, 1);
    assert.deepEqual([db.state.users[0].coins, db.state.users[0].gems, db.state.users[0].trophies], [91, 8, 20]);
    assert.equal(db.state.audits[0].detail.matches.length, 3);
    assert.equal(db.state.audits[0].detail.adminUserId, 1);
    await setPlayerStreak(db, 2, 1, 2);
    assert.equal(db.state.audits.length, 1);
    await setPlayerStreak(db, 2, 1, 0);
    assert.equal(await getCurrentWinStreak(db, 2), 0);
    assert.equal(db.state.users[0].highest_win_streak, 2);
  });
  test('streak edits reject insufficient history and invalid numbers, and roll back with their audit', async () => {
    for (const streak of [-1, 1.5, '2', 10001, 2]) {
      const db = store({ matches: [{ winner_team: 'team2' }] }); const before = structuredClone(db.state);
      await assert.rejects(setPlayerStreak(db, 2, 1, streak), error => error.status === 400);
      assert.deepEqual(db.state, before);
    }
    assert.deepEqual(await setPlayerStreak(store(), 2, 1, 0), { streak: 0, changedMatches: 0 });
    const db = store({ matches: [{ winner_team: 'team2' }], failAudit: true }); const before = structuredClone(db.state);
    await assert.rejects(setPlayerStreak(db, 2, 1, 1), /Audit unavailable/);
    assert.deepEqual(db.state, before);
  });
  test('inventory UI keeps failed drafts, filters items and submits only explicit changes', async () => {
    const { createBrowserFixture } = require('./helpers/browserFixture');
    const requests = []; let fail = true;
    const f = createBrowserFixture('<html><body><div id="inventory"></div><div id="toast"><span id="toastText"></span></div></body></html>', { globals: { fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: !fail, json: async () => fail ? { error: 'Try again' } : { success: true } }; } } });
    f.window.confirm = () => true;
    const editor = f.load('src/client/admin/playerInventory.js').createInventoryEditor(f.document.getElementById('inventory'));
    editor.set(2, { cards: { items: [{ id: 'default', name: 'Default', automatic: true, owned: true }, { id: 'gold', name: 'Gold', owned: false }] } });
    assert.equal(f.document.querySelector('[aria-label="Own Default"]').disabled, true);
    const filter = f.document.querySelector('input[type="search"]'); filter.value = 'gold'; f.event(filter, 'input');
    assert.equal(f.document.querySelector('[aria-label="Own Default"]').closest('label').hidden, true);
    const gold = f.document.querySelector('[aria-label="Own Gold"]'); gold.checked = true; f.event(gold, 'change');
    assert.equal(editor.isDirty(), true);
    f.document.querySelector('button').click(); await f.settle();
    assert.equal(editor.isDirty(), true);
    fail = false;
    f.document.querySelector('button').click(); await f.settle();
    assert.equal(editor.isDirty(), false);
    assert.deepEqual(requests.at(-1), { url: '/api/admin/users/2/inventory', body: { changes: [{ kind: 'cards', id: 'gold', owned: true }] } });
  });
});

describe("Maintenance controls", () => {
  const {createRuntimeConfig}=require('../src/server/lib/runtimeConfig');
  const {createMatchmaking}=require('../src/server/core/matchmaking');
  test('maintenance rejects new queues before any database writes',async()=>{const mm=createMatchmaking({io:{},db:{runQuery(){throw Error('Database must not be touched')}},runtimeConfig:{get:()=>({maintenanceMode:true})}});await assert.rejects(mm.queueJoin({userId:1}),/New matches currently disabled for maintenance/);});
  test('runtime controls persist across restarts',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'admin-runtime-'));try{const config=createRuntimeConfig({rootDir:dir});config.update({maintenanceUntil:new Date(Date.now()+60000).toISOString(),announcements:'Back soon'});assert.equal(config.get().maintenanceMode,true);assert.equal(createRuntimeConfig({rootDir:dir}).get().announcements,'Back soon');config.update({maintenanceUntil:null,announcements:''});assert.equal(createRuntimeConfig({rootDir:dir}).get().maintenanceMode,false);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
  test('failed persistence leaves active config unchanged',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'admin-runtime-'));const config=createRuntimeConfig({rootDir:dir});fs.rmSync(dir,{recursive:true});assert.throws(()=>config.update({maintenanceMode:true}));assert.equal(config.get().maintenanceMode,false);});

  test('maintenance expires by time without a config write or restart',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'admin-runtime-'));try{const config=createRuntimeConfig({rootDir:dir});config.update({maintenanceUntil:new Date(Date.now()-1).toISOString(),maintenanceMode:true});assert.equal(config.get().maintenanceMode,false);}finally{fs.rmSync(dir,{recursive:true,force:true});}});

});
