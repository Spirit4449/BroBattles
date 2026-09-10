const crypto = require('node:crypto');

// The current socket routing and live simulation require one process per database.
// Hold the lock on a dedicated connection, never a connection returned to the pool.
async function acquireRuntimeOwnership({ connect, database, onLost, intervalMs = 2000 }) {
  const connection = await connect();
  const name = `bb:runtime:${crypto.createHash('sha256').update(database).digest('hex').slice(0, 48)}`;
  let stopped = false, timer = null, checking = false;
  function lost(error) {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    connection.destroy();
    onLost(error);
  }
  connection.on('error', lost);
  try {
    const [rows] = await connection.query({ sql: 'SELECT GET_LOCK(?, 0) AS acquired', timeout: 5000 }, [name]);
    if (Number(rows[0]?.acquired) !== 1) throw new Error('Another game server already owns this database. Stop it before starting this instance.');
  } catch (error) {
    stopped = true;
    connection.destroy();
    throw error;
  }
  timer = setInterval(async () => {
    if (stopped || checking) return;
    checking = true;
    try {
      const [rows] = await connection.query({ sql: 'SELECT IS_USED_LOCK(?) = CONNECTION_ID() AS owned', timeout: 5000 }, [name]);
      if (Number(rows[0]?.owned) !== 1) throw new Error('Game server ownership was lost');
    } catch (error) { lost(error); }
    finally { checking = false; }
  }, intervalMs);
  timer.unref?.();
  return { async release() {
    stopped = true;
    clearInterval(timer);
    await connection.end();
  } };
}
module.exports = { acquireRuntimeOwnership };
