# Adding New Characters

Use this file when you want to add a playable character. It lists the exact information needed from design, art, audio, and balance so implementation can happen without repeated back-and-forth.

## Quick Request Template

Copy this section into a request and fill in what you know. Unknown values can be marked `use a sensible default`.

```md
Character key:
Display name:
Short description:
Is the character free or locked?
Unlock price:

Base health:
Base attack damage:
Ammo capacity:
Ammo cooldown:
Ammo reload time:

Basic attack name:
Basic attack behavior:
Projectile or hitbox asset:
Projectile speed:
Projectile range:
Projectile collision size:
Can aim freely, horizontally only, or fixed direction?
Windup/cast delay:
Hit behavior:

Special name:
Special behavior:
Special charge hits:
Special charge damage requirement:
Special damage or effect:
Special duration/range/radius:

Sprite scale:
Body hitbox width/height adjustments:
Body hitbox offsets:
Required animation names:
Asset folder contents:
Sound effects:

Skins:
Profile icon:
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

## Balance Defaults

If you do not know the numbers yet, check other characters for reference and use these reasonable starting values for a ranged projectile character
