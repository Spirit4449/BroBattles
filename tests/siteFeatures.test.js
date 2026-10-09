const test = require('node:test');
const assert = require('node:assert/strict');
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
test('support ownership is checked before reads or writes',async()=>{
  const calls=[];const db={withTransaction:fn=>fn(null,async(sql,params)=>{calls.push({sql,params});return [];})};
  const service=createSiteSupportService(db);
  await assert.rejects(service.detail({user_id:12},false,99),{status:404});
  await assert.rejects(service.reply({user_id:12},false,99,valid),{status:404});
  assert.equal(calls.length,2);for(const call of calls){assert.match(call.sql,/user_id=\?/);assert.deepEqual(call.params,[99,12]);}
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
  let html='';routes.get('/about')({}, {send:value=>html=value});assert.match(html,/One more match/);assert.doesNotMatch(html,/phaser|socket.io|index.bundle.js/);
  assert.match(frame('<script>','" test','body','/test'),/&lt;script&gt;/);
  let status;routes.get('/news/:slug')({params:{slug:'missing'},path:'/news/missing'},{status:code=>{status=code;return {send(){}};}});assert.equal(status,404);
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
