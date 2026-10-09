// invisibilityReveal.js
// Attacking while invisible briefly gives away a faded silhouette. Remote
// viewers see the attacker rise from hidden; the attacker sees themselves rise
// from their usual ghosted alpha, so they know they were exposed.
const HOLD_MS = 260;
const FADE_MS = 300;

export const INVISIBLE_ALPHA = Object.freeze({
  remote: { base: 0, peak: 0.35 },
  local: { base: 0.2, peak: 0.85 },
});

export function invisibleAttackAlpha(flashAt, { base, peak }, now = performance.now()) {
  const since = now - (Number.isFinite(flashAt) ? flashAt : -Infinity);
  if (since < 0 || since >= HOLD_MS + FADE_MS) return base;
  if (since < HOLD_MS) return peak;
  return peak + (base - peak) * ((since - HOLD_MS) / FADE_MS);
}
