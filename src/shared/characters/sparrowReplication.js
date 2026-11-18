// Transport/renderer-independent client timeline, also used by latency tests.
const { sample } = require('./sparrowProjectile');

class CombatClock {
  constructor() { this.reset(); }
  reset(epoch = null) {
    this.epoch = epoch; this.offset = null; this.simOffset = 0;
    this.samples = []; this.lastPacket = null; this.lastNow = null;
    // Date.now() - performance.now() on this client (replaceable in tests).
    this.wallOffset ||= () => Date.now() - performance.now();
    // This client's own playout delay in the room (snapshot `playoutMs`);
    // null until the server reports one (older servers never do).
    this.playoutMs = null;
    // How the server keys this client's frames in position history (snapshot
    // `historyMs`, see humanPlayout.reportedHistoryMs); null until reported.
    this.historyMs = null;
    // `netProjectileLead=0` turns enemy projectile lead off for A/B runs.
    if (this.projectileLead === undefined) this.projectileLead = true;
  }
  // The ping sample the offset comes from: the lowest round trip.
  bestSample() {
    let best = null;
    for (const p of this.samples) if (!best || p.rtt < best.rtt) best = p;
    return best;
  }
  noteHistory(ms) {
    const value = Number(ms);
    if (Number.isFinite(value)) this.historyMs = value;
  }
  // From this client's frame to the server's position-history key, without
  // the playout delay: the lowest recent uplink, on this clock (exact up to
  // the clock's own offset error, which cancels against now()). Before the
  // server reports it (or on an older one), half the best ping.
  uplinkMs(wallOffset = this.wallOffset()) {
    const best = this.bestSample();
    const fallback = best ? best.rtt / 2 : 0;
    if (!Number.isFinite(this.historyMs) || !Number.isFinite(this.offset) || !Number.isFinite(wallOffset)) return fallback;
    const uplink = this.historyMs + wallOffset - this.offset;
    return Number.isFinite(uplink) ? Math.max(0, Math.min(MAX_UPLINK_MS, uplink)) : fallback;
  }
  notePlayout(ms) {
    const value = Number(ms);
    this.playoutMs = Number.isFinite(value) ? Math.max(0, Math.min(MAX_PLAYOUT_REPORT_MS, value)) : this.playoutMs;
  }
  // How far ahead of this clock an ENEMY released projectile is drawn, so that
  // it overlaps this player on their own screen exactly when the server
  // registers the hit. Bot shots carry rewindMs 0; null/absent rewind (an
  // older server) means no lead at all.
  //
  // Derivation (all times as server real time tau; M = server performance.now):
  // * Server step for sim time s runs at M(tau_s) = s + k (k: the fixed-step
  //   accumulator lag, 0..17 ms) and tests the shot at age s - launchMono
  //   against the victim's position history at Date.now() - R (R = the
  //   shot's clamped view rewind, sent as `viewRewindMs`).
  // * humanPlayout keys each accepted packet by t + P, t = clientTs + minOffset,
  //   minOffset = clock skew + the minimum uplink u (3 s window), P = the
  //   playout delay. So history at real time K holds the position the victim
  //   drew and sent at K - u - P: the server's test at tau_s compares the
  //   projectile with the victim's self-view at tau_s - R - u - P. A teleport
  //   restarts playout at P = 0 (and history); P then slews back at <= 8 %,
  //   which the snapshot report follows.
  // * This clock reads now(tau) = M(tau) + (u_s - d_s)/2 - k', where u_s/d_s
  //   are the up/down trips of the lowest-RTT ping (its offset is the one in
  //   use) and k' = sentMono - simMono of the last packet.
  // * Same event on screen and on the server: the frame at tau must show age
  //   g with tau_s - R - u - P = tau, i.e. g = M(tau) + R + u + P - k - launchMono.
  //   Drawn age is now(tau) - launchMono + L, hence
  //       L = R + P + u - (u_s - d_s)/2 + (k' - k).
  // * u is the LOWEST uplink of the last 3 s of packets (minOffset), not a
  //   typical one: half the best ping overstated it by up to ~15 ms on a
  //   jittery link (production traces, "lead error"). The server reports its
  //   key offset (historyMs); uplinkMs() turns it into u - (u_s - d_s)/2 on
  //   this clock exactly. What is left is k' - k (publication time, a few ms).
  // * A shot with no rewind (a bot's) is tested against the latest position
  //   received, not the playout-delayed history: no P.
  enemyLeadMs(rewindMs) {
    const rewind = rewindMs == null ? NaN : Number(rewindMs);
    if (!this.projectileLead || !Number.isFinite(rewind)) return 0;
    const playout = rewind > 0 ? (this.playoutMs || 0) : 0;
    return Math.max(0, Math.min(MAX_ENEMY_LEAD_MS, rewind + this.uplinkMs() + playout));
  }
  observe(packet, received) {
    if (packet.epoch !== this.epoch || !Number.isFinite(packet.sentMono) || !Number.isFinite(packet.simMono)) return false;
    if (this.lastPacket && packet.sentMono < this.lastPacket.sentMono) return false;
    this.lastPacket = { ...packet, received };
    this.simOffset = packet.simMono - packet.sentMono;
    if (this.offset === null) this.offset = packet.sentMono - received;
    return true;
  }
  synchronize(packet, sent, received) {
    if (packet.epoch !== this.epoch || received < sent) return;
    this.samples.push({ rtt: received - sent, offset: packet.sentMono - (sent + received) / 2 });
    if (this.samples.length > 12) this.samples.shift();
    this.offset = this.samples.reduce((best, p) => p.rtt < best.rtt ? p : best).offset;
    this.observe(packet, received);
  }
  now(localNow) {
    if (!this.lastPacket) return localNow;
    const estimated = localNow + this.offset + this.simOffset;
    // Bound flight during a transport stall; do not hallucinate seconds of combat.
    const cap = this.lastPacket.received + this.offset + this.simOffset + 250;
    const next = Math.min(estimated, cap);
    this.lastNow = Math.max(this.lastNow ?? next, next);
    return this.lastNow;
  }
}

class SparrowReplica {
  // A supplied clock is shared (the client match clock) and is never reset here.
  constructor(clock = null) { this.ownsClock = !clock; this.clock = clock || new CombatClock(); this.reset(); }
  reset(epoch = null) {
    if (this.ownsClock) this.clock.reset(epoch);
    this.active = new Map(); this.terminals = new Map(); this.rejected = new Map();
  }
  launch(p, predicted = false) {
    if (this.terminals.has(p.id) || this.rejected.has(p.requestId)) return false;
    const previous = this.active.get(p.id);
    if (previous && !previous.predicted) return false;
    // The server launches an owner's shot about one upstream trip after the
    // prediction. Keep that lead instead of pulling the arrow back to the later
    // launch, which made confirmed arrows visibly hesitate mid-flight.
    const lead = previous ? clampLead(p.launchMono - previous.projectile.launchMono) : 0;
    this.active.set(p.id, { projectile: p, predicted, lead, revision: (previous?.revision || 0) + 1, shown: previous?.shown });
    return true;
  }
  terminate(terminal, localNow) {
    if (this.terminals.has(terminal.id)) return false;
    this.active.delete(terminal.id);
    this.terminals.set(terminal.id, { ...terminal, received: localNow });
    while (this.terminals.size > 512) this.terminals.delete(this.terminals.keys().next().value);
    return true;
  }
  reject(requestId, localNow) {
    this.rejected.set(requestId, localNow);
    while (this.rejected.size > 128) this.rejected.delete(this.rejected.keys().next().value);
    for (const [id, entry] of this.active) if (entry.projectile.requestId === requestId) this.active.delete(id);
  }
  // `enemy`: the projectile can damage this client's player, so it is drawn
  // ahead by the clock's enemy lead, ramped in (see advanceShownLead).
  position(id, localNow, enemy = false) {
    const entry = this.active.get(id);
    if (!entry) return null;
    const base = this.clock.now(localNow) - entry.projectile.launchMono + (entry.lead || 0);
    const victimLead = enemy && !entry.predicted
      ? advanceShownLead(entry.shown ||= {}, this.clock.enemyLeadMs(entry.projectile.viewRewindMs), localNow) : 0;
    const age = base + victimLead;
    return { ...sample(entry.projectile, age), age, victimLead };
  }
}
// A prediction can lead the server by its upstream latency. Bound it so a
// stalled request cannot fast-forward a confirmed shot.
const MAX_PREDICTION_LEAD_MS = 300;
function clampLead(ms) { return Number.isFinite(ms) ? Math.max(0, Math.min(MAX_PREDICTION_LEAD_MS, ms)) : 0; }
// Rewind cap (300) + a slow link's half round trip + the 80 ms playout cap.
const MAX_ENEMY_LEAD_MS = 500;
const MAX_PLAYOUT_REPORT_MS = 200;
const MAX_UPLINK_MS = 300;
// The lead is never applied at once. A drawn projectile closes the gap to its
// target lead at LEAD_CATCHUP ms per ms, so it flies at most 1.35x its real
// speed until it has caught up (about 430 ms for a 150 ms lead), then at its
// real speed. A fixed short ramp drew enemy shots at up to 3x speed, which
// read as shots flying faster than they really do. A shot that lands sooner
// than the catch-up is led only in part; those are close shots, which cannot
// be dodged anyway. Changes after that follow at LEAD_SLEW, and the lead
// drops no faster than LEAD_SLEW, so the drawn flight never runs backwards.
const LEAD_CATCHUP = 0.35;
const LEAD_SLEW = 0.1;
// Advances `state` (one per drawn projectile) and returns the lead to add to
// its server age this frame. `fromMs` is the offset shown on the first frame:
// 0 for flights already drawn at server age; minus the first age for flights
// that start from the hand at age 0 and catch up to the server.
function advanceShownLead(state, targetMs, localNow, fromMs = 0) {
  const target = Number.isFinite(targetMs) ? targetMs : 0;
  if (state.at == null) {
    state.at = localNow;
    state.caught = false;
    return (state.shown = Number.isFinite(fromMs) ? Math.min(fromMs, target) : 0);
  }
  const elapsed = Math.max(0, localNow - state.at);
  state.at = localNow;
  const up = elapsed * (state.caught ? LEAD_SLEW : LEAD_CATCHUP);
  state.shown += Math.max(-elapsed * LEAD_SLEW, Math.min(up, target - state.shown));
  if (state.shown >= target) state.caught = true;
  return state.shown;
}
module.exports = { CombatClock, SparrowReplica, LEAD_CATCHUP, clampLead, advanceShownLead };
