// Net traces only (a traced room has room.netTrace and room.traceShotGap):
// how close each released shot came to a traced enemy's tested body on each
// server step, so the report can tell what a shot that touched the victim's
// screen without a hit really did on the server (see the networking guide,
// "Production network tracing"). Untraced rooms return before any work.
const { clientTimeAt } = require('./lagCompensation.js');
const { combatNow } = require('./clock');
const { deliveryOf } = require('../attackDelivery.js');

const SAMPLES = 8;

// Smallest distance between a circle swept from a to b and a box (negative
// when they overlap), sampled along the segment.
function segmentBoxGap(a, b, radius, box) {
  let best = Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const f = i / SAMPLES, x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
    const dx = Math.max(box.left - x, 0, x - box.right), dy = Math.max(box.top - y, 0, y - box.bottom);
    const gap = Math.hypot(dx, dy) - (Number(radius) || 0);
    if (gap < best) best = gap;
  }
  return best;
}

function playerNamed(room, name) {
  for (const p of room.players?.values?.() || []) if (p?.name === name) return p;
  return null;
}

// `targets`: [{ name, bounds }] as the runtime tested them (Sparrow's inset,
// rewound boxes), or players with `boundsOf(player)`. `age`: the shot's age at
// the step (what a hit record reports as ageMs).
function traceShotGaps(room, { pid, attacker, a, b, radius, age, rewindMs, targets, boundsOf = null }) {
  if (!room?.netTrace || typeof room.traceShotGap !== 'function' || pid == null || !a) return;
  const now = combatNow(room);
  for (const t of targets || []) {
    const player = t?.socketId !== undefined ? t : playerNamed(room, t?.name);
    if (!player || player.isBot) continue;
    const bounds = boundsOf ? boundsOf(t) : t.bounds;
    if (!bounds) continue;
    room.traceShotGap({ pid, attacker, target: player, gap: segmentBoxGap(a, b || a, radius, bounds), age, rewindMs,
      vTs: clientTimeAt(player, rewindMs, now) });
  }
}

// Attack-runtime shots (Ozzy fireball, Gloop slimeball and hook) by delivery.
function traceRuntimeShot(room, attack, attacker, target, a, b, radius, bounds) {
  if (!room?.netTrace || deliveryOf(attack?.runtimeKind) !== 'released') return;
  traceShotGaps(room, { pid: attack.instanceId, attacker, a, b, radius, age: attack.elapsed, rewindMs: attack.viewRewindMs,
    targets: [target], boundsOf: () => bounds });
}

module.exports = { traceShotGaps, traceRuntimeShot };
