// Uses connection-local temporary tables; no real account or mail is modified.
require('dotenv').config({quiet:true});
const mysql=require('mysql2/promise');
const assert=require('node:assert/strict');
const {registerEmailRoutes}=require('../src/server/routes/modules/emailRoutes');
const {createSiteSupportService}=require('../src/server/services/siteSupportService');
(async()=>{
 const conn=await mysql.createConnection({host:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT)||3306,user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'game'});
 const originalFetch=global.fetch;let deliveredCode;
 try{
  for(const table of ['account_emails','email_marketing','marketing_contact_sync','marketing_jobs','site_requests','site_request_messages','email_outbox'])await conn.query(`CREATE TEMPORARY TABLE email_test_${table} LIKE ${table}`);
  global.fetch=async(_url,options)=>{deliveredCode=JSON.parse(options.body).text.match(/\n\n(\d{6})\n\n/)[1];return {ok:true};};
  const q=async(sql,params=[])=>{const rewritten=sql.replace(/\b(account_emails|email_marketing|marketing_contact_sync|marketing_jobs|site_requests|site_request_messages|email_outbox)\b/g, name=>`email_test_${name}`);const [rows]=await conn.query(rewritten,params);return rows;};
  const db={runQuery:q,withTransaction:async fn=>{await conn.beginTransaction();try{const result=await fn(conn,q);await conn.commit();return result;}catch(error){await conn.rollback();throw error;}}};
  const routes={};registerEmailRoutes({app:{get:(p,f)=>routes[p]=f,post:(p,f)=>routes[p]=f},db,requireCurrentUser:async()=>({user_id:2147483000})});
  const call=async(path,body={})=>{const res={statusCode:200,set(){return this},status(n){this.statusCode=n;return this},json(data){this.data=data;return this}};await routes[path]({method:'POST',ip:'127.0.0.1',get:k=>k==='sec-fetch-site'?'same-origin':null,body},res);return res;};
  assert.equal((await call('/profile/email/send-code',{email:'email-test@example.com'})).data.success,true);
  assert.equal((await call('/profile/email/send-code',{email:'email-test@example.com'})).statusCode,429);
  assert.equal((await call('/profile/email/send-code',{email:'corrected@example.com'})).statusCode,200);
  assert.equal((await call('/profile/email/send-code',{email:'another@example.com'})).statusCode,429);
  assert.equal((await call('/profile/email/verify',{code:'000000'})).statusCode,400);
  assert.equal((await q('SELECT attempts FROM account_emails'))[0].attempts,1);
  assert.equal((await call('/profile/email/verify',{code:deliveredCode})).data.email,'corrected@example.com');
  assert.equal((await call('/profile/email/verify',{code:deliveredCode})).statusCode,400);
  const [verified]=await q('SELECT * FROM account_emails');assert.equal(verified.code_hash,null);assert.ok(verified.verified_at);
  const {setSubscription}=require('../src/server/services/marketingService');
  await db.withTransaction((_conn,q)=>setSubscription(q,2147483000,'corrected@example.com',true));
  const [before]=await q('SELECT unsubscribe_id FROM email_marketing');
  await db.withTransaction((_conn,q)=>setSubscription(q,2147483000,'corrected@example.com',false));
  assert.equal((await q('SELECT unsubscribe_id FROM email_marketing'))[0].unsubscribe_id,before.unsubscribe_id);
  await assert.rejects(db.withTransaction((_conn,q)=>setSubscription(q,2147482999,'corrected@example.com',true)),{code:'ER_DUP_ENTRY'});
  assert.equal((await q('SELECT subscribed FROM email_marketing'))[0].subscribed,0);
  await db.withTransaction((_conn,q)=>setSubscription(q,2147483000,'changed@example.com',false));
  assert.notEqual((await q('SELECT unsubscribe_id FROM email_marketing'))[0].unsubscribe_id,before.unsubscribe_id);
  const service=createSiteSupportService(db),user={user_id:2147483000};
  for(const kind of ['feedback','support']){const body={subject:'Email integration test',message:'Temporary database test only.',category:'other',submissionKey:`email-test-${kind}-123456789`};await service.create(user,kind,body);await service.create(user,kind,body);}
  assert.equal((await q('SELECT COUNT(*) AS n FROM email_outbox'))[0].n,2);
  console.log('PASS: real MySQL send/cooldown/attempt persistence/verification/replay and exactly one outbox entry per new request. No real emails sent.');
 }finally{global.fetch=originalFetch;await conn.end();}
})().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
