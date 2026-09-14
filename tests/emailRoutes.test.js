const {test}=require('node:test');const assert=require('node:assert/strict');
const {registerEmailRoutes}=require('../src/server/routes/modules/emailRoutes');
const {hashCode}=require('../src/server/services/emailService');
process.env.EMAIL_VERIFICATION_SECRET='route-test-secret';
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
