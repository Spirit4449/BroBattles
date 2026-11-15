// Victim screen truth for production tracing (netTrace.js; inactive unless a
// traced tab installed it). The networking guide's promise to the victim is
// "if it did not touch me on my screen I take no damage". For every enemy
// released shot that can damage this player, the character code reports the
// shot as drawn each frame (shotPrediction.traceEnemyShot); this keeps the
// gap between that circle and this player's drawn body and emits compact rows
// only at meaningful moments, so the report can tell, per shot, whether it
// touched the drawn body before the server hit this player with it (or never
// hit it at all). Combat rows ([t, what, ...], client performance.now()):
//   "es" first shown: id, shooter, character, shown lead, target lead, R
//        (view rewind), rtt/2, P (playout), gap, uplink history is keyed by
//   "et" first touch (gap <= 0 or held): id, gap, flight age drawn (server
//        age + lead shown), lead shown
//   "ea" a shot that came within TRACK_GAP_PX, at its end: id, first frame
//        time, then (ms since it, gap, flight age) per frame while within
//        TRACK_GAP_PX; the report reads what was drawn at the instant the
//        server tested (hit/near `vTs`)
//   "eh" hold on body began (1) or ended (0): id, 1|0
//   "ee" no longer drawn: id, min gap, ms from shown to min gap, last gap,
//        ms touching, max shown lead
//   "vh" this player's health dropped from a hit: delivery, attacker, shot
//        id, gap now, gap at the estimated server registration (arrival minus
//        half the best RTT), min gap up to it, ms the first touch preceded it
//        (negative: after), and 1 when the shot was traced (released) or the
//        attacker's drawn body was found (attached)
const HISTORY = 240;
const TRACK_GAP_PX = 600;
const END_AFTER_MS = 250;
const KEEP_ENDED_MS = 2500;

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

// Distance from a circle to a box; negative when they overlap (the circle
// centre inside the box counts as -radius).
export function circleBoxGap(x, y, radius, b) {
  if (!b) return null;
  const dx = Math.max(b.left - x, 0, x - b.right), dy = Math.max(b.top - y, 0, y - b.bottom);
  return Math.hypot(dx, dy) - (Number(radius) || 0);
}

export function boxGap(a, b) {
  if (!a || !b) return null;
  return Math.hypot(Math.max(a.left - b.right, 0, b.left - a.right), Math.max(a.top - b.bottom, 0, b.top - a.bottom));
}

// `row(array)` appends a combat row; `lead()` returns { rtt2, playout,
// target(rewindMs) } from the match clock.
export function createVictimScreenTracker({ row, lead = () => null }) {
  const shots = new Map();
  const ended = new Map();

  function note(t, id, shooter, character, gap, shownLead, rewindMs, held, age = null) {
    if (id == null || !Number.isFinite(gap)) return;
    const key = String(id);
    let s = shots.get(key);
    if (held) gap = Math.min(gap, 0);
    if (!s) {
      const clock = lead(rewindMs) || {};
      s = { id: key, shooter, character, first: t, last: t, minGap: gap, minAt: t, gap, touch: null, touchMs: 0,
        held: false, maxLead: shownLead || 0, history: [] };
      shots.set(key, s);
      ended.delete(key);
      row([r1(t), "es", key, shooter ?? null, character ?? null, r1(shownLead), r1(clock.target), r1(Number(rewindMs)),
        r1(clock.rtt2), r1(clock.playout), r1(gap), r1(clock.uplink)]);
    }
    if (s.gap <= 0 && gap <= 0) s.touchMs += t - s.last;
    s.last = t; s.gap = gap;
    if (gap < s.minGap) { s.minGap = gap; s.minAt = t; }
    if (Number.isFinite(shownLead) && shownLead > s.maxLead) s.maxLead = shownLead;
    if (s.touch == null && gap <= 0) { s.touch = t; row([r1(t), "et", key, r1(gap), r1(age), r1(shownLead)]); }
    if (!!held !== s.held) { s.held = !!held; row([r1(t), "eh", key, held ? 1 : 0]); }
    s.history.push(t, gap);
    if (s.history.length > HISTORY * 2) s.history.splice(0, 2);
    if (gap <= TRACK_GAP_PX && Number.isFinite(age)) {
      const track = (s.track ||= []);
      track.push(t, gap, age);
      if (track.length > HISTORY * 3) track.splice(0, 3);
    }
  }

  function finish(s, t) {
    shots.delete(s.id);
    if (s.held) row([r1(t), "eh", s.id, 0]);
    row([r1(t), "ee", s.id, r1(s.minGap), r1(s.minAt - s.first), r1(s.gap), r1(s.touchMs), r1(s.maxLead)]);
    if (s.track?.length) {
      const t0 = s.track[0], out = [r1(t), "ea", s.id, r1(t0)];
      for (let i = 0; i < s.track.length; i += 3) out.push(r1(s.track[i] - t0), r1(s.track[i + 1]), r1(s.track[i + 2]));
      row(out);
    }
    ended.set(s.id, { ...s, endedAt: t });
  }

  // Once per frame: shots not drawn for a while have ended.
  function sweep(t) {
    for (const s of shots.values()) if (t - s.last > END_AFTER_MS) finish(s, t);
    for (const [id, s] of ended) if (t - s.endedAt > KEEP_ENDED_MS) ended.delete(id);
  }

  function flush(t) {
    for (const s of [...shots.values()]) finish(s, t);
  }

  // A health update that damaged this player. `registeredAt`: the estimated
  // client time the server applied it. `attachedGap`: for attached hits, the
  // gap between the attacker's drawn body and this player's, when known.
  function hit(t, { delivery = null, by = null, pid = null, registeredAt = t, attachedGap = null } = {}) {
    const key = pid == null ? null : String(pid);
    const s = key ? shots.get(key) || ended.get(key) : null;
    if (!s) {
      row([r1(t), "vh", delivery, by, key, r1(attachedGap), r1(attachedGap), null, null, delivery === "released" ? 0 : attachedGap == null ? 0 : 1]);
      return;
    }
    let atReg = null, minToReg = Infinity;
    for (let i = 0; i < s.history.length; i += 2) {
      if (s.history[i] > registeredAt) break;
      atReg = s.history[i + 1];
      if (atReg < minToReg) minToReg = atReg;
    }
    // History is bounded: a shot drawn long before keeps its overall minimum.
    if (s.minAt <= registeredAt && s.minGap < minToReg) minToReg = s.minGap;
    row([r1(t), "vh", delivery, by, key, r1(s.gap), r1(atReg), Number.isFinite(minToReg) ? r1(minToReg) : null,
      s.touch == null ? null : r1(registeredAt - s.touch), 1]);
  }

  return { note, sweep, flush, hit, active: () => shots.size };
}
