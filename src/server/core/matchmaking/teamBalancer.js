const { ratingWindow } = require('./mmrUtils');
function groupBy(items, fn) {
  const result = new Map();
  for (const item of items) { const key = fn(item); if (!result.has(key)) result.set(key, []); result.get(key).push(item); }
  return result;
}

// Capacity is at most six. Dynamic programming avoids an exponential ticket search.
function pickGroup(items, teamSize, { partial = false, anchorId = null, now = Date.now() } = {}) {
  const sorted = [...items].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.ticket_id - b.ticket_id);
  if (!sorted.length) return null;
  const anchors = anchorId == null ? sorted : sorted.filter((t) => t.ticket_id === anchorId);
  for (const anchor of anchors) {
    const window = ratingWindow(anchor, now);
    const pool = [anchor, ...sorted.filter((t) => t !== anchor && Math.abs(t.mmr - anchor.mmr) <= window)];
    let states = [{ t1: 0, t2: 0, sum1: 0, sum2: 0, picks: [] }];
    for (const ticket of pool) {
      const next = new Map();
      const retain = (state) => {
        // Preserve rating alternatives instead of collapsing all rosters of a size.
        const key = `${state.t1}:${state.t2}:${state.sum1}:${state.sum2}`;
        if (!next.has(key)) next.set(key, state);
      };
      for (const s of states) {
        if (ticket !== anchor) retain(s);
        for (const flip of [false, true]) {
          const a = Number(flip ? ticket.team2_count : ticket.team1_count), b = Number(flip ? ticket.team1_count : ticket.team2_count);
          if (s.t1 + a > teamSize || s.t2 + b > teamSize) continue;
          retain({ t1: s.t1 + a, t2: s.t2 + b, sum1: s.sum1 + ticket.mmr * a, sum2: s.sum2 + ticket.mmr * b,
            picks: [...s.picks, { ticket, flip }] });
        }
      }
      // Bound work for unusually fragmented queues; retain fullest, best balanced states.
      states = [...next.values()].sort((a, b) => (b.t1 + b.t2) - (a.t1 + a.t2) || balance(a) - balance(b)).slice(0, 4096);
    }
    const valid = states.filter((s) => s.picks.length && (partial || (s.t1 === teamSize && s.t2 === teamSize && balance(s) <= window)));
    valid.sort((a, b) => (b.t1 + b.t2) - (a.t1 + a.t2) || balance(a) - balance(b));
    if (valid.length) return valid[0].picks;
  }
  return null;
}
function balance(s) { return Math.abs((s.t1 ? s.sum1 / s.t1 : 0) - (s.t2 ? s.sum2 / s.t2 : 0)); }
function pickCompositeGroup(items, teamSize, options = {}) { return pickGroup(items, teamSize, options); }
module.exports = { groupBy, pickCompositeGroup, pickGroup };
