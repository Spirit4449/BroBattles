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

// Fallback playfield used when a map document does not define its own world
// rectangle. Real maps set `bounds`/`world` in src/shared/maps/<id>.json.
const WORLD_BOUNDS = Object.freeze({
  width: 3600, // playfield width (px)
  height: 1000, // playfield height (px); poison/sudden-death floor
  margin: 400, // how far past the edges players/projectiles may travel (px)
});

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
  WORLD_BOUNDS,
  PARTY_JOIN_REQUEST_TIMEOUT_MS,
};
