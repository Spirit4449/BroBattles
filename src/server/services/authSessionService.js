const crypto = require('node:crypto');

const COOKIE_NAME = 'user_id';
const SESSION_MS = 20 * 24 * 60 * 60 * 1000;
const tokenHash = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)
  ? crypto.createHash('sha256').update(token).digest('hex') : null;

function createAuthSessionService({ db, cookieOptions }) {
  const sockets = new Map();
  function clear(res) {
    res.clearCookie(COOKIE_NAME, cookieOptions);
    res.clearCookie('display_name', { ...cookieOptions, signed: false, httpOnly: false });
  }
  async function resolve(token, query = db.runQuery.bind(db), lock = false) {
    const hash = tokenHash(token);
    if (!hash) return null; // Legacy numeric user-id cookies are intentionally invalid.
    const rows = await query(
      `SELECT u.*, s.expires_at AS session_expires_at FROM auth_sessions s
       JOIN users u ON u.user_id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > NOW(3)
         AND (u.expires_at IS NULL OR u.expires_at > NOW(3)) LIMIT 1${lock ? " FOR UPDATE" : ""}`, [hash]);
    return rows[0] || null;
  }
  async function create(user, res) {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = tokenHash(token);
    const maxAge = user.expires_at ? Math.min(SESSION_MS, new Date(user.expires_at).getTime() - Date.now()) : SESSION_MS;
    if (maxAge <= 0) throw new Error('Guest account expired');
    await db.withTransaction(async (_conn, q) => {
      const rows = await q('SELECT password FROM users WHERE user_id = ? FOR UPDATE', [user.user_id]);
      if (!rows[0] || (user.password != null && rows[0].password !== user.password)) {
        throw new Error('Account credentials changed; please log in again');
      }
      await q('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
        [hash, user.user_id, new Date(Date.now() + maxAge)]);
    });
    res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge });
    return token;
  }
  function disconnectWhere(predicate) {
    for (const [socket, entry] of sockets) {
      if (predicate(entry)) {
        sockets.delete(socket);
        clearTimeout(entry.timer);
        socket.disconnect(true);
      }
    }
  }
  async function revokeRequest(req, res) {
    const hash = tokenHash(req.signedCookies?.[COOKIE_NAME]);
    if (hash) {
      await db.runQuery('DELETE FROM auth_sessions WHERE token_hash = ?', [hash]);
      disconnectWhere(entry => entry.hash === hash);
    }
    clear(res);
  }
  async function changePassword(userId, expectedHash, nextHash) {
    await db.withTransaction(async (_conn, q) => {
      const rows = await q('SELECT password FROM users WHERE user_id = ? FOR UPDATE', [userId]);
      if (rows[0]?.password !== expectedHash) throw new Error('Password changed; please log in again');
      await q('UPDATE users SET password = ? WHERE user_id = ?', [nextHash, userId]);
      await q('DELETE FROM auth_sessions WHERE user_id = ?', [userId]);
    });
    disconnectWhere(entry => entry.userId === Number(userId));
  }
  function attachSocket(socket, token, user) {
    const hash = tokenHash(token);
    const expiresAt = new Date(user.session_expires_at).getTime();
    if (!hash || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('Session expired');
    const expire = () => disconnectWhere(entry => entry.hash === hash);
    const timer = setTimeout(expire, Math.min(2147483647, expiresAt - Date.now()));
    timer.unref?.();
    sockets.set(socket, { hash, userId: Number(user.user_id), timer });
    socket.use((_packet, next) => {
      if (!sockets.has(socket) || expiresAt <= Date.now() || !socket.data.user) {
        expire();
        return next(new Error('Session expired'));
      }
      next();
    });
    socket.once('disconnect', () => { clearTimeout(timer); sockets.delete(socket); });
  }
  async function authenticateSocket(socket, token) {
    try {
      return await db.withTransaction(async (_conn, q) => {
        const user = await resolve(token, q, true);
        if (user && Number(user.is_banned || 0) !== 1) {
          socket.data.user = user;
          attachSocket(socket, token, user);
        }
        return user;
      });
    } catch (error) {
      const entry = sockets.get(socket);
      if (entry) { clearTimeout(entry.timer); sockets.delete(socket); }
      throw error;
    }
  }
  return { resolve, create, revokeRequest, changePassword, authenticateSocket, clear };
}
module.exports = { createAuthSessionService, tokenHash };
