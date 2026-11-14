const { createSiteSupportService } = require('../../services/site/siteSupportService');
const { createRequestWindow } = require('../../lib/requestWindow');
const config = require('../../../shared/site/siteConfig.json');
const { registerSitePages } = require('../../services/site/siteContent');
const { createHelpSearchService } = require('../../services/site/helpSearchService');
function isSameOrigin(req) {
  try {
    const site = req.get('sec-fetch-site');
    if (site === 'cross-site') return false;
    // Fetch Metadata is browser-controlled and remains accurate behind TLS proxies.
    if (site === 'same-origin') return true;
    const origin = req.get('origin');
    if (!origin || origin === 'null') return false;
    const supplied = new URL(origin);
    const direct = new URL(`${req.protocol}://${req.get('host')}`);
    if (supplied.origin === direct.origin) return true;
    return !!process.env.PUBLIC_BASE_URL && supplied.origin === new URL(process.env.PUBLIC_BASE_URL).origin;
  } catch (_) { return false; }
}
function accepted(body) { return body?.accepted === true && body.termsVersion === config.termsVersion && body.privacyVersion === config.privacyVersion; }
function registerSiteRoutes({ app, db, auth }) {
  registerSitePages(app);
  const getVersion = require('../../services/site/buildVersion').createVersionService();
  app.get('/api/version', async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await getVersion());
  });
  app.use(['/gamedata'], async (req,res,next) => {
    try {
      const user = await auth.requireCurrentUser(req,res);
      if (user && !await require('../../services/auth/legalAcceptance').hasLegalAcceptance(db,user.user_id)) return res.status(403).json({error:'Please accept the current Terms in the lobby.',code:'TERMS_REQUIRED'});
      next();
    } catch (_) { res.status(503).json({error:'Unable to verify terms acceptance.'}); }
  });
  const service = createSiteSupportService(db);
  require("../../services/email/emailService").startEmailWorker(db);
  require("../../services/email/marketingService").startMarketingWorker(db);
  const limits = createRequestWindow();
  const searchHelp = createHelpSearchService();
  const wrap = (admin, permanent, action, allowBanned = false) => async (req, res) => {
    try {
      if (req.method !== 'GET' && !isSameOrigin(req)) return res.status(403).json({ error:'Same-origin request required.' });
      if (!admin && limits.count(`ip:${req.ip}`, 60000) > 120) return res.status(429).json({ error:'Too many requests. Try again shortly.' });
      const user = await (admin ? auth.requireAdminUser : auth.requireCurrentUser)(req, res, { allowBanned });
      if (!user || (permanent && auth.isGuest(user))) return res.status(admin ? 403 : 401).json({ error: admin ? 'Admin access required.' : 'Log in to use support.' });
      if (!admin && req.method !== 'GET' && limits.count(`write:${user.user_id}`,60000) > 12) return res.status(429).json({ error:'Please wait a minute before sending more.' });
      const result = await action(req, user);
      res.set('Cache-Control','no-store');
      return res.json(result);
    } catch (error) {
      if (!error.status) console.error('[site] request failed:', error.code || error.message);
      return res.status(error.status || 503).json({ error:error.status ? error.message : 'Service unavailable. Please retry later.' });
    }
  };
  app.get('/api/site/session', async (req,res) => {
    try {
      const user = await auth.requireCurrentUser(req,res,{ allowBanned:true });
      let unread = 0;
      if (user && !auth.isGuest(user)) {
        const rows = await db.runQuery(`SELECT COUNT(*) AS total FROM site_requests r WHERE r.user_id=? AND r.kind='support'
          AND EXISTS(SELECT 1 FROM site_request_messages m WHERE m.request_id=r.id AND m.sender='admin' AND (r.player_read_at IS NULL OR m.created_at>r.player_read_at))`,[user.user_id]);
        unread = Number(rows[0].total);
      }
      const member = !!user && !auth.isGuest(user);
      const icon = member ? String(user.selected_profile_icon_id || user.char_class || '').replace(/[^a-z0-9_-]/gi, '') || null : null;
      res.set('Cache-Control','no-store').json({ member, guest:!!user && auth.isGuest(user), username:member ? user.name : null, icon, admin:!!user && auth.isAdminUser(user), unread });
    } catch (_) { res.status(503).json({ error:'Support is temporarily unavailable.' }); }
  });
  app.post('/api/site/help-search', async (req,res) => {
    if (!isSameOrigin(req)) return res.status(403).json({error:'Same-origin request required.'});
    if (limits.count(`help-search:${req.ip}`,60000) > 20) return res.status(429).json({error:'Too many searches. Try again shortly.'});
    try {
      const result = await searchHelp(req.body?.query);
      res.set('Cache-Control','private, max-age=60').json(result);
    } catch (error) {
      if (!error.status) console.warn('[site] AI help search unavailable:', error.message);
      res.status(error.status || 503).json({error:error.status ? error.message : 'AI search is temporarily unavailable.'});
    }
  });
  app.get('/api/legal/status', wrap(false,false,async (_req,user) => {
    const rows = await db.runQuery('SELECT 1 FROM legal_acceptances WHERE user_id=? AND terms_version=? AND privacy_version=? LIMIT 1',[user.user_id,config.termsVersion,config.privacyVersion]);
    return { accepted:!!rows.length, ...config };
  }));
  app.post('/api/legal/accept', wrap(false,false,async (req,user) => {
    if (!accepted(req.body)) throw Object.assign(new Error('Please accept the current Terms and acknowledge the Privacy Policy.'),{status:400});
    await db.runQuery("INSERT IGNORE INTO legal_acceptances (user_id,terms_version,privacy_version,context) VALUES (?,?,?,'play')",[user.user_id,config.termsVersion,config.privacyVersion]);
    return { success:true };
  }));
  // Feedback is one-way and has no topic; support requests keep their categories.
  app.post('/api/feedback',wrap(false,false,(req,user)=>service.create(user,'feedback',{...req.body,category:'feedback'},['feedback'])));
  app.post('/api/support/reports',wrap(false,false,(req,user)=>service.createReport(user,req.body)));
  app.get('/api/support/requests',wrap(false,true,(req,user)=>service.list(user,false,req.query),true));
  app.post('/api/support/requests',wrap(false,true,(req,user)=>service.create(user,'support',req.body),true));
  app.get('/api/support/requests/:id',wrap(false,true,(req,user)=>service.detail(user,false,req.params.id),true));
  app.post('/api/support/requests/:id/messages',wrap(false,true,(req,user)=>service.reply(user,false,req.params.id,req.body),true));
  for (const kind of ['feedback','support']) {
    const base = `/api/admin/${kind}`;
    app.get(base,wrap(true,false,(req,user)=>service.list(user,true,{...req.query,kind})));
    app.get(`${base}/:id`,wrap(true,false,(req,user)=>service.detail(user,true,req.params.id)));
    app.post(`${base}/:id/status`,wrap(true,false,(req)=>service.setStatus(req.params.id,req.body.status)));
  }
  app.post('/api/admin/support/:id/messages',wrap(true,false,(req,user)=>service.reply(user,true,req.params.id,req.body)));
  const timer = setInterval(()=>service.cleanup().catch(error=>console.error('[site] cleanup failed:',error.code || error.message)),60*60*1000);
  timer.unref();
}
module.exports = { registerSiteRoutes, isSameOrigin, accepted };
