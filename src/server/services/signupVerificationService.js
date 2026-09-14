const crypto=require('node:crypto');
const bcrypt=require('bcrypt');
const config=require('../../shared/siteConfig.json');
const {normalizeEmail}=require('../helpers/emailValidation');
const {hashCode,sendEmail,template}=require('./emailService');
const {getBanHoldFromRequest}=require('../helpers/banHold');
const result=(statusCode,payload)=>({ok:statusCode<400,statusCode,payload});
const fail=(message,status=400)=>result(status,{success:false,error:message});
const digest=(id,email,code)=>hashCode(`signup:${id}`,email,code);
const {emailCooldown}=require('../helpers/emailCooldown');
function rateError(row) {
  const now=Date.now();
  if(row.sent_at && now-new Date(row.sent_at).getTime()<60000) return fail('Wait a minute before requesting another code.',429);
  if(row.window_start && now-new Date(row.window_start).getTime()<3600000 && row.send_count>=5) return fail('Too many codes requested. Try again in an hour.',429);
}
async function getGuest({requireCurrentUser,req,res}) {
  if(getBanHoldFromRequest(req))return null;
  const user=await requireCurrentUser(req,res);
  return user?.expires_at && new Date(user.expires_at).getTime()>Date.now() ? user : null;
}
async function sendChallenge(q,user,row,fields) {
  const policy=emailCooldown(row,fields.email,row.email);
  if(policy.error)return fail(policy.error,429);
  const code=String(crypto.randomInt(100000,1000000)),challengeId=crypto.randomUUID();
  const hash=digest(challengeId,fields.email,code);
  const fresh=!row.window_start||Date.now()-new Date(row.window_start).getTime()>=3600000;
  await sendEmail(fields.email,template('Verify your account','Enter this code to finish creating your Bro Battles account.',code));
  await q(`UPDATE pending_signups SET challenge_id=?,username=?,password_hash=?,email=?,code_hash=?,expires_at=DATE_ADD(NOW(3),INTERVAL 10 MINUTE),attempts=0,sent_at=NOW(3),window_start=IF(?,NOW(3),window_start),send_count=?,marketing_consent=?,terms_version=?,privacy_version=?,correction_used=? WHERE user_id=?`,
    [challengeId,fields.username,fields.password_hash,fields.email,hash,fresh,fresh?1:row.send_count+1,!!fields.marketing_consent,fields.terms_version,fields.privacy_version,policy.correctionUsed,user.user_id]);
  return result(202,{success:true,verificationRequired:true,challengeId,email:fields.email,resendAfter:60,correctionUsed:policy.correctionUsed});
}
async function beginSignup(context) {
  const {db,req}=context;
  if(getBanHoldFromRequest(req))return fail('This browser is temporarily blocked from creating accounts.',403);
  if(req.body?.accepted!==true||req.body.termsVersion!==config.termsVersion||req.body.privacyVersion!==config.privacyVersion)return fail('Please accept the current Terms and acknowledge the Privacy Policy.');
  const credentials=require('./authAccountService').validateCredentials(req.body.username,req.body.password);
  if(!credentials.ok)return credentials;
  const email=normalizeEmail(req.body.email);if(!email)return fail('Enter a valid email address.');
  const user=await getGuest(context);if(!user)return fail('A guest session is required. Return to the lobby and try again.',409);
  const passwordHash=await bcrypt.hash(credentials.password,Number(process.env.BCRYPT_ROUNDS)||12);
  return db.withTransaction(async(_conn,q)=>{
    const [live]=await q('SELECT user_id,expires_at,is_banned FROM users WHERE user_id=? FOR UPDATE',[user.user_id]);
    if(!live?.expires_at || new Date(live.expires_at).getTime()<=Date.now() || Number(live.is_banned)===1)return fail('Your guest session has ended. Return to the lobby.',409);
    const names=await q('SELECT user_id FROM users WHERE name=? AND user_id<>? LIMIT 1',[credentials.username,user.user_id]);
    if(names.length)return fail('Username is already taken.',409);
    const emails=await q('SELECT user_id FROM account_emails WHERE email=? LIMIT 1',[email]);
    if(emails.length)return fail('This email cannot be used. Try logging in or use another email.',409);
    await q('INSERT IGNORE INTO pending_signups (user_id) VALUES (?)',[user.user_id]);
    const [row]=await q('SELECT * FROM pending_signups WHERE user_id=? FOR UPDATE',[user.user_id]);
    return sendChallenge(q,user,row,{username:credentials.username,password_hash:passwordHash,email,marketing_consent:req.body.marketingConsent===true,terms_version:config.termsVersion,privacy_version:config.privacyVersion});
  });
}
async function pendingSignup(context) {
  const user=await getGuest(context);if(!user)return result(200,{pending:false});
  const [row]=await context.db.runQuery('SELECT challenge_id,email,username,expires_at,sent_at,code_hash,correction_used FROM pending_signups WHERE user_id=?',[user.user_id]);
  if(!row)return result(200,{pending:false});
  return result(200,{pending:!!row.code_hash,challengeId:row.challenge_id,email:row.email,username:row.username,correctionUsed:!!row.correction_used,expired:new Date(row.expires_at).getTime()<=Date.now(),resendAfter:Math.max(0,Math.ceil((new Date(row.sent_at).getTime()+60000-Date.now())/1000))});
}
async function resendSignup(context) {
  const user=await getGuest(context);if(!user)return fail('Your guest session has ended. Return to the lobby.',409);
  return context.db.withTransaction(async(_conn,q)=>{
    const [row]=await q('SELECT * FROM pending_signups WHERE user_id=? FOR UPDATE',[user.user_id]);
    if(!row?.password_hash||row.challenge_id!==context.req.body?.challengeId)return fail('Start signup again to request a code.',409);
    return sendChallenge(q,user,row,row);
  });
}
async function cancelSignup(context) {
  const user=await getGuest(context);if(!user)return fail('Your guest session has ended.',409);
  // Preserve send counters when editing; never let edits bypass the hourly limit.
  await context.db.runQuery('UPDATE pending_signups SET challenge_id=NULL,code_hash=NULL,password_hash=NULL,expires_at=NULL WHERE user_id=?',[user.user_id]);
  return result(200,{success:true});
}
async function verifySignup(context) {
  const {app,req,res}=context;
  const code=String(req.body?.code||'').trim(),challengeId=String(req.body?.challengeId||'');
  if(!/^\d{6}$/.test(code))return fail('Enter all six digits.');
  const user=await getGuest(context);if(!user)return fail('Your guest session has ended. Return to the lobby.',409);
  try {
    return await app.locals.authSessions.activateGuest(user.user_id,res,async(q,live)=>{
      const [row]=await q('SELECT * FROM pending_signups WHERE user_id=? FOR UPDATE',[user.user_id]);
      if(!row?.code_hash||row.challenge_id!==challengeId||row.attempts>=5||new Date(row.expires_at).getTime()<=Date.now())return fail('This code has expired. Request a new one.');
      if(!crypto.timingSafeEqual(Buffer.from(row.code_hash,'hex'),Buffer.from(digest(challengeId,row.email,code),'hex'))){await q('UPDATE pending_signups SET attempts=attempts+1 WHERE user_id=?',[user.user_id]);return fail('That code is not correct. Try again.');}
      if(row.terms_version!==config.termsVersion||row.privacy_version!==config.privacyVersion)return fail('Please go back and accept the updated terms.');
      await q('UPDATE users SET name=?,password=?,expires_at=NULL WHERE user_id=?',[row.username,row.password_hash,live.user_id]);
      await q('INSERT INTO account_emails (user_id,email,verified_at) VALUES (?,?,NOW(3))',[live.user_id,row.email]);
      await q("INSERT INTO legal_acceptances (user_id,terms_version,privacy_version,context) VALUES (?,?,?,'signup')",[live.user_id,row.terms_version,row.privacy_version]);
      // Stored with activation, so a crash cannot lose the delayed welcome job.
      await require('./marketingService').setSubscription(q,live.user_id,row.email,!!row.marketing_consent);
      if(row.marketing_consent)await q("INSERT INTO marketing_jobs (user_id,email,kind,due_at) VALUES (?,?,'welcome',DATE_ADD(NOW(3),INTERVAL 3 MINUTE))",[live.user_id,row.email]);
      await q('DELETE FROM pending_signups WHERE user_id=?',[live.user_id]);
      return result(201,{success:true,username:row.username});
    });
  }catch(error){if(error.code==='ER_DUP_ENTRY')return fail('That username or email was just taken. Go back and edit your details.',409);throw error;}
}
module.exports={beginSignup,pendingSignup,resendSignup,cancelSignup,verifySignup,rateError};
