// Where snapshots draw a human fighter.
//
// A human's position arrives whenever their input packets do: every 16-33 ms
// depending on their refresh rate, shifted by network jitter. Snapshots go out
// every 33 ms. Publishing whichever packet arrived last made a fighter running
// at constant speed move 9, 9, 18, 9, 9, 18 px between snapshots (25 ms packets
// against 33 ms snapshots), and network jitter made 0- and 2-packet snapshots
// common at any rate. Every viewer drew that as jitter, however smooth its own
// render timeline was.
//
// Instead, each accepted position is placed on the server clock by the
// sender's own timestamp (the recent packet that arrived soonest after it was
// sent defines the clock offset, so varying network delay drops out), and
// snapshots publish the sender's motion interpolated a short playout delay in
// the past: just long enough that a later packet nearly always brackets the
// published instant. The delay follows the sender's measured packet spacing
// and jitter (bounded by MAX_PLAYOUT_MS) and changes by a gentle slew.
//
// Position history (lag compensation) keys each accepted position by the time
// snapshots publish it, so rewinds still find what the attacker was shown.
// Server-side moves (respawn, hook pulls, the idle fallback, Inferno) publish
// immediately; the playout restarts from zero delay afterwards.

const SAMPLE_WINDOW = 48; // offsets and lags, about 1.5 s of packets
const OFFSET_WINDOW_MS = 3000;
const MAX_SAMPLES = 24;
const MAX_PLAYOUT_MS = 80;
const PLAYOUT_MARGIN_MS = 2;
const PLAYOUT_PERCENTILE = 0.9;
// Delay change per elapsed ms: the published motion runs at most 8% fast or
// slow while the delay adapts, like the client's delivery steering.
const PLAYOUT_SLEW = 0.08;

function playoutState(player) {
  return (player._playout ||= { samples: [], offsets: [], lags: [], delay: 0, target: 0, at: null });
}

// Drops buffered positions after a server-side move. The sender's clock
// offset and packet timing stay valid, so they are kept.
function restartPlayout(player) {
  const state = player?._playout;
  if (!state) return;
  state.samples.length = 0;
  state.delay = 0;
  state.at = null;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

// Records the position the server just accepted from a packet sent at the
// client's `clientTs` (its Date.now()). Returns the time to key it by in
// position history: when snapshots will publish it.
function notePlayoutSample(player, clientTs, now = Date.now()) {
  if (!Number.isFinite(clientTs)) {
    // Without a send time there is nothing to align: publish the latest.
    restartPlayout(player);
    if (player?._playout) player._playout.target = 0;
    return now;
  }
  const state = playoutState(player);
  const offsets = state.offsets;
  offsets.push({ at: now, offset: now - clientTs });
  while (offsets.length > SAMPLE_WINDOW || (offsets.length > 1 && offsets[0].at < now - OFFSET_WINDOW_MS)) offsets.shift();
  let minOffset = Infinity;
  for (const entry of offsets) if (entry.offset < minOffset) minOffset = entry.offset;
  // At most `now`: this packet's own offset is in the window.
  let t = clientTs + minOffset;
  const samples = state.samples;
  const newest = samples[samples.length - 1];
  if (newest) {
    // Until this packet arrived, `newest` was the latest position known: a
    // snapshot needed at least this much delay to interpolate instead of hold.
    state.lags.push(now - newest.t);
    if (state.lags.length > SAMPLE_WINDOW) state.lags.shift();
    if (t <= newest.t) t = newest.t + 0.01;
  }
  samples.push({ t, x: Number(player.x), y: Number(player.y), vx: Number(player.vx) || 0, vy: Number(player.vy) || 0 });
  while (samples.length > MAX_SAMPLES) samples.shift();
  state.target = Math.min(MAX_PLAYOUT_MS, percentile(state.lags, PLAYOUT_PERCENTILE) + PLAYOUT_MARGIN_MS);
  return t + state.delay;
}

// The motion a snapshot published at server wall time `wallAt` shows.
function publishedMotion(player, wallAt = Date.now()) {
  const current = { x: player.x, y: player.y, vx: player.vx, vy: player.vy };
  const state = player?._playout;
  const samples = state?.samples;
  if (player?.isBot || !samples?.length) return current;
  const newest = samples[samples.length - 1];
  if (newest.x !== Number(player.x) || newest.y !== Number(player.y)) {
    // Moved by the server since its last packet.
    restartPlayout(player);
    return current;
  }
  if (state.at != null) {
    const elapsed = Math.max(0, Math.min(250, wallAt - state.at));
    const limit = elapsed * PLAYOUT_SLEW;
    state.delay += Math.max(-limit, Math.min(limit, state.target - state.delay));
  }
  state.at = wallAt;
  const at = wallAt - state.delay;
  if (at >= newest.t) return current;
  let older = samples[0];
  if (at <= older.t) return { x: older.x, y: older.y, vx: older.vx, vy: older.vy };
  for (let i = 1; i < samples.length; i++) {
    const newer = samples[i];
    if (at > newer.t) { older = newer; continue; }
    const alpha = (at - older.t) / Math.max(1e-6, newer.t - older.t);
    const mix = (a, b) => a + (b - a) * alpha;
    return { x: mix(older.x, newer.x), y: mix(older.y, newer.y), vx: mix(older.vx, newer.vx), vy: mix(older.vy, newer.vy) };
  }
  return current;
}

module.exports = {
  MAX_PLAYOUT_MS,
  notePlayoutSample,
  publishedMotion,
  restartPlayout,
};
