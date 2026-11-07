// Distance-over-time for straight projectiles that ease up to speed instead of
// leaving at full speed on the first tick. The server's damage circle and the
// client's drawn sprite both read this curve, so an eased launch never moves
// the hitbox away from what players see.
//
// Speed rises from `launchStartSpeed` (a fraction of `speed`) to `speed` over
// `launchEaseMs` along a smoothstep, then holds. Without `launchEaseMs` the
// curve is plain constant speed.

function rampOf(config = {}) {
  const speed = Math.max(1, Number(config.speed) || 1);
  const easeMs = Math.max(0, Number(config.launchEaseMs) || 0);
  const start = Math.min(1, Math.max(0, Number(config.launchStartSpeed ?? 1)));
  return { speed, easeMs, start };
}

// Pixels travelled `elapsedMs` after release.
function launchTravel(elapsedMs, config) {
  const { speed, easeMs, start } = rampOf(config);
  const t = Math.max(0, Number(elapsedMs) || 0) / 1000;
  const ease = easeMs / 1000;
  if (!ease || start >= 1) return speed * t;
  if (t >= ease) return speed * (ease * (start + (1 - start) / 2) + (t - ease));
  const u = t / ease;
  // Integral of smoothstep(u) = u^3 - u^4 / 2.
  return speed * (start * t + (1 - start) * ease * (u * u * u - (u * u * u * u) / 2));
}

// How far behind a constant-speed shot an eased one runs once at full speed,
// in ms. Aim solvers add it to their startup.
function launchLagMs(config) {
  const { easeMs, start } = rampOf(config);
  return start >= 1 ? 0 : easeMs * (1 - start) / 2;
}

// Milliseconds an eased shot needs to cover `range`.
function launchDurationMs(range, config) {
  const { speed, easeMs } = rampOf(config);
  const distance = Math.max(0, Number(range) || 0);
  if (!easeMs || distance >= launchTravel(easeMs, config)) {
    return (distance / speed) * 1000 + launchLagMs(config);
  }
  let lo = 0, hi = easeMs;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (launchTravel(mid, config) < distance) lo = mid; else hi = mid;
  }
  return hi;
}

module.exports = { launchTravel, launchLagMs, launchDurationMs };
