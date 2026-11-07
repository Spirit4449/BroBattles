const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

describe("Server email workflows", () => {
  const { test, describe, beforeEach } = require('node:test');


  beforeEach(t => {
    const saved = { EMAIL_VERIFICATION_SECRET: process.env.EMAIL_VERIFICATION_SECRET, EMAIL_API_KEY: process.env.EMAIL_API_KEY };
    t.after(() => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    });
    process.env.EMAIL_VERIFICATION_SECRET = 'isolated-verification-test';
  });

  describe("Template, digest and transport", () => {
    const {template,hashCode,sendEmail}=require('../src/server/services/email/emailService');
    test('email template escapes user content and includes plain text',()=>{
     const result=template('New feedback','<img src=x onerror=alert(1)>');
     assert.ok(!result.html.includes('<img src=x onerror=alert(1)>'));
     assert.ok(result.html.includes('&lt;img'));
     assert.match(result.html,/<img[^>]+wordmark\.png/);
     assert.ok(result.text.includes('<img'));
     assert.match(template('Verify','Hello','123456').html,/123456/);
    });
    test('verification digest is bound to account, address and code',()=>{
     process.env.EMAIL_VERIFICATION_SECRET='test-secret';
     assert.equal(hashCode(1,'a@example.com','123456').length,64);
     assert.notEqual(hashCode(1,'a@example.com','123456'),hashCode(2,'a@example.com','123456'));
     assert.notEqual(hashCode(1,'a@example.com','123456'),hashCode(1,'b@example.com','123456'));
    });
    test('Resend transport supports configured key, idempotency and fails on provider error',async()=>{
     const original=global.fetch;process.env.EMAIL_API_KEY='test-key';
     global.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');assert.equal(options.headers['Idempotency-Key'],'request-1');const body=JSON.parse(options.body);assert.deepEqual(body.to,['test@example.com']);return {ok:false,status:429};};
     try{await assert.rejects(sendEmail('test@example.com',template('Title','Body'),'request-1'),/429/);}finally{global.fetch=original;}
    });
  });

  describe("Email verification and unsubscribe routes", () => {
    const {registerEmailRoutes}=require('../src/server/routes/modules/emailRoutes');
    const {hashCode}=require('../src/server/services/email/emailService');

    function harness(row){const routes={};const queries=[];const db={withTransaction:async fn=>fn(null,async(sql,args)=>{queries.push({sql,args});if(sql.startsWith('SELECT'))return row?[row]:[];return {affectedRows:1};}),runQuery:async()=>row?[row]:[]};registerEmailRoutes({app:{get:(p,f)=>routes[p]=f,post:(p,f)=>routes[p]=f},db,requireCurrentUser:async()=>({user_id:1})});return {queries,call:async(path,body={},site='same-origin')=>{const res={statusCode:200,set(){return this},status(n){this.statusCode=n;return this},json(data){this.data=data;return this}};await routes[path]({method:'POST',ip:'test',get:k=>k==='sec-fetch-site'?site:null,body},res);return res;}};}
    test('invalid codes increment attempts without verifying email',async()=>{const row={code_hash:hashCode(1,'a@example.com','123456'),pending_email:'a@example.com',expires_at:new Date(Date.now()+60000),attempts:0};const h=harness(row);const r=await h.call('/profile/email/verify',{code:'111111'});assert.equal(r.statusCode,400);assert.ok(h.queries.some(q=>q.sql.includes('attempts=attempts+1')));assert.ok(!h.queries.some(q=>q.sql.includes('email=pending_email')));});
    test('valid code verifies address and consumes the challenge',async()=>{const h=harness({code_hash:hashCode(1,'a@example.com','123456'),pending_email:'a@example.com',expires_at:new Date(Date.now()+60000),attempts:0});const r=await h.call('/profile/email/verify',{code:'123456'});assert.equal(r.data.email,'a@example.com');assert.ok(h.queries.some(q=>q.sql.includes('code_hash=NULL')));});
    test('expired, exhausted and consumed challenges fail closed',async()=>{for(const row of [{code_hash:'x',expires_at:new Date(0),attempts:0},{code_hash:'x',expires_at:new Date(Date.now()+60000),attempts:5},{}]){const h=harness(row);assert.equal((await h.call('/profile/email/verify',{code:'123456'})).statusCode,400);assert.equal(h.queries.length,1);}});
    test('cross-site writes and invalid email are rejected before database access',async()=>{const h=harness();assert.equal((await h.call('/profile/email/send-code',{email:'a@example.com'},'cross-site')).statusCode,403);assert.equal((await h.call('/profile/email/send-code',{email:'bad'})).statusCode,400);assert.equal(h.queries.length,0);});
    test('resend cooldown and persistent hourly cap prevent sending',async()=>{for(const row of [{sent_at:new Date(),window_start:new Date(),send_count:1},{sent_at:new Date(Date.now()-120000),window_start:new Date(),send_count:5}]){const h=harness(row);assert.equal((await h.call('/profile/email/send-code',{email:'a@example.com'})).statusCode,429);}});

    test('unsubscribe is login-free, escapes display content, and rejects missing tokens',async()=>{
     const routes={},queries=[];let row={user_id:1,email:'<test>@example.com'},fail=false;
     const q=async(sql)=>{queries.push(sql);if(fail)throw Object.assign(new Error('unavailable'),{code:'TEST_DB_DOWN'});return sql.startsWith('SELECT')?(row?[row]:[]):{};};
     registerEmailRoutes({app:{get:(p,f)=>routes['GET '+p]=f,post:(p,f)=>routes['POST '+p]=f},db:{runQuery:q,withTransaction:fn=>fn(null,q)},requireCurrentUser:()=>{throw new Error('Unsubscribe must not require login');}});
     const call=async method=>{const res={statusCode:200,set(){return this;},status(code){this.statusCode=code;return this;},send(html){this.html=html;return this;}};await routes[method+' /email/unsubscribe/:id']({params:{id:'test-token'}},res);return res;};
     const page=await call('GET');assert.match(page.html,/&lt;test&gt;/);assert.doesNotMatch(page.html,/<test>/);
     assert.equal((await call('POST')).statusCode,200);assert.ok(queries.some(sql=>sql.includes('cancelled_at=NOW(3)')));
     row=null;assert.equal((await call('POST')).statusCode,404);
     fail=true;assert.equal((await call('GET')).statusCode,503);
    });
  });

  describe("Marketing preferences", () => {
    const { welcomeEmail } = require('../src/server/services/email/marketingService');

    test('welcome marketing email uses the branded email frame and compliance links', () => {
      const previousBaseUrl = process.env.PUBLIC_BASE_URL;
      const previousAddress = process.env.MARKETING_POSTAL_ADDRESS;
      process.env.PUBLIC_BASE_URL = 'https://play.example.com';
      process.env.MARKETING_POSTAL_ADDRESS = '123 Battle Lane';

      try {
        const result = welcomeEmail('player@example.com', 'unsubscribe-token');
        assert.match(result.html, /assets\/logos\/wordmark\.png/);
            assert.match(result.html, />Play now<\/a>/);
        assert.match(result.html, /email\/unsubscribe\/unsubscribe-token/);
        assert.match(result.html, /123 Battle Lane/);
        assert.doesNotMatch(result.html, /PLAYER MESSAGE/);
        assert.equal(result.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      } finally {
        if (previousBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
        else process.env.PUBLIC_BASE_URL = previousBaseUrl;
        if (previousAddress === undefined) delete process.env.MARKETING_POSTAL_ADDRESS;
        else process.env.MARKETING_POSTAL_ADDRESS = previousAddress;
      }
    });

    test('Broadcast opt-outs cancel pending welcome mail and update local preferences',async()=>{
      const {readSubscription}=require('../src/server/services/email/marketingService');
      const originalFetch=global.fetch,previousKey=process.env.RESEND_MARKETING_API_KEY;
      process.env.RESEND_MARKETING_API_KEY='test-key';
      const queries=[];
      const q=async(sql)=>{queries.push(sql);if(sql.startsWith('SELECT email,'))return [{email:'test@example.com',subscribed:1}];if(sql.startsWith('SELECT synced_at'))return [{synced_at:new Date()}];return {};};
      try{
        global.fetch=async()=>({ok:true,json:async()=>({unsubscribed:true})});
        assert.equal(await readSubscription(q,1),false);
        assert.ok(queries.some(sql=>sql.includes('UPDATE marketing_jobs SET cancelled_at')));
        global.fetch=async()=>({ok:false});
        await assert.rejects(readSubscription(q,1),/Unable to check/);
      }finally{global.fetch=originalFetch;if(previousKey===undefined)delete process.env.RESEND_MARKETING_API_KEY;else process.env.RESEND_MARKETING_API_KEY=previousKey;}
    });

    test('an explicit local subscription change waits to sync before checking provider state',async()=>{
      const {readSubscription}=require('../src/server/services/email/marketingService');
      const previousKey=process.env.RESEND_MARKETING_API_KEY,originalFetch=global.fetch;
      process.env.RESEND_MARKETING_API_KEY='test-key';
      try{
        global.fetch=async()=>{throw new Error('Must not fetch stale provider preferences');};
        assert.equal(await readSubscription(async sql=>sql.startsWith('SELECT email,')?[{email:'test@example.com',subscribed:1}]:[{synced_at:null}],1),true);
      }finally{global.fetch=originalFetch;if(previousKey===undefined)delete process.env.RESEND_MARKETING_API_KEY;else process.env.RESEND_MARKETING_API_KEY=previousKey;}
    });
  });

  describe("Signup activation", () => {
    const {verifySignup,pendingSignup,cancelSignup}=require('../src/server/services/auth/signupVerificationService');
    const {createAuthSessionService}=require('../src/server/services/auth/authSessionService');
    const {hashCode}=require('../src/server/services/email/emailService');
    const config=require('../src/shared/site/siteConfig.json');

    function harness({invalid=false,collision=false,commitFailure=false}={}) {
      const cookies=[],queries=[],events=[];
      const guest={user_id:7,expires_at:new Date(Date.now()+3600000),is_banned:0};
      const pending={challenge_id:'challenge',code_hash:hashCode('signup:challenge','test@example.com','123456'),email:'test@example.com',username:'Tester',password_hash:'hashed',attempts:0,expires_at:new Date(Date.now()+600000),terms_version:config.termsVersion,privacy_version:config.privacyVersion,marketing_consent:true};
      const q=async(sql,args)=>{queries.push(sql);if(sql.startsWith('SELECT * FROM users'))return [guest];if(sql.includes('FROM pending_signups'))return [pending];if(sql.startsWith('SELECT'))return [];if(collision&&sql.startsWith('INSERT INTO account_emails'))throw Object.assign(new Error('duplicate'),{code:'ER_DUP_ENTRY'});return {affectedRows:1};};
      const db={runQuery:q,withTransaction:async fn=>{try{const result=await fn(null,q);if(commitFailure)throw new Error('commit failed');events.push('commit');return result;}catch(error){events.push('rollback');throw error;}}};
      const res={cookie(name){cookies.push(name);events.push('cookie');}};
      const app={locals:{authSessions:createAuthSessionService({db,cookieOptions:{}})}};
      return {cookies,queries,events,context:{app,db,res,requireCurrentUser:async()=>guest,req:{body:{challengeId:'challenge',code:invalid?'000000':'123456'},signedCookies:{}}}};
    }
    test('signup activation issues permanent cookies only after verification commits',async()=>{
      const h=harness();const result=await verifySignup(h.context);
      assert.equal(result.statusCode,201);
      assert.deepEqual(h.events,['commit','cookie','cookie']);
      assert.ok(h.queries.some(q=>q.startsWith('DELETE FROM auth_sessions')));
      assert.ok(h.queries.some(q=>q.startsWith('INSERT INTO marketing_jobs')));
    });
    test('wrong signup code leaves guest account and cookies untouched',async()=>{
      const h=harness({invalid:true});assert.equal((await verifySignup(h.context)).statusCode,400);
      assert.equal(h.cookies.length,0);assert.ok(h.queries.some(q=>q.includes('attempts=attempts+1')));
      assert.ok(!h.queries.some(q=>q.startsWith('UPDATE users')||q.startsWith('DELETE FROM auth_sessions')));
    });
    test('activation collision or failed commit never issues an account cookie',async()=>{
      const collision=harness({collision:true});assert.equal((await verifySignup(collision.context)).statusCode,409);
      assert.deepEqual(collision.events,['rollback']);assert.equal(collision.cookies.length,0);
      const failed=harness({commitFailure:true});await assert.rejects(verifySignup(failed.context),/commit failed/);
      assert.deepEqual(failed.events,['rollback']);assert.equal(failed.cookies.length,0);
    });
    test('editing cancels the challenge without deleting cooldown history',async()=>{
      const h=harness();assert.equal((await cancelSignup(h.context)).statusCode,200);
      assert.ok(h.queries[0].includes('code_hash=NULL'));assert.ok(!h.queries[0].includes('sent_at='));assert.ok(!h.queries[0].includes('correction_used='));
    });
  });
});

describe("Client email settings", () => {
  test('email settings request is made only for a confirmed member profile', async () => {
    const source = babel.transformSync(fs.readFileSync('src/client/account/emailSettings.js', 'utf8'), {
      babelrc: false, configFile: false,
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    }).code;
    const toggle = { dataset: {}, addEventListener() {} };
    const status = { textContent: '' };
    const api = {};
    vm.runInNewContext(source, {
      exports: api,
      require: () => ({}),
      document: { getElementById: id => id === 'email-toggle' ? toggle : status },
    });
    const requests = [];
    const fetchJson = async url => { requests.push(url); return { email: 'member@example.com' }; };

    api.wireEmailSettings(fetchJson, { guest: true });
    api.wireEmailSettings(fetchJson, {});
    assert.deepEqual(requests, []);
    assert.equal(toggle.dataset.emailWired, undefined);

    api.wireEmailSettings(fetchJson, { guest: false });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests, ['/profile/email']);
    assert.equal(status.textContent, 'member@example.com');
    api.wireEmailSettings(fetchJson, { guest: false });
    assert.equal(requests.length, 1);
  });

  test('preference feedback uses modal Sonner and Escape leaves the underlying profile alone', async () => {
    const source = babel.transformSync(fs.readFileSync('src/client/account/emailSettings.js', 'utf8'), {
      babelrc: false, configFile: false,
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    }).code;
    function node() {
      return { dataset: {}, handlers: {}, value: '', textContent: '', hidden: false,
        classList: { toggle() {} }, addEventListener(type, fn) { this.handlers[type] = fn; },
        setAttribute() {}, focus() {}, append() {}, remove() {} };
    }
    const toggle = node(), status = node(), children = new Map(), dialog = node();
    dialog.querySelector = selector => {
      if (!children.has(selector)) children.set(selector, node());
      return children.get(selector);
    };
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; dialog.handlers.close(); };
    const listeners = new Map(), toasts = [], api = {};
    const cooldown = { remaining: () => 32, set() {}, dispose() {} };
    vm.runInNewContext(source, {
      exports: api,
      require: name => name.includes('sonner.js') ? { sonner: (...args) => toasts.push(args) }
        : name.includes('emailVerificationUI') ? { createCooldown: () => cooldown, wireCodeInputs: () => ({clear() {},focus() {},value: () => '123456'}) }
        : { wireBackdropDismiss() {} },
      window: { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) },
      document: { getElementById: id => id === 'email-toggle' ? toggle : status,
        createElement: tag => tag === 'dialog' ? dialog : node(), body: {append() {}} },
    });
    let fail = false;
    api.wireEmailSettings(async (url, options) => {
      if (options && fail) throw new Error('Try again');
      return url.endsWith('/marketing') ? {subscribed:false} : {email:'member@example.com'};
    }, {guest:false});
    await new Promise(resolve => setImmediate(resolve));
    toggle.handlers.click();
    await new Promise(resolve => setImmediate(resolve));
    const marketing = children.get('[data-marketing]');
    marketing.checked = true;
    await marketing.handlers.change();
    assert.equal(toasts[0][0], 'Email preference saved.');
    assert.equal(toasts[0][4].containerId, 'email-settings-toasts');
    assert.equal(children.get('[data-message]').hidden, true);
    assert.equal(children.get('[data-send]').textContent, 'Send code in 32 sec');
    fail = true;
    marketing.checked = false;
    await marketing.handlers.change();
    assert.equal(marketing.checked, true);
    assert.equal(toasts[1][4].tone, 'error');
    let prevented = false, stopped = false;
    listeners.get('keydown')({key:'Escape', preventDefault() {prevented=true;}, stopImmediatePropagation() {stopped=true;}});
    assert.equal(dialog.open, false);
    assert.ok(prevented && stopped);
    assert.equal(listeners.has('keydown'), false);
  });
});
