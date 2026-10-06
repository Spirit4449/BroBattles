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
// Player snapshots go out every N ticks (60 / 2 = 30 Hz).
const SNAPSHOT_EVERY_TICKS = 2;
// Slower world-state packets (powerups, drops, timers) every N ticks (7.5 Hz).
const WORLD_STATE_EVERY_TICKS = 8;

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

// Each mode's world rectangle lives in src/shared/maps/arenas.json. This is
// how far past its edges players and projectiles may travel (px).
const WORLD_MARGIN = 400;

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
  WORLD_STATE_EVERY_TICKS,
  WORLD_MARGIN,
  PARTY_JOIN_REQUEST_TIMEOUT_MS,
};
