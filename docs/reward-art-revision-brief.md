# Pending card and skin revision

User direction, September 15, 2026:

- Player cards: near-black interiors with only very faint themed pixel motifs. No scenery, throne rooms, landscapes, bright interior lighting, or detailed backdrops behind text. Keep frames and decoration visibly pixel art with a consistent pixel grid and restrained palette.
- Ninja Arena Sovereign: replace the rejected fuzzy atlas. Strong royal silhouette, recognizable crown, royal cape and restrained gold trim; preserve Ninja identity. No orange armor. Crisp deliberate pixel clusters at the original animation resolution.
- Gloop Amethyst: replace the rejected fuzzy atlas with clear crystalline facets, luminous cyan/violet highlights, and a readable slime silhouette. Avoid soft painted glow baked into the body.
- Generate portraits from the final approved idle frames so the body and playable skin match. Check every animation against the existing frame bounds and verify at native size and nearest-neighbor enlargement in the game.

Status: replaced using the built-in AI image-generation model on September 15, 2026. The earlier scripted recolors are superseded. Original AI PNG outputs live alongside their corresponding player-card and character assets as `*-ai-source.png` or `ai-source.png`. `scripts/import-ai-trophy-art.cjs` imports these outputs, packs frames into the existing atlas dimensions using nearest-neighbor scaling, and extracts matching idle portraits. Asset tests pass; in-game animation playback still requires visual review.

## AI prompt set

- Arena Crown: regenerate the reference portrait card as crisp, limited-palette 16-bit pixel art; gold crown, cyan jewel accents, slim royal border; opaque near-black navy interior with the central 70% empty for text, extremely faint edge accents; transparent exterior; no scenery, text, painted shading or fuzziness.
- Slime Circuit: regenerate the reference portrait card as square-cluster pixel art; charcoal frame, restrained emerald slime accents, friendly slime emblem; near-black interior with faint circuit fragments at edges and an empty center; transparent exterior; no scenery or text.
- Ninja Arena Sovereign: redesign every reference atlas pose into a consistent masked royal Ninja, navy suit, three-point gold crown with blue jewel, purple cape, ivory ermine collar, restrained gold edging and steel boots/gloves; preserve the populated cells and poses; crisp pixel clusters; transparent background; no orange armor, painted texture or labels.
- Gloop Amethyst: regenerate each reference pose as a crystalline slime with angular amethyst/violet facets, cyan highlights and a friendly face; preserve squash, stretch, attack poses and cell placement; transparent background without the original strips/rectangles; crisp pixel clusters, no airbrushed glow or labels.
