const crypto = require('node:crypto');
const { sendEmail } = require('./emailService');

function baseUrl() { return String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''); }
function postalAddress() { return String(process.env.MARKETING_POSTAL_ADDRESS || '').trim(); }
function marketingApiKey() { return process.env.RESEND_MARKETING_API_KEY || ''; }
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);

function welcomeEmail(email, unsubscribeId) {
  const unsubscribe = `${baseUrl()}/email/unsubscribe/${encodeURIComponent(unsubscribeId)}`;
  const playUrl = `${baseUrl()}/`;
  const logoUrl = `${baseUrl()}/assets/logos/wordmark.png`;
  const footer = `You are receiving this because you opted in to Bro Battles updates. Unsubscribe: ${unsubscribe}\n${postalAddress()}`;
  return {
    subject: 'Welcome to Bro Battles',
    text: `Welcome to Bro Battles!\n\nYour account is ready. Pick a Bro, jump into a match, and make your first battle count.\n\n${footer}`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Welcome to Bro Battles</title></head>
<body bgcolor="#050914" style="margin:0;padding:0;background:#050914;color:#f7f9ff">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">Your account is ready. Pick a Bro and make your first battle count.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#050914" style="width:100%;background:#050914;border-collapse:collapse">
    <tr><td align="center" style="padding:38px 14px 48px">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;border-collapse:separate">
        <tr><td bgcolor="#03060b" style="padding:5px 7px 9px 5px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#111f37" style="width:100%;border:3px solid #385478;border-collapse:separate;background:#111f37">
            <tr><td style="padding:0;border-bottom:4px solid #03060b">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse"><tr>
                <td width="14%" bgcolor="#159dc9" height="12" style="height:12px;font-size:0;line-height:0">&nbsp;</td><td width="14%" bgcolor="#22afd2" style="font-size:0;line-height:0">&nbsp;</td><td width="14%" bgcolor="#2865c5" style="font-size:0;line-height:0">&nbsp;</td><td width="14%" bgcolor="#3d91eb" style="font-size:0;line-height:0">&nbsp;</td><td width="14%" bgcolor="#5d4dcd" style="font-size:0;line-height:0">&nbsp;</td><td width="14%" bgcolor="#6a43bd" style="font-size:0;line-height:0">&nbsp;</td><td width="16%" bgcolor="#3926a4" style="font-size:0;line-height:0">&nbsp;</td>
              </tr></table>
            </td></tr>
            <tr><td align="center" bgcolor="#0b1629" style="padding:25px 30px 21px;background:#0b1629;border-bottom:2px solid #263b59">
              <img src="${escape(logoUrl)}" width="238" alt="Bro Battles" style="display:block;width:238px;max-width:78%;height:auto;border:0;image-rendering:pixelated">
            </td></tr>
            <tr><td style="padding:30px 34px 8px">
              <h1 style="margin:0;color:#ffffff;font-family:'Courier New',monospace;font-size:25px;font-weight:900;line-height:1.35;text-shadow:3px 3px 0 #03060b;text-transform:uppercase">You’re in.</h1>
            </td></tr>
            <tr><td style="padding:10px 34px 25px;color:#c9d6e8;font-family:Arial,sans-serif;font-size:16px;line-height:1.7">Your account is ready. Pick a Bro, jump into a match, and make your first battle count.</td></tr>
            <tr><td style="padding:0 34px 32px">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate"><tr><td bgcolor="#03060b" style="padding:0 5px 6px 0">
                <a href="${escape(playUrl)}" style="display:block;padding:15px 22px;border:3px solid #03060b;background:#3d91eb;color:#ffffff;font-family:'Courier New',monospace;font-size:14px;font-weight:900;line-height:1;text-decoration:none;text-transform:uppercase;text-shadow:2px 2px 0 #18549a">Play now</a>
              </td></tr></table>
            </td></tr>
            <tr><td bgcolor="#0b1629" style="padding:25px 34px 28px;background:#0b1629;border-top:2px solid #263b59;color:#7f95b3;font-family:Arial,sans-serif;font-size:12px;line-height:1.65">
              You’re receiving this because you opted in to Bro Battles updates.<br><a href="${escape(unsubscribe)}" style="color:#9fcaff;text-decoration:underline">Unsubscribe</a><br><span style="color:#6f84a0">${escape(postalAddress())}</span>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
    headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

async function setSubscription(q, userId, email, subscribed) {
  const unsubscribeId = crypto.randomUUID();
  const [existing] = await q('SELECT email FROM email_marketing WHERE user_id=? FOR UPDATE', [userId]);
  if (existing) {
    await q(`UPDATE email_marketing SET email=?,subscribed=?,unsubscribe_id=IF(?,unsubscribe_id,?),
      consent_at=IF(?,NOW(3),consent_at),unsubscribed_at=IF(?,NULL,NOW(3)),updated_at=NOW(3) WHERE user_id=?`,
      [email,!!subscribed,existing.email === email,unsubscribeId,!!subscribed,!!subscribed,userId]);
  } else {
    // A collision on the unique email must fail, never update another account's preferences.
    await q(`INSERT INTO email_marketing (user_id,email,subscribed,unsubscribe_id,consent_at,unsubscribed_at,updated_at)
      VALUES (?,?,?,?,IF(?,NOW(3),NULL),IF(?,NULL,NOW(3)),NOW(3))`,
      [userId,email,!!subscribed,unsubscribeId,!!subscribed,!!subscribed]);
  }
  await q(`INSERT INTO marketing_contact_sync (email,subscribed,next_attempt_at) VALUES (?,?,NOW(3))
    ON DUPLICATE KEY UPDATE subscribed=VALUES(subscribed),synced_at=NULL,next_attempt_at=NOW(3),attempts=0`,[email,!!subscribed]);
}

async function readSubscription(q, userId) {
  const [row]=await q('SELECT email,subscribed FROM email_marketing WHERE user_id=? FOR UPDATE',[userId]);
  if (!row?.subscribed || !marketingApiKey()) return !!row?.subscribed;
  const [sync]=await q('SELECT synced_at FROM marketing_contact_sync WHERE email=?',[row.email]);
  // An explicit local preference change takes precedence until it reaches Resend.
  if (!sync?.synced_at) return true;
  const response=await fetch(`https://api.resend.com/contacts/${encodeURIComponent(row.email)}`,{
    headers:{Authorization:`Bearer ${marketingApiKey()}`},signal:AbortSignal.timeout(5000)});
  if (!response.ok) throw new Error('Unable to check email preferences');
  const contact=await response.json();
  if (contact.unsubscribed !== true) return true;
  await q('UPDATE email_marketing SET subscribed=FALSE,unsubscribed_at=NOW(3),updated_at=NOW(3) WHERE user_id=?',[userId]);
  await q('UPDATE marketing_contact_sync SET subscribed=FALSE WHERE email=?',[row.email]);
  await q('UPDATE marketing_jobs SET cancelled_at=NOW(3) WHERE user_id=? AND sent_at IS NULL',[userId]);
  return false;
}

function startMarketingWorker(db) {
  let running=false;
  const tick=async()=>{
    if(running) return;
    running=true;
    try {
      if (marketingApiKey()) await db.withTransaction(async(_conn,q)=>{
        const [contact]=await q('SELECT * FROM marketing_contact_sync WHERE synced_at IS NULL AND next_attempt_at<=NOW(3) ORDER BY email LIMIT 1 FOR UPDATE SKIP LOCKED');
        if (!contact) return;
        const options={headers:{Authorization:`Bearer ${marketingApiKey()}`,'Content-Type':'application/json'},body:JSON.stringify({email:contact.email,unsubscribed:!contact.subscribed}),signal:AbortSignal.timeout(10000)};
        let response=await fetch(`https://api.resend.com/contacts/${encodeURIComponent(contact.email)}`,{...options,method:'PATCH'});
        if(response.status===404) response=await fetch('https://api.resend.com/contacts',{...options,method:'POST',signal:AbortSignal.timeout(10000)});
        if (response.ok) await q('UPDATE marketing_contact_sync SET synced_at=NOW(3),attempts=0 WHERE email=?',[contact.email]);
        else await q('UPDATE marketing_contact_sync SET attempts=attempts+1,next_attempt_at=DATE_ADD(NOW(3),INTERVAL 30 MINUTE) WHERE email=?',[contact.email]);
      });
      if (!postalAddress()) return;
      await db.withTransaction(async(_conn,q)=>{
      const [job]=await q(`SELECT j.*,m.unsubscribe_id FROM marketing_jobs j JOIN email_marketing m ON m.user_id=j.user_id AND m.email=j.email WHERE j.sent_at IS NULL AND j.cancelled_at IS NULL AND j.attempts<5 AND j.due_at<=NOW(3) AND m.subscribed=1 ORDER BY j.id LIMIT 1 FOR UPDATE SKIP LOCKED`);
      if(!job) return;
      if(!await readSubscription(q,job.user_id))return;
      try { await sendEmail(job.email,welcomeEmail(job.email,job.unsubscribe_id),`marketing-job-${job.id}`); await q('UPDATE marketing_jobs SET sent_at=NOW(3) WHERE id=?',[job.id]); }
      catch(error){ await q('UPDATE marketing_jobs SET attempts=attempts+1,last_error=?,due_at=DATE_ADD(NOW(3),INTERVAL 10 MINUTE) WHERE id=?',[String(error.message).slice(0,120),job.id]); }
      });
    } catch(error) { console.warn('[marketing] Worker failed:',error.code||error.message); }
    finally { running=false; }
  };
  const timer=setInterval(tick,15000); timer.unref(); return timer;
}
module.exports={setSubscription,readSubscription,startMarketingWorker,postalAddress,welcomeEmail};
