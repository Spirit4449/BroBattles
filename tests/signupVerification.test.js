const test=require('node:test');
const assert=require('node:assert/strict');
const {verifySignup,pendingSignup,cancelSignup}=require('../src/server/services/signupVerificationService');
const {createAuthSessionService}=require('../src/server/services/authSessionService');
const {hashCode}=require('../src/server/services/emailService');
const config=require('../src/shared/siteConfig.json');
process.env.EMAIL_VERIFICATION_SECRET='signup-regression-test';
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
