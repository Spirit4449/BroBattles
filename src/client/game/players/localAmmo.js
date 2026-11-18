import { DEFAULT_AMMO_CAPACITY, DEFAULT_AMMO_COOLDOWN_MS, DEFAULT_AMMO_RELOAD_MS } from "../../../shared/characters/characterStats.js";
import { advanceAmmoClock, consumeAmmoCharge } from "../../../shared/combat/ammoClock.js";

export function createLocalAmmo() {
  const state = {};
  let nextFireAt = 0;
  function reset(stats = {}) {
    state.capacity = Math.max(1, stats.ammoCapacity ?? DEFAULT_AMMO_CAPACITY);
    state.charges = state.capacity;
    state.cooldownMs = stats.ammoCooldownMs ?? DEFAULT_AMMO_COOLDOWN_MS;
    state.reloadMs = stats.ammoReloadMs ?? DEFAULT_AMMO_RELOAD_MS;
    state.reloadTimerMs = 0;
    state.nextFireInMs = 0;
    nextFireAt = 0;
  }
  function applyAuthoritative(packet) {
    if (!packet || typeof packet !== "object") return;
    const { capacity, charges, cooldownMs, reloadMs, reloadTimerMs, nextFireInMs } = packet;
    if (Number.isFinite(+capacity) && +capacity > 0) state.capacity = Math.max(1, Math.round(capacity));
    if (Number.isFinite(+charges)) state.charges = Math.max(0, Math.min(state.capacity, Math.round(charges)));
    if (Number.isFinite(+cooldownMs) && +cooldownMs > 0) state.cooldownMs = +cooldownMs;
    if (Number.isFinite(+reloadMs) && +reloadMs > 0) state.reloadMs = +reloadMs;
    if (Number.isFinite(+reloadTimerMs) && +reloadTimerMs >= 0) state.reloadTimerMs = Math.min(state.reloadMs, +reloadTimerMs);
    if (Number.isFinite(+nextFireInMs)) nextFireAt = Date.now() + Math.max(0, +nextFireInMs);
  }
  reset();
  return {
    state, reset, applyAuthoritative,
    get nextFireAt() { return nextFireAt; },
    tick(delta) { advanceAmmoClock(state, delta); },
    consume(now) {
      if (state.charges <= 0 || now < nextFireAt) return false;
      consumeAmmoCharge(state);
      nextFireAt = now + state.nextFireInMs;
      return true;
    },
    grant(count) {
      state.charges = Math.min(state.capacity, state.charges + count);
      if (state.charges === state.capacity) state.reloadTimerMs = 0;
    },
    snapshot() { return { ...state, nextFireInMs: Math.max(0, Math.round(nextFireAt - Date.now())) }; },
  };
}
