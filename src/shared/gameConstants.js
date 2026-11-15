// Cross-cutting game constants shared by the server, the browser client, bots,
// and tools. Anything both sides must agree on lives here; values owned by one
// feature live with that feature (see docs/development/constants.md for the full map).

// ---------------------------------------------------------------------------
// Simulation clock
// ---------------------------------------------------------------------------

// Authoritative server simulation rate. Client snapshot interpolation, bot
// movement prediction, and the replicated projectile replays all step at this.
const SERVER_TICK_HZ = 60;
// Duration of one fixed simulation step (ms). Derived; edit SERVER_TICK_HZ.
const FIXED_DT_MS = 1000 / SERVER_TICK_HZ;
// Player snapshots go out every N ticks: every tick (60 Hz) by default, which
// halves the render delay of remote players against 30 Hz for ~25 ms/s more
// publish time on the Pi (measured 2026-11-15). A server
// can run another rate (BB_SNAPSHOT_HZ, see snapshotEveryTicksFor) and tells
// clients its interval in game:init, so only the server reads this default.
// Projectile and bot steps derive from FIXED_DT_MS, never from this.
const SNAPSHOT_EVERY_TICKS = 1;

// Ticks between player snapshots for a requested rate in Hz (for example
// BB_SNAPSHOT_HZ=30). Missing or invalid values keep the default; the rate is
// a whole divisor of the tick rate, at most one snapshot per tick.
function snapshotEveryTicksFor(hz) {
  const value = Number(hz);
  if (!Number.isFinite(value) || value <= 0) return SNAPSHOT_EVERY_TICKS;
  return Math.max(1, Math.min(SERVER_TICK_HZ, Math.round(SERVER_TICK_HZ / value)));
}
// The longest render delay (interpolation buffer) a client keeps behind the
// snapshots it receives (ms). Attack requests report their render delay and the
// server honours at most this much of it (shared/combat/attackDelivery.js).
const MAX_RENDER_DELAY_MS = 115;
// Slower world-state packets (powerups, drops, timers) every N ticks (7.5 Hz).
const WORLD_STATE_EVERY_TICKS = 8;

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

// Each mode's world rectangle lives in src/shared/maps/arenas.json. This is
// how far past its edges players and projectiles may travel (px).
const WORLD_MARGIN = 400;
// A player whose position is this far below the world's bottom edge has fallen
// out and dies instantly (px). Must stay below WORLD_MARGIN to be reachable.
const FALL_OUT_DEPTH = 50;

// ---------------------------------------------------------------------------
// Lobby & party
// ---------------------------------------------------------------------------

// How long a "request to join party" stays pending before it auto-expires.
// The server enforces it; the client uses it to render the countdown.
const PARTY_JOIN_REQUEST_TIMEOUT_MS = 15_000;

module.exports = {
  SERVER_TICK_HZ,
  FIXED_DT_MS,
  SNAPSHOT_EVERY_TICKS,
  snapshotEveryTicksFor,
  MAX_RENDER_DELAY_MS,
  WORLD_STATE_EVERY_TICKS,
  WORLD_MARGIN,
  FALL_OUT_DEPTH,
  PARTY_JOIN_REQUEST_TIMEOUT_MS,
};
