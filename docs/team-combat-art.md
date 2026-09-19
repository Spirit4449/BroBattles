# Team combat presentation

Team membership is viewer-relative: green for the local player and allies, red for opponents. Affiliation is stored on each actor and copied to released attacks so presentation survives the shooter dying. Health bars have a visible team outline with a layered halo; player rings and drop shadows are removed.

Each attack has its own art treatment. There is no universal red filter.

- Ninja retains the original shuriken and white trail, with green/red spark stars. The king's crown stays gold; only ally gemstones become blue, including the eight spin frames and legacy trails. Enemy crown artwork retains its red jewels.
- Thorg uses an 18% green/red shade on neutral weapon material, preserving saturated skin colors and equipment detail.
- Huntress uses stepped green/red flame particles for every arrow. Enemy arrowheads alone get a coral tint. Burning arrows retain larger flames and smoke.
- Wizard uses separate generated cyan and coral/ivory fireball atlases and matching particle palettes, with the same launch and flight frame names and unchanged combat timing.
- Gloop uses a deliberate cherry/coral ramp with cream highlights and raspberry shadows. Amethyst preserves purple interiors and crystal facets, adding ruby edges and droplets for opponents.
- Draven has separate friendly/enemy explosion and special atlases. The revised special preserves the original pale reaching lightning ribbons, violet/coral center, gold details and scattered sparks, instead of the rejected tidy starburst. Its original additive blending and surrounding effects remain. Enemy inferno particles and explosions follow the shooter’s affiliation.

## Installed generated art

All six assets were generated with the built-in image-generation tool using the original attack sheets as concept references and the live Wizard/Draven portraits as BB style references.

| Family | Friendly | Enemy |
| --- | --- | --- |
| Wizard | `public/assets/wizard/fireball-bb.webp` | `public/assets/wizard/fireball-bb-red.webp` |
| Draven explosion | `public/assets/draven/explosion-bb.webp` | `public/assets/draven/explosion-bb-red.webp` |
| Draven special | `public/assets/draven/special-bb.webp` | `public/assets/draven/special-bb-red.webp` |

Each WebP has a matching JSON atlas. Original source assets remain available. Generated RGBA masters and exact final prompts are saved in `output/team-combat-art/manifest.json` and the adjacent `*-source.png` files. `scripts/pack-team-combat-art.py` performs mechanical cell extraction and nearest-neighbor packing with Pillow, retaining genuine alpha. The wizard uses 32 named cells: four ignition drawings held across 16 startup cells, then 12 looping drawings sampled across 16 flight cells. Draven explosion has 12 frames and special has 16.

## Review

`output/team-combat-art/preview.html` is a dedicated Canvas-renderer comparison using the actual health bar, material selection, Ninja trail, Huntress flames, and Gloop renderer. `canvas-preview.png` captures the final artwork. This is a rendering preview, not a completed multiplayer match.

## Readability and impact refinement

Draven super cells are now 288×288, packed directly from full-resolution generated masters with 32px total size allowance for margins. Rendering compensates by 72/frameWidth to retain the existing world size. Enemy bars use deeper red fill/halo; the local bar alone has a pale green-white rim and top highlight. Gloop enemy centers use saturated bright scarlet, retaining a brighter purple/ruby interior for Amethyst. Remote Draven casts no longer schedule a caster-position explosion; authoritative hits display the effect immediately from frame 3, at 1.85 scale, with alpha rising from 0.18 to 0.78 over 55ms.
