# Adding New Characters

Use this file when you want to add a playable character. It lists the exact information needed from design, art, audio, and balance so implementation can happen without repeated back-and-forth.

## Quick Request Template

Copy this section into a request and fill in what you know. Unknown values can be marked `use a sensible default`.

```md
Character key: gloop
Display name: Gloop
Short description: use a sensible default
Is the character free or locked? locked
Unlock price: 100

Base health: 7000
Base attack damage: 2000
Ammo capacity: 1
Ammo cooldown: 400
Ammo reload time: 1500 ms

Basic attack name: use a sensible default
Basic attack behavior: Throws a bouncing slime ball that damages and pierces through enemies. The slime ball bounces up to 2 times and dissappears on the third bounce or when it hits a wall. The slime ball slows eneimies hit by it by 30% for 2 seconds. It also lowers their jump height by 30% for 2 seconds. They get a blue slime slow effect on them. The slime ball also has a similar effect.
Projectile or hitbox asset: /assets/gloop/slimeball.webp
Projectile speed: use a sensible default (slower speed). Also have more horizontal velocity than vertical. It mostly does not lift up too much.
Projectile range: use a sensible default
Projectile collision size: use a sensible default
Can aim freely, horizontally only, or fixed direction? horizontally line rectile
Windup/cast delay: 300ms
Hit behavior: normal

Special name: use a sensible default
Special behavior: A hand comes out and pulls the enemy it catches to him. The hand travels outward and if it doesn't catch anyone in a certain range nothing happens. If it does, it pulls that person to them and they can't do anything while being pulled. Once they are pulled to gloop, they get slowed by 50%. The hand also has a visual effect of a blue slime trail. Have a nice blue effect trail for the hand.
Special charge hits: 6
Special charge damage requirement: 12000
Special damage or effect: Hand does 500 damage on hit
Special duration/range/radius: use a sensible default
Special asset: /asset/gloop/hand.webp

Sprite scale:
Body hitbox width/height adjustments: use a sensible default
Body hitbox offsets: use a sensible default
Required animation names: idle, running, jumping, falling, attack, dead, special
Asset folder contents: body.webp, spritesheet.webp, animations.json, slimeball.webp, hand.webp
Sound effects: attack.mp3, hit.mp3, special.mp3, pull.mp3

Skins:
Profile icon: None
Any constraints, references, or examples: The basic attack is constrained to not have any angles. It can only extedn straight left or right. The hand can go anywhere and through walls.
`` `

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
