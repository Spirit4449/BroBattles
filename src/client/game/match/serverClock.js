import { CombatClock } from "../../../shared/characters/huntressReplication";

// The one client estimate of server time. Snapshots and combat packets keep it
// tied to the room's epoch; game:clock pings refine the offset with the
// lowest-RTT sample (NTP-style). Ninja/Huntress projectiles read it through
// CombatClock.now(), and hit reports send serverNowMono() so the server can
// rewind position history without trusting the client's wall clock.
const BURST_PINGS = 5;
const BURST_SPACING_MS = 120;
const STEADY_INTERVAL_MS = 2000;

export const serverClock = new CombatClock();

let socketRef = null;
let steadyTimer = null;
let burstTimers = [];
let generation = 0;

function ping() {
  const socket = socketRef;
  if (!socket?.connected || !serverClock.epoch) return;
  const current = generation;
  const epoch = serverClock.epoch;
  const sent = performance.now();
  socket.timeout(1500).emit("game:clock", {}, (error, response) => {
    if (error || !response || current !== generation || serverClock.epoch !== epoch) return;
    serverClock.synchronize(response, sent, performance.now());
  });
}

function clearBurst() {
  for (const timer of burstTimers) clearTimeout(timer);
  burstTimers = [];
}

function startBurst() {
  clearBurst();
  for (let i = 0; i < BURST_PINGS; i++) {
    burstTimers.push(setTimeout(ping, i * BURST_SPACING_MS));
  }
}

// A new room instance invalidates every sample. Re-observing the same epoch is
// a no-op, so several consumers may call this freely.
export function ensureServerClockEpoch(epoch) {
  if (!epoch || serverClock.epoch === epoch) return false;
  generation++;
  serverClock.reset(epoch);
  startBurst();
  return true;
}

export function observeServerClockSnapshot(snapshot, received = performance.now()) {
  if (!snapshot?.snapshotEpoch) return;
  ensureServerClockEpoch(snapshot.snapshotEpoch);
  serverClock.observe({ epoch: snapshot.snapshotEpoch, sentMono: snapshot.sentMono,
    simMono: snapshot.tMono }, received);
}

export function startServerClockSync(socket) {
  socketRef = socket;
  clearInterval(steadyTimer);
  steadyTimer = setInterval(ping, STEADY_INTERVAL_MS);
  if (serverClock.epoch) startBurst();
}

// Reconnects route through a new transport; re-measure immediately.
export function resyncServerClock() {
  if (serverClock.epoch) startBurst();
}

export function stopServerClockSync() {
  generation++;
  clearInterval(steadyTimer);
  steadyTimer = null;
  clearBurst();
  socketRef = null;
}

// Estimated current server performance.now(), or null before any sample.
export function serverNowMono(localNow = performance.now()) {
  return Number.isFinite(serverClock.offset) ? localNow + serverClock.offset : null;
}

export function getServerClockDiagnostics() {
  const best = serverClock.samples.reduce((a, b) => (!a || b.rtt < a.rtt ? b : a), null);
  return { epoch: serverClock.epoch, offsetMs: serverClock.offset,
    bestRttMs: best?.rtt ?? null, samples: serverClock.samples.length };
}
