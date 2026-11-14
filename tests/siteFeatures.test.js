const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe("Public site and account workflows", () => {
  const { validateSubmission,createSiteSupportService }=require('../src/server/services/site/siteSupportService');
  const { article,frame,registerSitePages }=require('../src/server/services/site/siteContent');
  const { accepted,isSameOrigin }=require('../src/server/routes/modules/siteRoutes');
  const { completeSignupFromGuest }=require('../src/server/services/auth/authAccountService');
  const config=require('../src/shared/site/siteConfig.json');
  const {createHelpSearchService,helpSearchDocuments,MODEL}=require('../src/server/services/site/helpSearchService');
  const valid={subject:'A useful idea',category:'idea',message:'Please add a new arena.',submissionKey:'12345678-1234-1234-1234-123456789012'};
  test('support input rejects malformed, oversized, or unknown values',()=>{
    assert.equal(validateSubmission(valid).body,valid.message);
    for(const fields of [{message:''},{message:'x'.repeat(4001)},{subject:'x'},{category:'admin'},{submissionKey:'<script>alert(1)</script>'}])assert.throws(()=>validateSubmission({...valid,...fields}));
    assert.equal(validateSubmission({...valid,message:'  <script>alert(1)</script>  '}).body,'<script>alert(1)</script>');
  });
  test('feedback needs only a subject and message, while support still needs a topic', async t => {
    const { makeAuthHelpers } = require('../src/server/services/auth/auth');
    const { registerSiteRoutes } = require('../src/server/routes/modules/siteRoutes');
    t.mock.method(require('../src/server/services/email/emailService'), 'startEmailWorker', () => {});
    t.mock.method(require('../src/server/services/email/marketingService'), 'startMarketingWorker', () => {});
    const user = { user_id: 12, name: 'Player', expires_at: null };
    const inserts = [];
    const query = async (sql, params) => {
      if (sql.startsWith('SELECT u.*')) return [user];
      if (sql.startsWith('SELECT id, kind FROM site_requests')) return [{ id: 5, kind: inserts.at(-1)?.params[1] }];
      if (sql.startsWith('INSERT INTO site_requests')) inserts.push({ sql, params });
      return { insertId: 5, affectedRows: 1 };
    };
    const db = { runQuery: query, withTransaction: fn => fn(null, query) };
    const routes = new Map();
    registerSiteRoutes({ app: { get: (path, fn) => routes.set(`GET ${path}`, fn), post: (path, fn) => routes.set(`POST ${path}`, fn), use() {} }, db, auth: makeAuthHelpers(db, { SIGNED_COOKIE_OPTS: {}, DISPLAY_COOKIE_OPTS: {} }) });
    const post = async (route, body) => {
      let status = 200;
      const req = { method: 'POST', ip: 'local', signedCookies: { user_id: 'a'.repeat(64) }, query: {}, params: {}, body, get: name => name === 'sec-fetch-site' ? 'same-origin' : null };
      await routes.get(route)(req, { cookie() {}, clearCookie() {}, set() { return this; }, status(code) { status = code; return this; }, json() {} });
      return status;
    };
    const { category, ...withoutTopic } = valid;
    assert.equal(await post('POST /api/feedback', withoutTopic), 200);
    assert.deepEqual(inserts[0].params.slice(1, 3), ['feedback', 'feedback']);
    assert.equal(await post('POST /api/support/requests', withoutTopic), 400);
  });
  test('support ownership is checked before reads or writes',async()=>{
    const calls=[];const db={withTransaction:fn=>fn(null,async(sql,params)=>{calls.push({sql,params});return [];})};
    const service=createSiteSupportService(db);
    await assert.rejects(service.detail({user_id:12},false,99),{status:404});
    await assert.rejects(service.reply({user_id:12},false,99,valid),{status:404});
    assert.equal(calls.length,2);for(const call of calls){assert.match(call.sql,/user_id=\?/);assert.deepEqual(call.params,[99,12]);}
  });
  test('banned members remain signed in for support requests and replies', async t => {
    const { makeAuthHelpers } = require('../src/server/services/auth/auth');
    const { registerSiteRoutes } = require('../src/server/routes/modules/siteRoutes');
    t.mock.method(require('../src/server/services/email/emailService'), 'startEmailWorker', () => {});
    t.mock.method(require('../src/server/services/email/marketingService'), 'startMarketingWorker', () => {});
    const user = { user_id: 12, name: 'Restricted', expires_at: null, is_banned: 1, ban_reason: 'Test ban' };
    const writes = [];
    const query = async (sql, params) => {
      if (sql.startsWith('SELECT u.*')) return [user];
      if (sql.startsWith('SELECT COUNT')) return [{ total: 1 }];
      if (sql.startsWith('SELECT r.id')) return [{ id: 7, kind: 'support', subject: 'My appeal' }];
      if (sql.startsWith('SELECT * FROM site_requests') || sql.startsWith('SELECT id, kind FROM site_requests WHERE id=?')) {
        return Number(params[1]) === user.user_id && String(params[0]) === '7' ? [{ id: 7, user_id: 12, kind: 'support' }] : [];
      }
      if (sql.startsWith('SELECT id, kind')) return [{ id: 7, kind: 'support' }];
      if (sql.startsWith('SELECT id FROM site_request_messages')) return [];
      if (sql.startsWith('SELECT id, sender')) return [{ id: 1, sender: 'admin', body: 'We are reviewing your appeal.' }];
      writes.push({ sql, params });
      return { insertId: 7, affectedRows: 1 };
    };
    const db = { runQuery: query, withTransaction: fn => fn(null, query) };
    const auth = makeAuthHelpers(db, { SIGNED_COOKIE_OPTS: {}, DISPLAY_COOKIE_OPTS: {} });
    const routes = new Map();
    registerSiteRoutes({ app: { get: (path, fn) => routes.set(`GET ${path}`, fn), post: (path, fn) => routes.set(`POST ${path}`, fn), use() {} }, db, auth });
    async function request(route, { signedIn = true, id = '7' } = {}) {
      let status = 200, payload;
      const req = { method: route.split(' ')[0], ip: 'local', signedCookies: signedIn ? { user_id: 'a'.repeat(64) } : {},
        query: {}, params: { id }, body: { ...valid, category: 'account' }, get: name => name === 'sec-fetch-site' ? 'same-origin' : null };
      const res = { cookie() {}, clearCookie(name) { assert.notEqual(name, 'user_id'); }, set() { return this; },
        status(code) { status = code; return this; }, json(value) { payload = value; } };
      await routes.get(route)(req, res);
      return { status, payload };
    }
    const session = await request('GET /api/site/session');
    assert.equal(session.payload.member, true);
    assert.equal(session.payload.username, user.name);
    assert.equal(session.payload.unread, 1);
    assert.equal((await request('POST /api/support/requests')).payload.id, 7);
    assert.equal((await request('GET /api/support/requests')).payload.items[0].id, 7);
    const detail = await request('GET /api/support/requests/:id');
    assert.equal(detail.payload.messages[0].sender, 'admin');
    assert.equal((await request('POST /api/support/requests/:id/messages')).payload.id, 7);
    assert.equal(writes.find(entry => entry.sql.startsWith('INSERT INTO site_requests')).params[0], user.user_id);
    assert.equal(writes.find(entry => entry.sql.includes('(request_id,sender,author_id')).params[2], user.user_id);
    assert.equal((await request('GET /api/support/requests/:id', { id: '99' })).status, 404);
    assert.equal((await request('POST /api/support/requests/:id/messages', { id: '99' })).status, 404);
    assert.equal((await request('GET /api/support/requests', { signedIn: false })).status, 401);
    assert.equal((await request('GET /api/admin/support')).status, 403);
    assert.equal((await request('POST /api/feedback')).status, 401);
  });
  test('admin inbox bypasses request limits while preserving authorization and player limits', async t => {
    const { registerSiteRoutes } = require('../src/server/routes/modules/siteRoutes');
    t.mock.method(require('../src/server/services/email/emailService'), 'startEmailWorker', () => {});
    t.mock.method(require('../src/server/services/email/marketingService'), 'startMarketingWorker', () => {});
    t.mock.method(global, 'setInterval', () => ({ unref() {} }));
    const user = { user_id: 1, name: 'Admin' };
    let admin = user, queries = 0;
    const query = async sql => {
      queries++;
      if (sql.startsWith('SELECT COUNT')) return [{ total: 0 }];
      if (sql.startsWith('SELECT id, kind')) return [{ id: 7, kind: 'support' }];
      if (sql.startsWith('SELECT')) return [];
      return { affectedRows: 1, insertId: 7 };
    };
    const routes = new Map();
    registerSiteRoutes({
      app: { get: (path, fn) => routes.set(`GET ${path}`, fn), post: (path, fn) => routes.set(`POST ${path}`, fn), use() {} },
      db: { runQuery: query, withTransaction: fn => fn(null, query) },
      auth: { requireAdminUser: async () => admin, requireCurrentUser: async () => user, isGuest: () => false },
    });
    async function request(route, sameOrigin = true) {
      const req = { method: route.split(' ')[0], ip: 'local', query: {}, params: { id: '7' },
        body: { ...valid, status: 'closed', accepted: true, termsVersion: config.termsVersion, privacyVersion: config.privacyVersion },
        get: name => name === 'sec-fetch-site' ? (sameOrigin ? 'same-origin' : 'cross-site') : null };
      const res = { statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json() {} };
      await routes.get(route)(req, res);
      return res.statusCode;
    }
    for (let i = 0; i < 150; i++) assert.equal(await request('GET /api/admin/support'), 200);
    for (let i = 0; i < 20; i++) {
      assert.equal(await request('POST /api/admin/support/:id/status'), 200);
      assert.equal(await request('POST /api/admin/support/:id/messages'), 200);
    }
    // Console traffic consumed neither of the player-facing allowances.
    assert.equal(await request('GET /api/legal/status'), 200);
    assert.equal(await request('POST /api/legal/accept'), 200);
    let playerWriteStatus;
    for (let i = 0; i < 20 && playerWriteStatus !== 429; i++) playerWriteStatus = await request('POST /api/legal/accept');
    assert.equal(playerWriteStatus, 429);
    let playerReadStatus;
    for (let i = 0; i < 150 && playerReadStatus !== 429; i++) playerReadStatus = await request('GET /api/legal/status');
    assert.equal(playerReadStatus, 429);
    assert.equal(await request('POST /api/admin/support/:id/status'), 200);
    const before = queries;
    assert.equal(await request('POST /api/admin/support/:id/status', false), 403);
    admin = null;
    assert.equal(await request('GET /api/admin/support'), 403);
    assert.equal(await request('POST /api/admin/support/:id/messages'), 403);
    assert.equal(queries, before, 'unauthorized admin actions never reach the database');
  });
  test('profile reports validate the target and save verified identity and reason in support', async () => {
    const writes = [];
    const db = {
      runQuery: async (_sql, [id]) => id === 42 ? [{ user_id: 42, name: 'VerifiedName' }] : [],
      withTransaction: fn => fn(null, async (sql, params) => {
        writes.push({ sql, params });
        if (sql.startsWith('SELECT id, kind')) return [{ id: 7, kind: 'support' }];
        return { insertId: 7 };
      }),
    };
    const service = createSiteSupportService(db);
    const report = { targetUserId: 42, reason: 'cheating', message: 'Repeatedly moving through solid platforms.', submissionKey: valid.submissionKey, username: 'ForgedName', category: 'privacy' };
    assert.deepEqual(await service.createReport({ user_id: 12 }, report), { id: 7 });
    assert.deepEqual(writes[0].params.slice(0, 4), [12, 'support', 'reports', 'Report: VerifiedName (#42)']);
    assert.equal(writes[2].params[1], 12, 'author comes from the session');
    assert.match(writes[2].params[2], /Reported player: VerifiedName\nAccount ID: 42\nReason: Cheating or exploiting/);
    assert.ok(writes[2].params[2].endsWith(report.message));
    const count = writes.length;
    for (const fields of [{ targetUserId: 12 }, { targetUserId: 999 }, { targetUserId: '42' }, { reason: 'made-up' }, { message: 'x' }, { message: 'x'.repeat(3501) }, { submissionKey: '<script>bad</script>' }]) {
      await assert.rejects(service.createReport({ user_id: 12 }, { ...report, ...fields }), error => [400, 404].includes(error.status));
    }
    await assert.rejects(service.createReport({ user_id: 12 }, null), { status: 400 });
    assert.equal(writes.length, count, 'invalid reports never write');
    await assert.rejects(service.create({ user_id: 12 }, 'support', { ...valid, category: 'reports' }), { status: 400 }, 'ordinary submissions cannot forge reports');
  });
  test('admin Reports category filters the support inbox', async () => {
    const calls = [];
    const service = createSiteSupportService({ runQuery: async (sql, params) => {
      calls.push({ sql, params });
      return sql.includes('COUNT(*) AS total') ? [{ total: 1 }] : [{ id: 7, category: 'reports' }];
    } });
    const result = await service.list({ user_id: 1 }, true, { kind: 'support', category: 'reports' });
    assert.equal(result.items[0].category, 'reports');
    assert.deepEqual(calls[0].params, ['support', 'reports']);
    assert.deepEqual(calls[1].params, ['player', 'support', 'reports', 0]);
  });
  test('report recommendations distinguish repeated reports, registered reporters, and stale history', () => {
    const { reportRecommendation, REVIEW_POLICY } = require('../src/server/services/site/profileReportReview');
    const threshold = REVIEW_POLICY.memberReportersForReview;
    const saved = { totalReports: 100, uniqueReporters: 100, recentReports: 0, recentReporters: 0, recentMemberReporters: 0 };
    assert.equal(reportRecommendation(saved).code, 'hold', 'old reports do not suggest a new penalty');
    assert.equal(reportRecommendation({ ...saved, recentReports: 1, recentReporters: 1, recentMemberReporters: 1 }).code, 'hold');
    const repeated = { ...saved, recentReports: threshold * 10, recentReporters: 1, recentMemberReporters: 1 };
    assert.equal(reportRecommendation(repeated).code, 'investigate', 'one account cannot trigger the punishment suggestion with repeats');
    assert.equal(reportRecommendation({ ...repeated, recentReporters: threshold * 10, recentMemberReporters: 0 }).code, 'investigate', 'guest volume alone cannot trigger the punishment suggestion');
    assert.equal(reportRecommendation({ ...repeated, recentMemberReporters: threshold - 1 }).code, 'investigate');
    const recommendation = reportRecommendation({ ...repeated, recentReporters: threshold, recentMemberReporters: threshold });
    assert.equal(recommendation.code, 'consider_penalty');
    assert.match(recommendation.explanation, /Confirm the evidence before acting/);
  });
  test('report histories use the reserved category and stable target ID, including old names', () => {
    const { reportTargetId } = require('../src/server/services/site/profileReportReview');
    const report = { kind: 'support', category: 'reports', subject: 'Report: OldName (#42)' };
    assert.equal(reportTargetId(report), 42);
    assert.equal(reportTargetId({ ...report, subject: 'Report: NewName (#42)' }), 42);
    for (const fields of [{ kind: 'feedback' }, { category: 'other' }, { subject: 'Account ID: 42' }, { subject: 'Report: Name (#42) trailing text' }, { subject: 'Report: Name (#9007199254740992)' }]) {
      assert.equal(reportTargetId({ ...report, ...fields }), null);
    }
  });
  test('admin lists batch report counts by target and omit them from member responses', async () => {
    const calls = [];
    const rows = [
      { id: 7, kind: 'support', category: 'reports', subject: 'Report: OldName (#42)' },
      { id: 8, kind: 'support', category: 'reports', subject: 'Report: NewName (#42)' },
      { id: 9, kind: 'support', category: 'reports', subject: 'Report: Different (#142)' },
    ];
    const db = { runQuery: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('AS targetUserId')) return [
        { targetUserId: '42', totalReports: '6', uniqueReporters: '2', recentReports: '4', recentReporters: '1', recentMemberReporters: '1', activeReports: '3' },
        { targetUserId: '142', totalReports: '1', uniqueReporters: '1', recentReports: '1', recentReporters: '1', recentMemberReporters: '0', activeReports: '1' },
      ];
      if (sql.startsWith('SELECT COUNT')) return [{ total: rows.length }];
      return structuredClone(rows);
    } };
    const service = createSiteSupportService(db);
    const result = await service.list({ user_id: 1 }, true, { kind: 'support' });
    assert.equal(calls.length, 3, 'one batched statistics query for the whole inbox page');
    assert.deepEqual(calls[2].params, ['% (#42)', '% (#142)']);
    assert.equal(result.items[0].reportSummary.totalReports, 6);
    assert.deepEqual(result.items[0].reportSummary, result.items[1].reportSummary, 'renamed players share history');
    assert.equal(result.items[2].reportSummary.totalReports, 1, 'IDs with shared digits stay separate');
    calls.length = 0;
    const member = await service.list({ user_id: 12 }, false, {});
    assert.equal(calls.length, 2);
    assert.ok(member.items.every(item => !Object.hasOwn(item, 'reportSummary')));
  });
  test('admin report detail includes target, counts, advisory recommendation and linked history only for admins', async () => {
    const { REVIEW_POLICY } = require('../src/server/services/site/profileReportReview');
    const threshold = REVIEW_POLICY.memberReportersForReview;
    const request = { id: 7, user_id: 12, kind: 'support', category: 'reports', subject: 'Report: OldName (#42)' };
    const queries = [];
    const messages = [{ id: 1, sender: 'player', body: 'Reported player: OldName\nAccount ID: 42\nReason: Cheating or exploiting\n\nDetails.' }];
    const db = { withTransaction: fn => fn(null, async (sql, params) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT * FROM site_requests')) return [{ ...request }];
      if (sql.startsWith('SELECT id, sender')) return structuredClone(messages);
      if (sql.startsWith('SELECT name,')) return [{ name: 'Reporter' }];
      if (sql.startsWith('SELECT user_id,')) return [{ user_id: 42, name: 'NewName' }];
      if (sql.includes('AS targetUserId')) return [{ targetUserId: 42, totalReports: threshold + 2, uniqueReporters: threshold, recentReports: threshold, recentReporters: threshold, recentMemberReporters: threshold, activeReports: 1 }];
      if (sql.startsWith('SELECT r.id')) return [
        { id: 7, subject: request.subject, reporterId: 12, reporterName: 'Reporter', firstMessage: messages[0].body },
        { id: 8, subject: 'Report: NewName (#42)', reporterId: 13, firstMessage: 'Unrecognized header\nReason: Hate speech' },
      ];
      return { affectedRows: 1 };
    }) };
    const service = createSiteSupportService(db);
    const result = await service.detail({ user_id: 1 }, true, 7);
    assert.equal(result.request.userId, 12, 'request author stays the reporter');
    assert.equal(result.reportReview.targetUserId, 42, 'review targets the reported player');
    assert.equal(result.reportReview.targetName, 'NewName');
    assert.equal(result.reportReview.recommendation.code, 'consider_penalty');
    assert.equal(result.reportReview.history[0].reason, 'Cheating or exploiting');
    assert.equal(result.reportReview.history[1].reason, 'Unspecified', 'reason-like user text is not a trusted reason');
    assert.equal(Object.hasOwn(result.reportReview.history[0], 'firstMessage'), false);
    assert.deepEqual(queries.at(-1).params, ['% (#42)']);
    assert.ok(queries.filter(query => !query.sql.startsWith('SELECT')).every(query => query.sql.startsWith('UPDATE site_requests SET admin_read_at')), 'review only marks the request read and never applies penalties');
    queries.length = 0;
    const member = await service.detail({ user_id: 12 }, false, 7);
    assert.equal(Object.hasOwn(member, 'reportReview'), false);
    assert.equal(queries.length, 3, 'member detail never queries other reports or target history');
    request.category = 'account';
    queries.length = 0;
    const ordinary = await service.detail({ user_id: 1 }, true, 7);
    assert.equal(Object.hasOwn(ordinary, 'reportReview'), false);
    assert.equal(queries.length, 4, 'ordinary support detail does not load report statistics');
  });
  test('duplicate replies do not reopen a conversation or bump its timestamp',async()=>{
    const calls=[];const db={withTransaction:fn=>fn(null,async(sql)=>{calls.push(sql);if(sql.includes('FROM site_requests'))return [{id:1,kind:'support'}];if(sql.includes('FROM site_request_messages'))return [{id:5}];return {insertId:5,affectedRows:0};})};
    await createSiteSupportService(db).reply({user_id:12},false,1,valid);
    assert.equal(calls.length,2);
  });
  test('status validation and cleanup preserve open support',async()=>{
    const calls=[];const service=createSiteSupportService({runQuery:async(sql,params)=>{calls.push({sql,params});return {affectedRows:1};}});
    await assert.rejects(service.setStatus(1,'deleted'),{status:400});
    await service.cleanup();assert.match(calls[0].sql,/status='closed'/);assert.deepEqual(calls[0].params,[12,12]);
  });
  test('legal consent is explicit and tied to both current versions',()=>{
    const body={accepted:true,termsVersion:config.termsVersion,privacyVersion:config.privacyVersion};
    assert.equal(accepted(body),true);for(const other of [{accepted:'true'},{accepted:false},{termsVersion:'old'},{privacyVersion:'old'}])assert.equal(accepted({...body,...other}),false);
  });
  test('same-origin write policy rejects missing, foreign, and cross-site origins',()=>{
    const old=process.env.PUBLIC_BASE_URL;delete process.env.PUBLIC_BASE_URL;
    try{const request=(origin,site)=>({protocol:'http',get:key=>({'host':'localhost:31339','origin':origin,'sec-fetch-site':site}[key])});assert.equal(isSameOrigin(request('http://localhost:31339','same-origin')),true);assert.equal(isSameOrigin(request(undefined)),false);assert.equal(isSameOrigin(request('https://other.example')),false);assert.equal(isSameOrigin(request('http://localhost:31339','cross-site')),false);}finally{if(old===undefined)delete process.env.PUBLIC_BASE_URL;else process.env.PUBLIC_BASE_URL=old;}
  });
  test('signup rejects missing consent before touching credentials or account state',async()=>{
    const result=await completeSignupFromGuest({req:{body:{username:'validuser',password:'testpass'},signedCookies:{},cookies:{}},db:{runQuery:()=>{throw new Error('must not write');}}});
    assert.equal(result.statusCode,400);assert.match(result.payload.error,/Terms/);
  });
  test('Markdown lookup rejects traversal and unknown slugs; all manifest articles render',()=>{
    assert.equal(article('help','../../.env'),null);assert.equal(article('legal','anything'),null);assert.equal(article('help','missing'),null);
    const manifest=require('../content/manifest.json');for(const kind of ['news','help'])for(const item of manifest[kind])assert.ok(article(kind,item.slug).html.length>20);
    assert.match(article('legal','privacy').html,/support@brobattles.dev/);
  });
  test('article Markdown components render game chips and callouts, escape input, and search as plain words',()=>{
    const MarkdownIt=require('markdown-it');
    const {useMarkdownComponents,plainComponents}=require('../src/shared/site/markdownComponents.cjs');
    const {parseHTML}=require('linkedom');
    const md=useMarkdownComponents(new MarkdownIt({html:false}));
    const {document}=parseHTML(`<main>${md.render('Open {path:Profile > Account > Change Name} for {gems:50} <img src=x onerror=1> and {key:Left}.\n\n> [!WARNING]\n> Never share your password.\n\n> Just a quote.')}</main>`);
    assert.deepEqual([...document.querySelectorAll('.md-path > span:not(.bb-arrow):not(.bb-visually-hidden)')].map(step=>step.textContent),['Profile','Account','Change Name']);
    assert.equal(document.querySelector('.md-currency.is-gems b').textContent,'50');
    assert.ok(document.querySelector('kbd.md-key .bb-arrow-left'));
    assert.equal(document.querySelector('img[onerror]'),null);
    assert.equal(document.querySelectorAll('aside.md-callout.is-warning').length,1);
    assert.equal(document.querySelector('aside.md-callout p').textContent,'Never share your password.');
    assert.equal(document.querySelectorAll('blockquote').length,1);
    assert.equal(plainComponents('Costs {gems:50} via {path:A > B}'),'Costs 50 gems via A then B');
  });
  test('help search index includes article contents and Gemini can only return known articles',async()=>{
    const documents=helpSearchDocuments();
    assert.ok(documents.find(item=>item.slug==='matchmaking').content.includes('trophy count'));
    let request;
    const search=createHelpSearchService({apiKey:'test-key',fetchImpl:async(url,options)=>{
      request={url,options};
      return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({matches:[
        {slug:'matchmaking',reason:'Explains trophy-based matching.'},
        {slug:'not-real',reason:'Ignore this.'},
        {slug:'matchmaking',reason:'Duplicate.'},
      ]})}]}}]})};
    }});
    const result=await search('fair opponents');
    assert.match(request.url,new RegExp(MODEL));
    assert.equal(request.options.headers['x-goog-api-key'],'test-key');
    assert.deepEqual(result,{available:true,matches:[{slug:'matchmaking',reason:'Explains trophy-based matching.'}]});
    const sent=JSON.parse(request.options.body);
    assert.equal(sent.generationConfig.temperature,0);
    assert.ok(sent.contents[0].parts[0].text.includes('fair opponents'));
  });
  test('help AI search is optional and validates the public query',async()=>{
    const search=createHelpSearchService({apiKey:''});
    assert.deepEqual(await search('matchmaking'),{available:false,matches:[]});
    await assert.rejects(search('x'),{status:400});
    await assert.rejects(search('x'.repeat(161)),{status:400});
  });
  test('public page routes register without authentication and return HTML without game engines',()=>{
    const routes=new Map();registerSitePages({get:(path,fn)=>routes.set(path,fn)});
    let html='';routes.get('/about')({}, {send:value=>html=value});assert.match(html,/2D arena game/);assert.doesNotMatch(html,/phaser|socket.io|index.bundle.js/);
    assert.match(frame('<script>','" test','body','/test'),/&lt;script&gt;/);
    let status;routes.get('/news/:slug')({params:{slug:'missing'},path:'/news/missing'},{status:code=>{status=code;return {send(){}};}});assert.equal(status,404);
  });
  test('About explains current fighters and modes and gives each exploration link a real destination',()=>{
    const {parseHTML}=require('linkedom');
    const routes=new Map();registerSitePages({get:(path,fn)=>routes.set(path,fn)});
    let html='';routes.get('/about')({}, {send:value=>html=value});
    const {document}=parseHTML(html);
    const stats=require('../src/shared/characters').characterStats;
    // Each Bro has a tab and a panel with their real moves, plus level data
    // for the upgrade demo that matches the shared stat tables.
    const {getHealth,upgradePrice,LEVEL_CAP}=require('../src/shared/characters/characterStats');
    const levels=JSON.parse(document.getElementById('about-fighter-data').textContent);
    for(const [key,value] of Object.entries(stats)) {
      const fighter=document.getElementById(`fighter-${key}`);
      assert.equal(fighter.getAttribute('role'),'tabpanel');
      assert.equal(document.getElementById(`tab-${key}`).getAttribute('aria-controls'),`fighter-${key}`);
      assert.ok(fighter.textContent.includes(value.attackDescription));
      assert.ok(fighter.textContent.includes(value.specialDescription));
      assert.equal(levels[key].levels.length,LEVEL_CAP);
      assert.equal(levels[key].levels.at(-1).health,getHealth(key,LEVEL_CAP));
      assert.equal(levels[key].levels[0].price,upgradePrice(1));
    }
    // One panel is active; the rest share its space (so the box never resizes) and stay inert.
    assert.equal(document.querySelectorAll('[role="tabpanel"].is-active').length,1);
    assert.equal(document.querySelectorAll('[role="tabpanel"][inert]').length,Object.keys(stats).length-1);
    // Trophy Road lists real playable milestones in order; cosmetics come from the catalogs.
    const counts=[...document.querySelectorAll('[data-road-step] .about-road-count')].map(node=>Number(node.textContent.replace(/\D/g,'')));
    assert.ok(counts.length>1);
    assert.deepEqual(counts,[...counts].sort((a,b)=>a-b));
    // The road leaves out player cards (their art doesn't fit a small frame).
    assert.equal(document.querySelectorAll('.about-road-art.reward-card').length,0);
    // Every collection tile shows a real catalog item of its kind.
    const pools=JSON.parse(document.getElementById('about-cosmetic-data').textContent);
    const tiles=[...document.querySelectorAll('[data-cosmetics] [data-kind]')];
    assert.ok(tiles.length>0);
    for(const tile of tiles) assert.ok(pools[tile.dataset.kind].some(item=>item.name===tile.dataset.name),tile.dataset.name);
    const modes=require('../src/shared/catalogs/gameModes.catalog.json').modes;
    assert.deepEqual([...document.querySelectorAll('.about-mode')].map(node=>node.id),modes.filter(mode=>mode.implemented&&mode.queueable).map(mode=>`mode-${mode.id}`));
    for(const link of document.querySelectorAll('main a[href^="#"]')) assert.ok(document.querySelector(link.getAttribute('href')));
    const guide=parseHTML(article('help','modes-and-maps').html).document;
    for(const link of document.querySelectorAll('.about-mode a')) assert.ok(guide.getElementById(link.getAttribute('href').split('#')[1]));
    // The reel plays every clip in turn with no picker; each has its video and poster.
    const clips=require('../src/shared/site/aboutClips.json');
    assert.equal(document.querySelectorAll('[data-reel-clip]').length,0);
    assert.equal(document.querySelectorAll('.about-reel-progress > span').length,clips.length);
    for(const clip of clips) for(const ext of ['mp4','jpg']) assert.ok(require('node:fs').existsSync(require('node:path').join(__dirname,`../public/assets/site/gameplay/${clip.key}.${ext}`)),`${clip.key}.${ext}`);
    assert.equal(document.querySelector('video').getAttribute('preload'),'none');
    assert.equal(document.querySelector('video').hasAttribute('src'),false);
    assert.ok(document.querySelectorAll('main a[href="/"]').length>=1);
    assert.deepEqual([...document.querySelectorAll('.about-crew a')].map(link=>link.getAttribute('href')),['/']);
    assert.equal(document.querySelectorAll('.site-footer nav').length,3);
  });
  test('help topics expose every article and keep search status separate from the input label',()=>{
    const {parseHTML}=require('linkedom');
    const manifest=require('../content/manifest.json');
    const routes=new Map();registerSitePages({get:(path,fn)=>routes.set(path,fn)});
    let html='';routes.get('/help')({}, {send:value=>html=value});
    const {document}=parseHTML(html);
    const input=document.querySelector('#help-search');
    assert.ok(document.querySelector(`label[for="${input.id}"]`));
    const status=document.querySelector('#help-search-status');
    assert.equal(status.getAttribute('role'),'status');
    assert.equal(status.closest('label'),null);
    assert.equal(document.querySelector('.site-help-hero p'),null);
    const topics=[...document.querySelectorAll('[data-help-category]')];
    assert.deepEqual(topics.map(topic=>topic.querySelector('h2').textContent),[...new Set(manifest.help.map(item=>item.category))]);
    for(const item of manifest.help){
      const link=document.querySelector(`[data-help-slug="${item.slug}"]`);
      assert.equal(link.getAttribute('href'),`/help/${item.slug}`);
      assert.equal(link.querySelector('strong').textContent,item.title);
      assert.equal(link.querySelector('small').textContent,item.summary);
      assert.equal(link.closest('[data-help-category]').querySelector('h2').textContent,item.category);
    }
    assert.equal(document.querySelectorAll('[data-help-slug]').length,manifest.help.length);
    assert.equal(JSON.parse(document.querySelector('#help-search-documents').textContent).length,manifest.help.length);
  });
  test('news previews show one headline and an excerpt, and articles keep their headline and lobby action',()=>{
    const {parseHTML}=require('linkedom');
    const manifest=require('../content/manifest.json');
    const routes=new Map();registerSitePages({get:(path,fn)=>routes.set(path,fn)});
    const render=(route,request={})=>{
      let html='';routes.get(route)(request,{send:value=>html=value});
      return parseHTML(html).document;
    };
    const board=render('/news');
    const links=[...board.querySelectorAll('main a[href^="/news/"]')];
    const sorted=[...manifest.news].sort((a,b)=>b.date.localeCompare(a.date));
    assert.deepEqual(links.map(link=>link.getAttribute('href')),sorted.map(item=>`/news/${item.slug}`));
    assert.equal(board.querySelectorAll('main h1').length,1);
    assert.equal(board.querySelector('main h1').textContent,'Bro Battles News');
    assert.equal(board.querySelector('.site-news-heading').textContent,'Bro Battles News');
    for(const link of links){
      assert.equal(link.querySelectorAll('h2,h3').length,1);
      assert.equal(link.querySelector('.site-eyebrow'),null);
      assert.equal(link.querySelector('.site-news-read').textContent.trim(),'Read more');
    }
    assert.equal(links[0].querySelector('h2').textContent,sorted[0].title);
    for(const item of manifest.news){
      const document=render('/news/:slug',{params:{slug:item.slug},path:`/news/${item.slug}`});
      const story=document.querySelector('main article');
      assert.equal(story.querySelector('h1').textContent,item.title);
      assert.equal(story.querySelector('header .site-eyebrow'),null);
      assert.equal(story.querySelector('header .site-article-summary'),null);
      assert.equal(story.querySelector('time').getAttribute('datetime'),item.date);
      assert.equal(story.querySelector('.site-prose p').textContent,item.summary);
      assert.equal(story.querySelector('.site-news-cta a').getAttribute('href'),'/');
      assert.equal(story.querySelectorAll('.site-related a').length,manifest.news.length-1);
    }
    const help=render('/help/:slug',{params:{slug:'controls'},path:'/help/controls'});
    assert.ok(help.querySelector('.site-article-support'));
    assert.equal(help.querySelector('.site-news-cta'),null);
  });
  test('discovery metadata and sitemap use the configured public origin and published articles',()=>{
    const old=process.env.PUBLIC_BASE_URL;
    try {
      process.env.PUBLIC_BASE_URL='https://example.test';
      const routes=new Map();registerSitePages({get:(path,fn)=>routes.set(path,fn)});
      let body='', type='';
      const response={type(value){type=value;return this;},send(value){body=value;return this;},status(value){this.statusCode=value;return this;}};
      routes.get('/sitemap.xml')({},response);
      assert.equal(type,'application/xml');assert.match(body,/<loc>https:\/\/example\.test\/about<\/loc>/);
      assert.match(body,/<loc>https:\/\/example\.test\/help\/matchmaking<\/loc>/);
      assert.doesNotMatch(body,/help\/requests|party\//);
      routes.get('/robots.txt')({},response);assert.match(body,/Sitemap: https:\/\/example\.test\/sitemap.xml/);
      const html=frame('A & B','A "description"','', '/about');
      assert.match(html,/property="og:title" content="A &amp; B · Bro Battles"/);
      assert.match(html,/rel="canonical" href="https:\/\/example\.test\/about"/);
      routes.get('/help/requests')({},response);assert.match(body,/name="robots" content="noindex, follow"/);
      delete process.env.PUBLIC_BASE_URL;
      routes.get('/sitemap.xml')({},response);assert.equal(response.statusCode,503);
      routes.get('/robots.txt')({},response);assert.doesNotMatch(body,/Sitemap:/);
    } finally {if(old===undefined)delete process.env.PUBLIC_BASE_URL;else process.env.PUBLIC_BASE_URL=old;}
  });
  test('browser settings clamp values and preserve defaults with malformed storage',async()=>{
    const {normalizeSettings,DEFAULT_SETTINGS,GRAPHICS_OPTIONS,graphicsRenderScale}=await import('../src/client/site/preferences.js');
    assert.deepEqual(normalizeSettings(null),{...DEFAULT_SETTINGS});assert.deepEqual(normalizeSettings({sensitivity:100,sfx:-1,music:NaN,streamer:'yes'}),{...DEFAULT_SETTINGS,sensitivity:3,sfx:0});
    assert.deepEqual(GRAPHICS_OPTIONS.map(option=>[option.value,graphicsRenderScale(option.value)]),[
      ['low',0.5],['medium',1],['high',Math.SQRT2],['super-high',2],
    ]);
    assert.equal(normalizeSettings({graphics:'super-high'}).graphics,'super-high');
    assert.equal(normalizeSettings({graphics:'unknown'}).graphics,'high');
    assert.equal(graphicsRenderScale(undefined),Math.SQRT2);
  });

  test('same-origin metadata handles alias hosts and TLS proxies without allowing foreign requests', () => {
    const old = process.env.PUBLIC_BASE_URL; process.env.PUBLIC_BASE_URL='https://canonical.example';
    const request=(origin,site)=>({protocol:'http',get:key=>({host:'internal:3002',origin,'sec-fetch-site':site}[key])});
    try {
      assert.equal(isSameOrigin(request('https://alias.example','same-origin')),true);
      assert.equal(isSameOrigin(request('https://canonical.example',undefined)),true);
      assert.equal(isSameOrigin(request('https://evil.example','cross-site')),false);
      assert.equal(isSameOrigin(request('https://evil.example',undefined)),false);
    } finally { if(old===undefined)delete process.env.PUBLIC_BASE_URL;else process.env.PUBLIC_BASE_URL=old; }
  });

  // Exercise the real rename route with a transactional account store. The
  // authentication snapshot stays stale deliberately, as it can during requests.
  function nameChangeHarness({ gems = 200, cooldown = false, guest = false } = {}) {
    const { registerProfileRoutes } = require('../src/server/routes/modules/profileRoutes');
    const routes = new Map();
    const app = { locals: {}, get() {}, post: (path, handler) => routes.set(path, handler) };
    let account = { name: 'Original', gems, next_name_change_at: cooldown ? new Date('2099-01-01') : null };
    let partyName = account.name;
    let tail = Promise.resolve();
    const db = {
      withTransaction: async (fn) => {
        const previous = tail;
        let release;
        tail = new Promise(resolve => { release = resolve; });
        await previous;
        const saved = { ...account }, savedPartyName = partyName;
        try {
          return await fn(null, async (sql, params) => {
            if (sql.startsWith('SELECT name, gems')) {
              return [{ ...account, cooldown_active: account.next_name_change_at > new Date() ? 1 : 0 }];
            }
            if (sql.startsWith('UPDATE users')) {
              if (params[0] === 'Taken') throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
              account.name = params[0];
              account.gems -= params[1];
              account.next_name_change_at = new Date('2099-01-01');
              return { affectedRows: 1 };
            }
            if (sql.startsWith('UPDATE party_members')) {
              if (partyName === params[1]) partyName = params[0];
              return { affectedRows: 1 };
            }
            if (sql.startsWith('SELECT gems,')) return [{ ...account }];
            throw new Error(`Unexpected query: ${sql}`);
          });
        } catch (error) {
          account = saved;
          partyName = savedPartyName;
          throw error;
        } finally { release(); }
      },
    };
    registerProfileRoutes({ app, db, requireCurrentUser: async () => ({
      user_id: 7, name: 'Original', gems: 200, expires_at: guest ? new Date() : null,
    }) });
    return {
      account: () => ({ ...account }),
      partyName: () => partyName,
      expire: () => { account.next_name_change_at = new Date(0); },
      request: async username => {
        const response = { statusCode: 200, cookies: [],
          status(code) { this.statusCode = code; return this; },
          json(body) { this.body = body; return this; },
          cookie(...args) { this.cookies.push(args); },
        };
        await routes.get('/profile/change-username')({ app, body: { username } }, response);
        return response;
      },
    };
  }

  test('name changes charge gems, save cooldown and update party identity', async () => {
    const h = nameChangeHarness();
    const result = await h.request('NewName');
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.username, 'NewName');
    const { NAME_CHANGE_COST } = require('../src/server/routes/modules/profileRoutes');
    assert.equal(result.body.gems, 200 - NAME_CHANGE_COST);
    assert.equal(result.body.gems, h.account().gems);
    assert.ok(result.body.nextNameChangeAt > new Date());
    assert.equal(h.partyName(), 'NewName');
    assert.equal(result.cookies[0][1], 'NewName');
    const saved = h.account();
    assert.equal((await h.request('AnotherName')).statusCode, 429);
    assert.deepEqual(h.account(), saved);
    assert.equal((await h.request('NewName')).statusCode, 200);
    assert.deepEqual(h.account(), saved);
    h.expire();
    assert.equal((await h.request('AnotherName')).statusCode, 200);
    assert.equal(h.partyName(), 'AnotherName');
    assert.ok(h.account().gems < saved.gems);
  });

  test('name changes reject invalid, taken, guest and unaffordable requests without charging', async () => {
    for (const [options, name, status] of [
      [{}, 'x', 400], [{}, 'Taken', 409],
      [{ guest: true }, 'NewName', 403], [{ gems: 0 }, 'NewName', 400],
      [{ cooldown: true }, 'NewName', 429],
    ]) {
      const h = nameChangeHarness(options), saved = h.account();
      const result = await h.request(name);
      assert.equal(result.statusCode, status, name);
      assert.deepEqual(h.account(), saved);
      assert.equal(h.partyName(), 'Original');
      assert.equal(result.cookies.length, 0);
    }
  });

  test('overlapping name changes only charge for one successful change', async () => {
    const h = nameChangeHarness();
    const results = await Promise.all([h.request('FirstName'), h.request('SecondName')]);
    assert.deepEqual(results.map(result => result.statusCode), [200, 429]);
    assert.equal(h.account().gems, results[0].body.gems);
    assert.equal(h.account().name, 'FirstName');
  });

  test('lobby profile wires its actual Change Name button to the shared dialog', () => {
    const { transformFileSync } = require('@babel/core');
    const vm = require('node:vm');
    const button = {};
    const overlay = { querySelector: () => null };
    let wiredButton, options;
    const context = {
      exports: {},
      document: {
        getElementById: id => id === 'profile-overlay' ? overlay : id === 'profile-change-name' ? button : null,
        addEventListener() {},
      },
      require: request => {
        if (request.includes('nameChangeDialog')) return { wireNameChangeDialog: (target, config) => { wiredButton = target; options = config; } };
        if (request.includes('accountSettings')) return { wireAccountSettings: () => ({ close() {} }) };
        if (request.includes('wallet')) return { subscribeWallet() {} };
        return {};
      },
    };
    const compiled = transformFileSync(require.resolve('../src/client/lobby/profile/profileController.js'), {
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    });
    vm.runInNewContext(compiled.code, context);
    context.exports.createProfileController({ getUserData: () => ({}) }).initProfilePopup();
    assert.equal(wiredButton, button);
    assert.equal(typeof options.getProfile, 'function');
    assert.equal(typeof options.onChanged, 'function');
  });

  function nameDialogHarness(profile, fetchJson = async () => ({})) {
    const { transformFileSync } = require('@babel/core');
    const vm = require('node:vm');
    function element() {
      return { handlers: {}, isConnected: true, disabled: false,
        addEventListener(type, fn) { this.handlers[type] = fn; },
        setAttribute() {}, focus() { this.focused = true; }, remove() { this.isConnected = false; },
      };
    }
    const button = element(), input = element(), submit = element(), form = element();
    const message = element(), availability = element(), cancel = element(), validation = element(), validationReason = element();
    const dialog = Object.assign(element(), {
      querySelector: selector => ({ form, input, '[type="submit"]': submit,
        '.name-change-message': message, '.name-change-availability': availability, '.name-change-validation': validation, '.name-change-validation-reason': validationReason })[selector],
      querySelectorAll: selector => selector === '[data-close]' ? [cancel] : [],
      showModal() { this.open = true; },
      close() { this.open = false; this.handlers.close?.(); },
    });
    const windowHandlers = new Map();
    let pendingValidation;
    let changed;
    const context = {
      exports: {}, Date, AbortController,
      setTimeout: fn => { pendingValidation = fn; return 1; },
      clearTimeout: () => { pendingValidation = null; },
      document: { createElement: () => dialog, body: { append() {} } },
      window: {
        addEventListener: (type, fn, capture) => windowHandlers.set(type, { fn, capture }),
        removeEventListener: type => windowHandlers.delete(type),
      },
      require: request => request.includes('popupMotion') ? { dismissPopup: (_dialog, done) => done() }
        : request.includes('dialogDismiss') ? { wireBackdropDismiss() {} } : {},
    };
    const compiled = transformFileSync(require.resolve('../src/client/account/nameChangeDialog.js'), {
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    });
    vm.runInNewContext(compiled.code, context);
    context.exports.wireNameChangeDialog(button, {
      getProfile: () => profile, fetchJson, onChanged: data => { changed = data; },
    });
    return { button, dialog, input, submit, availability, validation, validationReason, windowHandlers,
      check: () => pendingValidation?.(),
      changed: () => changed,
      open: () => button.handlers.click(),
      save: () => form.handlers.submit({ preventDefault() {} }),
    };
  }

  test('name dialog traps Escape before the parent and restores focus', () => {
    const h = nameDialogHarness({ guest: false, username: 'Player', gems: 100 });
    h.open();
    assert.equal(h.dialog.open, true);
    assert.equal(h.input.value, 'Player');
    const escape = h.windowHandlers.get('keydown');
    assert.equal(escape.capture, true);
    let prevented = false, stopped = false;
    escape.fn({ key: 'Escape', preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } });
    assert.ok(prevented && stopped);
    assert.equal(h.dialog.open, false);
    assert.equal(h.button.focused, true);
    assert.equal(h.windowHandlers.has('keydown'), false);
  });

  test('name dialog blocks cooldown and insufficient funds, and publishes an acknowledged wallet change', async () => {
    for (const profile of [
      { guest: false, gems: 0 },
      { guest: false, gems: 100, nextNameChangeAt: '2099-01-01T00:00:00Z' },
    ]) {
      const h = nameDialogHarness(profile, () => { throw new Error('must not submit'); });
      h.open();
      assert.equal(h.submit.disabled, true);
      await h.save();
      assert.equal(h.changed(), undefined);
    }
    const profile = { guest: false, gems: 100, username: 'Original' };
    const response = { username: 'NewName', gems: 50, nextNameChangeAt: '2099-01-01T00:00:00Z' };
    const h = nameDialogHarness(profile, async () => response);
    h.open();
    h.input.value = 'NewName';
    await h.save();
    assert.equal(h.changed(), response);
    assert.equal(profile.username, response.username);
    assert.equal(profile.gems, response.gems);
    assert.equal(profile.nextNameChangeAt, response.nextNameChangeAt);
    assert.equal(h.dialog.open, false);
  });


  test('name dialog validates input and checks username availability before enabling payment', async () => {
    const requests = [];
    const h = nameDialogHarness({ guest: false, username: 'Original', gems: 100 }, async url => {
      requests.push(url);
      return { available: url.includes('FreeName') };
    });
    h.open();
    h.input.value = 'no spaces';
    h.input.handlers.input();
    assert.equal(h.validation.textContent, '×');
    assert.match(h.validationReason.textContent, /3–14/);
    assert.equal(h.submit.disabled, true);
    assert.equal(requests.length, 0);
    h.input.value = 'TakenName';
    h.input.handlers.input();
    assert.equal(h.validation.textContent, '…');
    await h.check();
    assert.equal(h.validation.textContent, '×');
    assert.match(h.validationReason.textContent, /already taken/);
    assert.equal(h.submit.disabled, true);
    h.input.value = 'FreeName';
    h.input.handlers.input();
    await h.check();
    assert.equal(h.validation.textContent, '✓');
    assert.equal(h.validationReason.textContent, '');
    assert.equal(h.submit.disabled, false);
    assert.match(requests[1], /username-availability\?username=FreeName/);
  });

  test('deployment version compares exact commits, caches checks, and never calls modified builds current', async () => {
    const { createVersionService } = require('../src/server/services/site/buildVersion');
    const commit = 'a'.repeat(40); let calls = 0; let time = 0;
    const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ sha: commit }) }; };
    const get = createVersionService({ build: { commit, build: 42, dirty: false }, production: true, fetchImpl, now: () => time });
    const results = await Promise.all([get(), get()]);
    assert.equal(results[0].status, 'current'); assert.equal(calls, 1);
    await get(); assert.equal(calls, 1);
    time += 61000; await get(); assert.equal(calls, 2);
    for (const [build, expected] of [[{ commit: 'b'.repeat(40) }, 'different'], [{ commit, dirty: true }, 'modified']]) {
      assert.equal((await createVersionService({ build, production: true, fetchImpl })()).status, expected);
    }
    assert.equal((await createVersionService({ build: null, production: true, fetchImpl })()).status, 'unknown');
    assert.equal((await createVersionService({ build: { commit }, production: false, fetchImpl })()).status, 'development');
  });

  test('deployment checks become unknown after failed refreshes and invalid remote responses', async () => {
    const { createVersionService } = require('../src/server/services/site/buildVersion');
    const commit = 'a'.repeat(40); let time = 0;
    const get = createVersionService({ build: { commit }, production: true, now: () => time,
      fetchImpl: async () => { if (time) throw new Error('offline'); return { ok: true, json: async () => ({ sha: commit }) }; } });
    assert.equal((await get()).status, 'current'); time = 61000;
    assert.equal((await get()).status, 'unknown');
    for (const response of [{ ok: false }, { ok: true, json: async () => ({ sha: 'bad' }) }]) {
      assert.equal((await createVersionService({ build: { commit }, production: true, fetchImpl: async () => response })()).status, 'unknown');
    }
  });

  test('build stamps follow Git history and mark uncommitted changes', () => {
    const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
    const { execFileSync } = require('node:child_process');
    const { createBuildVersion } = require('../scripts/build/buildVersion.cjs');
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-version-'));
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
    try {
      git('init'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
      git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'first');
      const first = createBuildVersion({ cwd }); assert.equal(first.dirty, false);
      git('-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'second');
      const second = createBuildVersion({ cwd });
      assert.equal(second.build, first.build + 1); assert.notEqual(second.commit, first.commit);
      fs.writeFileSync(path.join(cwd, 'new.txt'), 'local edits');
      assert.equal(createBuildVersion({ cwd }).dirty, true);
      fs.writeFileSync(path.join(cwd, '.git/shallow'), second.commit + '\n');
      assert.throws(() => createBuildVersion({ cwd }), /full Git history/);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });
});

describe("HTML escaping", () => {
  const { escapeHtml, assetUrl } = require("../src/shared/site/html.cjs");

  test("HTML text and quoted attributes preserve text without creating markup", () => {
    assert.equal(escapeHtml(`<img src=x onerror="alert('x')">&`), "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;");
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
    assert.equal(escapeHtml(0), "0");
    assert.equal(escapeHtml("&lt;"), "&amp;lt;");
  });

  test("catalog artwork stays inside the local assets directory", () => {
    const fallback = "/assets/player-cards/default/default.webp";
    for (const value of ["javascript:alert(1)", "https://example.com/a.webp", "//example.com/a.webp", "/assets/../../account", "/assets/%2e%2e/account", "/assets/\\evil", "/assets/a\nb.webp", null]) {
      assert.equal(assetUrl(value), fallback, String(value));
    }
    assert.equal(assetUrl("/assets/player-cards/default/default.webp?v=2"), "/assets/player-cards/default/default.webp?v=2");
  });
});
