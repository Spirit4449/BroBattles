# Adding New Characters

Use this file when you want to add a playable character. It lists the exact information needed from design, art, audio, and balance so implementation can happen without repeated back-and-forth.

## Quick Request Template

Copy this section into a request and fill in what you know. Unknown values can be marked `use a sensible default`.

```md
Character key: huntress
Display name: Huntress
Short description: use a sensible default
Is the character free or locked? locked
Unlock price: 50 gems

Base health: 5500
Base attack damage: 3000 (1000 per arrow)
Ammo capacity: 3
Ammo cooldown: 1000 ms
Ammo reload time: 1000 ms

Basic attack name: use a sensible default
Basic attack behavior: Fires 3 arrows in a slight spread dealing damage on impact. Arrows do not go through enemies or walls.
Projectile or hitbox asset: /assets/huntress/arrow.webp
Projectile speed: use a sensible default
Projectile range: use a sensible default
Projectile collision size: use a sensible default
Can aim freely, horizontally only, or fixed direction? freely
Windup/cast delay: 100ms
Hit behavior: Damage on hit, projectile embeds itself in the target for 2s, no bouncing or piercing.
Recticle: Arced (similar to thorg. I am forgetting the exact name). But it has more range and less restriction than thorgs recticle

Special name: use a sensible default
Special behavior: fires 6 burning arrows in a wider spread that deal more damage and apply a burn effect and tick damage over 5 seconds. Arrows do not go through enemies or walls. If it hits the ground, it burns the ground.
Special charge hits: 3
Special charge damage requirement: 6000
Special damage or effect: 1500 damage per arrow, burn for 500 damage over 5 seconds
Special duration/range/radius: use a sensible default

Sprite scale: use a sensible default based on other characters. Make it a little larger than ninja
Body hitbox width/height adjustments: use a sensible default
Body hitbox offsets: use a sensible default
Required animation names: idle, running, jumping, falling, attack, dead, special (use same animation as attack for special)
Asset folder contents: body.webp, spritesheet.webp, animations.json, arrow.webp
Sound effects: attack.mp3, hit.mp3, special.mp3, burn-tick.mp3

Skins: None
Profile icon: /assets/profile-icons/huntress.webp
Any constraints, references, or examples:
```

## Minimum Information Needed

These are the details required before a new character can be added cleanly.

1. `character key`: lowercase id used in code and asset paths, such as `hunter`.
2. `display name`: player-facing name, such as `Hunter`.
3. `role and description`: one sentence for the selection UI/profile surfaces.
4. `unlock state`: whether the character is free or locked, plus gem price if locked.
5. `combat stats`: base health, base damage, ammo capacity, ammo cooldown, ammo reload time.
6. `basic attack`: behavior, damage source, aim style, range, speed, startup/windup, hit size, and whether it is server-authoritative.
7. `special`: behavior, charge rules, effect duration, damage, targeting, visuals, and sounds.
8. `art assets`: sprite atlas, animation JSON, body/portrait image, projectile image, and optional VFX atlases.
9. `audio assets`: attack, hit, special, projectile impact, and any loop/tick sounds.
10. `hitbox tuning`: sprite scale, body shrink values, body offset values, and any flip offset.

## Implementation Checklist

When the information above is available, add the character in this order.

1. Add a stats/tuning entry in `src/lib/characterStats.js`.
2. Create `src/characters/<character-key>/constructor.js`.
3. Create `src/characters/<character-key>/anim.js`.
4. Create `src/characters/<character-key>/attack.js`.
5. Create `src/characters/<character-key>/special.js`.
6. Add optional `src/characters/<character-key>/effects.js` only if the character needs persistent per-player visuals.
7. Register the constructor in `src/characters/manifest.js`.
8. Register the special module in `src/characters/special.js`.
9. Add the default skin entry in `src/shared/skinsCatalog.json`.
10. Add profile icon assets/catalog entries if the character should appear outside the skin picker.
11. Add or update server attack descriptors in `src/shared/attackDescriptors.json`.
12. Add descriptor resolver tuning in `src/server/core/gameRoom/attackDescriptorResolver.js` if the server needs values from character tuning.
13. Build and manually verify selection, spawn, basic attack, special, remote rendering, damage, death, and missing asset warnings.

## Projectile Attack Notes

For a simple straight arrow, use the existing wizard fireball pattern as the closest match:

1. Client sends a windup action and a release action.
2. Server owns damage through an `attackDescriptors.json` entry with `runtime.kind: "projectile-linear"`.
3. Client renders local and remote arrow visuals in the character attack module.
4. Runtime tuning should live in `characterStats.<key>.tuning.attack.<attackKey>`.
5. Server resolver should merge speed, range, collision size, offsets, and startup from tuning.

Use a returning projectile only if the attack comes back to the player, like ninja shuriken. Use `attached-rect`, `attached-cone`, or `path-rect` only for melee, cone, or thrown-arc attacks.

## Asset Requirements

Required character assets:

1. `public/assets/<key>/body.webp`
2. `public/assets/<key>/spritesheet.webp`
3. `public/assets/<key>/animations.json`

Recommended attack/sound assets:

1. Projectile image or atlas, such as `arrow.webp`.
2. Attack sound, such as `arrow-shot.mp3`.
3. Hit/impact sound, such as `arrow-hit.mp3`.
4. Character hit sound, such as `hit.mp3`.
5. Special sound, such as `special.mp3`.

If the final art is not ready, ask for them in the request but use the names they would be named as in the files. Don't attempt to create assets.

## Animation Expectations

The safest animation set is:

1. `idle`
2. `running`
3. `jumping`
4. `falling`
5. `throw` or `attack`
6. `hurt`
7. `dead`
8. `special`

Animation keys should be namespaced by the character setup code, such as `hunter-idle`, `hunter-running`, and `hunter-throw`.

## Balance Defaults

If you do not know the numbers yet, check other characters for reference and use these reasonable starting values for a ranged projectile character
