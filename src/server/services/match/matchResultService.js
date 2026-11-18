const fs = require('node:fs/promises');
const path = require('node:path');
const { settleMatchResult, snapshotResult } = require('./rewardSettlement');

function createMatchResultService({ db, journalDir }) {
  const completing = new Map();
  const settling = new Map();
  const pending = new Set();
  async function prepare() {
    await fs.mkdir(journalDir, { recursive: true, mode: 0o700 });
    for (const id of await pendingMatchIds()) pending.add(id);
  }
  async function settle(record) {
    const key = Number(record.matchId);
    if (!Number.isSafeInteger(key) || key <= 0) throw new Error('Invalid result match ID');
    if (settling.has(key)) return settling.get(key);
    const work = (async () => {
      const rewards = await settleMatchResult(db, record);
      await fs.unlink(path.join(journalDir, `${key}.json`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      pending.delete(key);
      return rewards;
    })();
    settling.set(key, work);
    try { return await work; } finally { settling.delete(key); }
  }
  function complete(room, winnerTeam) {
    const key = Number(room.matchId);
    if (!completing.has(key)) {
      const work = writeAndSettle(room, winnerTeam).finally(() => completing.delete(key));
      completing.set(key, work);
    }
    return completing.get(key);
  }
  async function writeAndSettle(room, winnerTeam) {
    const record = room._resultRecord || (room._resultRecord = snapshotResult(room, winnerTeam));
    pending.add(Number(record.matchId));
    await prepare();
    const target = path.join(journalDir, `${Number(record.matchId)}.json`);
    const temporary = `${target}.tmp`;
    const handle = await fs.open(temporary, 'w', 0o600);
    try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temporary, target);
    const directory = await fs.open(journalDir, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    return settle(record);
  }
  let reconciling = false;
  async function reconcile() {
    if (reconciling) return;
    reconciling = true;
    try {
      await prepare();
      const files = await fs.readdir(journalDir);
      for (const file of files.filter(name => /^\d+\.json$/.test(name)).slice(0, 100)) {
        try { await settle(JSON.parse(await fs.readFile(path.join(journalDir, file), 'utf8'))); }
        catch (error) { console.error('[rewards] result pending', file, error?.message); }
      }
    } finally { reconciling = false; }
  }
  async function pendingMatchIds() {
    return (await fs.readdir(journalDir)).filter(name => /^\d+\.json$/.test(name)).map(name => Number(name.slice(0, -5)));
  }
  return { complete, reconcile, prepare, pendingMatchIds, isPending: matchId => pending.has(Number(matchId)) };
}
module.exports = { createMatchResultService };
