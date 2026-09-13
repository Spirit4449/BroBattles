const config = require('../../shared/siteConfig.json');
const CATEGORIES = ['bug', 'idea', 'gameplay', 'account', 'purchase', 'safety', 'privacy', 'other'];
function invalid(message, status = 400) { return Object.assign(new Error(message), { status }); }
function field(value, min, max, label) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw invalid(`${label} must be ${min}–${max} characters.`);
  return value.trim();
}
function validateSubmission(body, reply = false) {
  const result = { body: field(body.message, 5, 4000, 'Message'), key: field(body.submissionKey, 16, 64, 'Submission reference') };
  if (!/^[a-zA-Z0-9-]+$/.test(result.key)) throw invalid('Invalid submission reference.');
  if (!reply) {
    result.subject = field(body.subject, 3, 120, 'Subject');
    if (!CATEGORIES.includes(body.category)) throw invalid('Choose a category.');
    result.category = body.category;
  }
  return result;
}
function createSiteSupportService(db) {
  async function create(user, kind, body) {
    const input = validateSubmission(body);
    return db.withTransaction(async (_conn, q) => {
      const result = await q(`INSERT INTO site_requests (user_id, kind, category, subject, version, submission_key, player_read_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [user.user_id, kind, input.category, input.subject, config.version, input.key]);
      const rows = await q('SELECT id, kind FROM site_requests WHERE id = ? FOR UPDATE', [result.insertId]);
      if (!rows[0] || rows[0].kind !== kind) throw invalid('Submission reference already used.', 409);
      await q(`INSERT INTO site_request_messages (request_id, sender, author_id, body, submission_key)
        VALUES (?, 'player', ?, ?, ?) ON DUPLICATE KEY UPDATE id=id`, [result.insertId, user.user_id, input.body, input.key]);
      return { id: result.insertId };
    });
  }
  async function list(user, admin, query) {
    const kind = admin && query.kind === 'feedback' ? 'feedback' : 'support';
    const page = Math.max(1, Math.min(100000, parseInt(query.page, 10) || 1));
    const clauses = ['r.kind = ?']; const params = [kind];
    if (!admin) { clauses.push('r.user_id = ?'); params.push(user.user_id); }
    if (['open','in_progress','closed'].includes(query.status)) { clauses.push('r.status = ?'); params.push(query.status); }
    if (CATEGORIES.includes(query.category)) { clauses.push('r.category = ?'); params.push(query.category); }
    const reader = admin ? 'admin_read_at' : 'player_read_at';
    const sender = admin ? 'player' : 'admin';
    const where = clauses.join(' AND ');
    const [{ total }] = await db.runQuery(`SELECT COUNT(*) AS total FROM site_requests r WHERE ${where}`, params);
    const items = await db.runQuery(`SELECT r.id, r.kind, r.category, r.subject, r.status, r.created_at, r.updated_at, r.version,
      EXISTS(SELECT 1 FROM site_request_messages m WHERE m.request_id=r.id AND m.sender=? AND (r.${reader} IS NULL OR m.created_at>r.${reader})) AS unread
      FROM site_requests r WHERE ${where} ORDER BY r.updated_at DESC, r.id DESC LIMIT 20 OFFSET ?`, [sender, ...params, (page - 1) * 20]);
    return { items, page, total: Number(total) };
  }
  async function detail(user, admin, id) {
    return db.withTransaction(async (_conn, q) => {
      const rows = await q(`SELECT * FROM site_requests WHERE id=? ${admin ? '' : "AND user_id=? AND kind='support'"} FOR UPDATE`, admin ? [id] : [id, user.user_id]);
      if (!rows[0]) throw invalid('Request not found.', 404);
      const messages = await q('SELECT id, sender, body, created_at FROM site_request_messages WHERE request_id=? ORDER BY id', [id]);
      await q(`UPDATE site_requests SET ${admin ? 'admin_read_at' : 'player_read_at'}=NOW(3) WHERE id=?`, [id]);
      const { submission_key, user_id, ...request } = rows[0];
      return { request: admin ? { ...request, userId: user_id } : request, messages };
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
    await db.runQuery('DELETE a FROM legal_acceptances a LEFT JOIN users u ON u.user_id=a.user_id WHERE u.user_id IS NULL');
  }
  return { create, list, detail, reply, setStatus, cleanup };
}
module.exports = { createSiteSupportService, validateSubmission, CATEGORIES };
