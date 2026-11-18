// Canonical ammo timeline for fixed server ticks, local frames and replication catch-up.
function advanceAmmoClock(ammo, elapsedMs) {
  if (!ammo || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
  ammo.nextFireInMs = Math.max(0, ammo.nextFireInMs - elapsedMs);
  if (ammo.charges >= ammo.capacity || !(ammo.reloadMs > 0)) {
    ammo.reloadTimerMs = 0;
    return;
  }
  const progress = ammo.reloadTimerMs + elapsedMs;
  ammo.charges = Math.min(ammo.capacity, ammo.charges + Math.floor(progress / ammo.reloadMs));
  ammo.reloadTimerMs = ammo.charges >= ammo.capacity ? 0 : progress % ammo.reloadMs;
}

function consumeAmmoCharge(ammo) {
  ammo.charges -= 1;
  ammo.nextFireInMs = ammo.cooldownMs;
}

module.exports = { advanceAmmoClock, consumeAmmoCharge };
