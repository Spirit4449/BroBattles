const fs = require('node:fs/promises');
const path = require('node:path');
const { distributeMatchRewards } = require('../core/gameRoom/rewardManager');

function createMatchResultService({ db, journalDir }) {
  const settling = new Map();
  const pending = new Set();
  async function prepare() {
    await fs.mkdir(journalDir, { recursive: true, mode: 0o700 });
    for (const id of await pendingMatchIds()) pending.add(id);
  }
  function snapshot(room, winnerTeam) {
    const players = [...room.players.values()].map(p => ({
      name: p.name, user_id: p.user_id, team: p.team, char_class: p.char_class,
      isBot: !!p.isBot, profile_icon_id: p.profile_icon_id,
    }));
    return { matchId: room.matchId, matchData: { modeId: room.matchData.modeId,
      modeVariantId: room.matchData.modeVariantId, map: room.matchData.map },
      winnerTeam, players, rewards: [...room.rewardStats],
      runtimeConfig: room.runtimeConfig?.get ? room.runtimeConfig.get() : room.runtimeConfig };
  }
  async function settle(record) {
    const key = Number(record.matchId);
    if (!Number.isSafeInteger(key) || key <= 0) throw new Error('Invalid result match ID');
    if (settling.has(key)) return settling.get(key);
    const work = (async () => {
      const room = { ...record, db, players: new Map(record.players.map((p, i) => [i, p])), rewardStats: new Map(record.rewards) };
      const rewards = await distributeMatchRewards(room, record.winnerTeam);
      await fs.unlink(path.join(journalDir, `${key}.json`)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      pending.delete(key);
      return rewards;
    })();
    settling.set(key, work);
    try { return await work; } finally { settling.delete(key); }
  }
  async function complete(room, winnerTeam) {
    const record = room._resultRecord || (room._resultRecord = snapshot(room, winnerTeam));
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
