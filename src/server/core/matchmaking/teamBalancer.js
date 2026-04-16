function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    const g = m.get(k);
    if (g) g.push(x);
    else m.set(k, [x]);
  }
  return m;
}

function ageSeconds(row) {
  return Math.floor((Date.now() - new Date(row.created_at).getTime()) / 1000);
}

function pickCompositeGroup(items, teamSize, options = {}) {
  const { suppressNoComboLog = false } = options;
  if (!items.length) return null;
  const sorted = items
    .slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const oldest = sorted[0];
  const window = Math.min(400, 100 + Math.floor(ageSeconds(oldest) * 15));

  const used = new Set();
  const best = dfs(0, { t1: 0, t2: 0, t1mmr: 0, t2mmr: 0, picks: [] });
  if (!best && !suppressNoComboLog) {
    console.log(
      `[mm] no-combo S=${teamSize} window=${window} pool=${sorted
        .map((t) => `${t.team1_count}/${t.team2_count}`)
        .join("|")}`,
    );
  }
  return best;

  function dfs(startIdx, acc) {
    if (acc.t1 === teamSize && acc.t2 === teamSize) {
      const avg1 = acc.t1mmr / teamSize;
      const avg2 = acc.t2mmr / teamSize;
      if (Math.abs(avg1 - avg2) <= window) return acc.picks.slice();
      return null;
    }
    for (let i = startIdx; i < sorted.length; i++) {
      const t = sorted[i];
      if (used.has(t.ticket_id)) continue;
      const variants = [
        { flip: false, t1c: t.team1_count, t2c: t.team2_count },
        { flip: true, t1c: t.team2_count, t2c: t.team1_count },
      ];
      for (const v of variants) {
        if (acc.t1 + v.t1c > teamSize || acc.t2 + v.t2c > teamSize) continue;
        const next = {
          t1: acc.t1 + v.t1c,
          t2: acc.t2 + v.t2c,
          t1mmr: acc.t1mmr + t.mmr * v.t1c,
          t2mmr: acc.t2mmr + t.mmr * v.t2c,
          picks: acc.picks.concat({ ticket: t, flip: v.flip }),
        };
        const res = dfs(i + 1, next);
        if (res) return res;
      }
    }
    return null;
  }
}

module.exports = {
  groupBy,
  pickCompositeGroup,
};
