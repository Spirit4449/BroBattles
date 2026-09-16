# Damage hitbox debugging

Admins can check **Debug hitboxes** next to **Edit map** in the map picker. The
editor inherits that option, and its toolbar checkbox controls the next playtest.
Blue/green outlines show map and physics bodies; pink outlines show server damage
volumes. Ctrl+M hides/shows the overlay during a debug playtest.

`src/server/core/gameRoom/damageHitboxes.js` is the common damage-shape publisher.
It runs only in editor rooms with debug enabled. Normal matches send no additional
hitbox data. The debug transport itself does not alter damage rules; attack
geometry remains controlled by the shared character tuning and collision helpers.

For new attacks:

- Prefer `hitCircleTargets` or `hitRectTargets`; both publish their exact input
  geometry before searching targets, including when no enemies are present.
- Straight projectiles can declare `collisionForwardOffset` in character tuning
  when the damaging part of asymmetric artwork is ahead of or behind its motion
  origin. The shared runtime rotates that offset with the attack angle.
- Sprite-sheet attacks can declare `collisionOffsetY` for a world-space vertical
  correction. This preserves their aim direction and forward reach.
- Connected melee weapons should use `hitCapsuleTargets` from the wielder's body
  center to the weapon tip. This prevents a detached head-only box and keeps the
  debug outline identical to the authoritative damage query.
- Dedicated collision protocols must call `exposeDamageHitbox(room, source,
  shape, now, part)` immediately before collision evaluation. Reuse the same
  coordinates/radius as that evaluation. Source IDs must identify each projectile;
  use `part` for independently damaging pieces or sweep segments.
- Supported shapes are `circle` (`x`, `y`, `radius`), `rect` (`left`, `right`,
  `top`, `bottom`), `sweep` (`a`, `b`, `radius`), and `sector` (`x`, `y`, `radius`,
  `innerRadius`, `angle`, `halfSpread`). Angles are radians.
- A new shape kind needs support in `src/gameScene/damageHitboxDebug.js` and a test.
  Extend `tests/damageHitboxes.test.js` when adding a new collision protocol.

Generic projectiles, splash rectangles, Thorg's hammer, returning projectiles,
hooks, cones, Ninja shurikens, Huntress arrows, Inferno, turret shots, and sudden
death poison use this API. Attached burn/poison status effects have no separate
spatial collision volume: their originating attack and affected player already
have outlines.

The overlay shows authoritative server samples, so it may trail client-predicted
art. Samples persist for 120 ms to expose impacts occurring between snapshots;
this retention does not extend damage windows. Disconnected/stalled snapshot
streams clear the client overlay after 250 ms. Scene shutdown removes listeners.
