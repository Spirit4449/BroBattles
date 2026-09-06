# Ninja combat

Ninja basics and supers now use one server runtime for humans and bots. New rooms
require clients advertising `ninjaCombatVersion: 1`; restart the server and reload
clients together. No attack-speed, range, damage or reload tuning was changed.

## Behavior

- The shared `ninjaProjectile` model defines the outgoing curve, hover, fixed 60 Hz
  homing return and canonical launch geometry. The basic reticle is a straight aim line.
- Basic shots and staggered super shards predict visuals immediately. Accepted
  launch packets replace predictions by ID and catch up to simulation time.
- Server tuning supplies projectile properties. Requests validate identity through
  the socket participant, aim, ammo, cooldown, charge and eligibility. Client hit
  and map-return claims cannot determine Ninja outcomes.
- Swept player/vault contact applies damage at most once per target per flight leg.
  Registered contacts bypass the legacy shooter-distance check. Blocked damage
  never produces a successful damage effect.
- Wall contact uses the projectile center rather than its enlarged player-hit radius,
  so it reaches the collider before turning. Walls turn outgoing shots back for
  humans and bots; returning shots pass through
  terrain. This preserves the old human basic behavior and extends it consistently
  to bot shots and super shards.
- Only an authoritative basic return refunds ammo. Supers never refund ammo.
- Launches, impacts, terminals and compact return corrections use existing
  `game:action` transport. Homing returns receive corrections at 10 Hz because
  their path depends on moving owners. This adds some bandwidth, particularly
  during supers; outgoing positions are not streamed every frame.
- Reconnect state contains active projectiles and bounded terminal records. Rejected
  predictions and completed shots cannot be restarted by a late launch. Death and
  disconnect cancel pending shards and active flight.

## Verification

`npm run test:network` includes Ninja server and renderer regressions. Tests cover
human/bot authority, forged claims, ammo/refunds, moved shooters, shields, vaults,
thin terrain, staggered supers, death, reconnect records, frame-rate agreement,
late launches, prediction rejection, duplicate impacts and return corrections.
The full workspace suite and production build were also run during implementation.

Live two-client play under artificial latency has not been verified in this pass.
Human movement remains report-driven. Return corrections and last-moment dodges
can still reflect movement latency; no movement rewind or bot decision changes
are included.
