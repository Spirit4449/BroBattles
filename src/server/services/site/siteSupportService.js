const config = require('../../../shared/site/siteConfig.json');
const CATEGORIES = ['bug', 'idea', 'gameplay', 'account', 'purchase', 'safety', 'privacy', 'other'];
const REPORT_REASONS = require('../../../shared/social/profileReports.json');
const INBOX_CATEGORIES = [...CATEGORIES, 'reports'];
const { reportTargetId, loadReportCounts, loadReportReview } = require('./profileReportReview');
function invalid(message, status = 400) { return Object.assign(new Error(message), { status }); }
function field(value, min, max, label) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw invalid(`${label} must be ${min}–${max} characters.`);
  return value.trim();
}
function validateSubmission(body, reply = false, categories = CATEGORIES) {
  const result = { body: field(body.message, 5, 4000, 'Message'), key: field(body.submissionKey, 16, 64, 'Submission reference') };
  if (!/^[a-zA-Z0-9-]+$/.test(result.key)) throw invalid('Invalid submission reference.');
  if (!reply) {
    result.subject = field(body.subject, 3, 120, 'Subject');
    if (!categories.includes(body.category)) throw invalid('Choose a category.');
    result.category = body.category;
  }
  return result;
}
function createSiteSupportService(db) {
  async function create(user, kind, body, categories = CATEGORIES) {
    const input = validateSubmission(body, false, categories);
    return db.withTransaction(async (_conn, q) => {
      const result = await q(`INSERT INTO site_requests (user_id, kind, category, subject, version, submission_key, player_read_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [user.user_id, kind, input.category, input.subject, config.version, input.key]);
      const rows = await q('SELECT id, kind FROM site_requests WHERE id = ? FOR UPDATE', [result.insertId]);
      if (!rows[0] || rows[0].kind !== kind) throw invalid('Submission reference already used.', 409);
      await q(`INSERT INTO site_request_messages (request_id, sender, author_id, body, submission_key)
        VALUES (?, 'player', ?, ?, ?) ON DUPLICATE KEY UPDATE id=id`, [result.insertId, user.user_id, input.body, input.key]);
      await q("INSERT IGNORE INTO email_outbox (request_id) VALUES (?)", [result.insertId]);
      return { id: result.insertId };
    });
  }
  async function createReport(user, body = {}) {
    if (!body || typeof body !== 'object') throw invalid('Invalid report.');
    const targetId = body.targetUserId;
    if (!Number.isSafeInteger(targetId) || targetId <= 0) throw invalid('Choose a player to report.');
    if (targetId === Number(user.user_id)) throw invalid('You cannot report yourself.');
    const reason = REPORT_REASONS.find(item => item.value === body.reason);
    if (!reason) throw invalid('Choose a report reason.');
    const message = field(body.message, 5, 3500, 'Message');
    const [target] = await db.runQuery('SELECT user_id, name FROM users WHERE user_id=? LIMIT 1', [targetId]);
    if (!target) throw invalid('Player not found.', 404);
    return create(user, 'support', {
      category: 'reports',
      subject: `Report: ${target.name} (#${target.user_id})`,
      message: `Reported player: ${target.name}\nAccount ID: ${target.user_id}\nReason: ${reason.label}\n\n${message}`,
      submissionKey: body.submissionKey,
    }, INBOX_CATEGORIES);
  }
  async function list(user, admin, query) {
    const kind = admin && query.kind === 'feedback' ? 'feedback' : 'support';
    const page = Math.max(1, Math.min(100000, parseInt(query.page, 10) || 1));
    const clauses = ['r.kind = ?']; const params = [kind];
    if (!admin) { clauses.push('r.user_id = ?'); params.push(user.user_id); }
    if (['open','in_progress','closed'].includes(query.status)) { clauses.push('r.status = ?'); params.push(query.status); }
    if (INBOX_CATEGORIES.includes(query.category)) { clauses.push('r.category = ?'); params.push(query.category); }
    const reader = admin ? 'admin_read_at' : 'player_read_at';
    const sender = admin ? 'player' : 'admin';
    const where = clauses.join(' AND ');
    const [{ total }] = await db.runQuery(`SELECT COUNT(*) AS total FROM site_requests r WHERE ${where}`, params);
    // Admin inboxes also show who wrote in and the start of the latest message.
    const adminColumns = admin ? `, r.user_id AS userId, u.name AS userName, u.selected_profile_icon_id AS userIcon,
      (SELECT LEFT(m.body, 140) FROM site_request_messages m WHERE m.request_id=r.id ORDER BY m.id DESC LIMIT 1) AS preview,
      (SELECT COUNT(*) FROM site_request_messages m WHERE m.request_id=r.id) AS messageCount` : '';
    const items = await db.runQuery(`SELECT r.id, r.kind, r.category, r.subject, r.status, r.created_at, r.updated_at, r.version,
      EXISTS(SELECT 1 FROM site_request_messages m WHERE m.request_id=r.id AND m.sender=? AND (r.${reader} IS NULL OR m.created_at>r.${reader})) AS unread${adminColumns}
      FROM site_requests r ${admin ? 'LEFT JOIN users u ON u.user_id=r.user_id ' : ''}WHERE ${where} ORDER BY r.updated_at DESC, r.id DESC LIMIT 20 OFFSET ?`, [sender, ...params, (page - 1) * 20]);
    if (admin) {
      const counts = await loadReportCounts((sql, params) => db.runQuery(sql, params), items.map(reportTargetId));
      for (const item of items) {
        const summary = counts.get(reportTargetId(item));
        if (summary) item.reportSummary = summary;
      }
    }
    return { items, page, total: Number(total) };
  }
  async function detail(user, admin, id) {
    return db.withTransaction(async (_conn, q) => {
      const rows = await q(`SELECT * FROM site_requests WHERE id=? ${admin ? '' : "AND user_id=? AND kind='support'"} FOR UPDATE`, admin ? [id] : [id, user.user_id]);
      if (!rows[0]) throw invalid('Request not found.', 404);
      const messages = await q('SELECT id, sender, body, created_at FROM site_request_messages WHERE request_id=? ORDER BY id', [id]);
      await q(`UPDATE site_requests SET ${admin ? 'admin_read_at' : 'player_read_at'}=NOW(3) WHERE id=?`, [id]);
      const { submission_key, user_id, ...request } = rows[0];
      if (!admin) return { request, messages };
      const [player] = await q('SELECT name, selected_profile_icon_id, char_class FROM users WHERE user_id=?', [user_id]);
      const reportReview = await loadReportReview(q, request);
      return { request: { ...request, userId: user_id, userName: player?.name || null, userIcon: player?.selected_profile_icon_id || player?.char_class || null }, messages, ...(reportReview ? { reportReview } : {}) };
    });
  }
  async function reply(user, admin, id, body) {
    const input = validateSubmission(body, true);
    return db.withTransaction(async (_conn, q) => {
      const rows = await q(`SELECT id, kind FROM site_requests WHERE id=? ${admin ? '' : 'AND user_id=?'} FOR UPDATE`, admin ? [id] : [id, user.user_id]);
      if (!rows[0] || rows[0].kind !== 'support') throw invalid('Support request not found.', 404);
      const existing = await q('SELECT id FROM site_request_messages WHERE request_id=? AND sender=? AND submission_key=?', [id, admin ? 'admin' : 'player', input.key]);
      if (existing.length) return { id: existing[0].id };
      const result = await q(`INSERT INTO site_request_messages (request_id,sender,author_id,body,submission_key) VALUES (?,?,?,?,?)
        ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`, [id, admin ? 'admin' : 'player', user.user_id, input.body, input.key]);
      if (result.affectedRows === 1) await q(`UPDATE site_requests SET updated_at=NOW(3), status=?, closed_at=NULL WHERE id=?`, [admin ? 'in_progress' : 'open', id]);
      return { id: result.insertId };
    });
  }
  async function setStatus(id, status) {
    if (!['open','in_progress','closed'].includes(status)) throw invalid('Invalid status.');
    const result = await db.runQuery("UPDATE site_requests SET status=?, updated_at=NOW(3), closed_at=IF(?='closed',NOW(3),NULL) WHERE id=?", [status,status,id]);
    if (!result.affectedRows) throw invalid('Request not found.',404);
    return { success:true };
  }
  async function cleanup() {
    await db.runQuery(`DELETE FROM site_requests WHERE (kind='feedback' AND created_at<DATE_SUB(NOW(), INTERVAL ? MONTH))
      OR (kind='support' AND status='closed' AND closed_at<DATE_SUB(NOW(), INTERVAL ? MONTH)) LIMIT 1000`, [config.feedbackRetentionMonths, config.supportRetentionMonths]);
    await db.runQuery('DELETE e FROM account_emails e LEFT JOIN users u ON u.user_id=e.user_id WHERE u.user_id IS NULL');
    await db.runQuery("UPDATE account_emails SET pending_email=NULL,code_hash=NULL,expires_at=NULL WHERE expires_at<NOW(3)");
    await db.runQuery('DELETE a FROM legal_acceptances a LEFT JOIN users u ON u.user_id=a.user_id WHERE u.user_id IS NULL');
  }
  return { create, createReport, list, detail, reply, setStatus, cleanup };
}
module.exports = { createSiteSupportService, validateSubmission, CATEGORIES };
