# Contributing

Read [Architecture](ARCHITECTURE_MAP.md) before changing ownership. Preserve socket/HTTP contracts, DOM identifiers, database schemas and tuning unless the feature explicitly requires a migration.

## Local workflow

```bash
npm install
npm run dev
npm run validate:content
npm test
npm run build
```

Use a focused test file during development, for example `node --test tests/contentContracts.test.js`. The full suite includes bot simulations and may take longer. Database and environment setup are in `README.md` and `database.md`.

## Add a character

1. Create `src/shared/characters/<key>.json` using an existing character as a shape reference. Include `key`, `stats` (including `tuning`), `frame`, one-based `duckFrame` cell, `basicAction`, `basicHitTypes`, `specialHitTypes`, and `attacks`. These hit-type lists control super charging; distinguish the emitted action ID from its damage hit type.
2. Register the definition in `src/shared/characters/index.js`. Stats, frame dimensions, duck cells, attack descriptors and bot basic-action IDs are derived. Import shared helpers directly; do not create another stats/frame table.
3. Add browser behavior in `src/characters/<key>/` and register its constructor in `src/characters/manifest.js`. Use the existing character entity base and animation builder where their behavior fits. Keep unique attack choreography in that character's modules.
4. Put runtime assets in `public/assets/<key>/`. The validator expects `body.webp`, `spritesheet.webp` and `animations.json`. Register weapon/audio/effect files in the character preloader; confirm their names and paths. The roster preloader loads participating characters and selected skins.
5. Configure an existing authoritative attack runtime through the definition's `attacks`. If it needs tuning-to-runtime translation, add that mapping in `attackDescriptorResolver.js`. A genuinely new attack mechanism gets a module under `gameRoom/attackRuntimes/` and a registry entry in `characterAttackRegistry.js`.
6. For an ordinary server special, add an ability module and register it in `abilityRuntimeManager.js`. A specialized network protocol may instead require adapters in the client `characters/networkRegistry.js` and server `gameRoom/characterCombatRegistry.js`. Preserve validation and server ownership; adapters alone do not establish trusted damage.
7. Check bot aiming, ranges and special conditions in `src/server/core/bots/`. Shared action registration does not automatically teach bots a novel mechanic.

Run content validation and attack/ability/network tests. Manually check selection, local and remote attacks, special charging, hit/death animations, skins and missing asset warnings. [Adding characters](ADDING_CHARACTERS.md) is the design/art checklist.

## Add or edit a map

Use [Map Studio](MAP_EDITOR.md) or the authenticated map API. Export/clone a schema-version-1 document, give a new map a unique ID, edit metadata/assets/layout/spawns/powerups and validate every variant before saving. Saved overrides are discovered by the lobby catalog and snapshotted for new matches.

For a built-in map shipped with the repository, add `src/shared/maps/<id>.json` and register it in `src/shared/maps/index.js`. That registry also derives the default catalog. Saved overrides take precedence over built-ins, so update a live override through Map Studio/API rather than expecting edits to defaults to replace it.

Do not add a legacy JavaScript map module, dropdown option, map-specific preload branch or powerup coordinate table. Documents own those values. Pass the owning scene into runtime map queries; do not retain map objects after scene shutdown.

Test the document and asset validation, all supported spawn formations, powerup placement, boundaries, collisions, objective layout and an isolated editor playtest. `node --test tests/mapEditor*.test.js tests/mapDocumentRuntime.test.js` covers the document workflow.

## Add a mode

1. Add its descriptor, supported variants and capabilities to `src/shared/gameModes.catalog.json`. Keep it unimplemented/nonqueueable until the runtime works.
2. Implement the server mode under `src/server/core/gameModes/` and register its `runtimeClass` factory in `index.js` there.
3. If it needs client rendering or assets, add `src/modes/<mode>/` and register its factory/preloader in `src/modes/index.js`. Set `capabilities.suddenDeath` explicitly for the intended poison behavior.
4. Add compatible map metadata and objective data, and teach bots the objective behavior when bots are supported.

The existing map schema supports two teams with 1–3 players per team. Free-for-all, PvE and different objective layouts need schema, matchmaking, spawn, victory and HUD work. A mode catalog entry alone does not provide these capabilities.

## Add a powerup or timed effect

1. Add a powerup entry in `src/shared/powerups.catalog.json` with asset directory, color, duration, tick volume and applicable modifiers. Client/server type lists, durations and asset mappings are derived.
2. Add its authoritative effect definition in `src/server/core/gameRoom/effects/effectDefs.js`, using the shared duration/modifiers and the existing effect-manager lifecycle. Custom callbacks belong here, not in the content JSON.
3. Add `icon.webp`, `touch.mp3` and `tick.mp3` in `public/assets/powerups/<assetDir>/`. The loader supports alternate sound formats, but update the validator if intentionally changing the standard asset contract.
4. Configure movement through shared `modifiers`. For ability-owned effects, derive rules in `src/shared/effectRules.js` from the character tuning. Server snapshots carry the final movement values to clients, including scaling and custom slow parameters; do not add a separate client multiplier or priority table.
5. Add custom visual behavior to the powerup renderer or character effect hooks only when the default presentation is insufficient. Gameplay movement belongs in shared rules/local-effect control, not rendering.

An ability-only effect needs an effect definition and its snapshot/presentation integration; it does not need a collectible powerup catalog entry. Check application, stacking, expiry, death/respawn cleanup and local/remote visibility.

## Add items, skins, animation or other assets

- Offers, skins, profile icons and player cards use their existing shared catalogs. Set cosmetic prices only on offers in `shopCatalog.json`; cosmetic catalogs hold identity/assets, not duplicate prices. Character unlock prices belong in the character definition and upgrade costs in `characterStats.js`. Add content there and reuse commerce services; do not duplicate purchase routes or currency mutation logic. A new reward type needs an explicit server fulfillment implementation and transaction tests.
- Animation frame selection/sorting uses `src/characters/shared/animationBuilder.js`. Keep timing, repeats and deliberate pose order in each character's `anim.js`. Check any new animation against the actual atlas, including skin variants.
- Map artwork is declared in the map document's asset library. Terrain audio is declared in `src/shared/terrainAudio.json`, selected by `metadata.terrain`.
- Runtime assets belong under `public/assets/` in the owning content folder. Keep source artwork, intermediate exports and licensing information clearly named; avoid moving an asset until its runtime/catalog references are checked.

## Module boundaries

Keep feature constants, defaults and small helpers in the module that owns their behavior. For example, pickup delay belongs in `shared/powerups.js`, snapshot defaults in `match/snapshotBuffer.js`, and duck sounds in `gameScene/movementAudio.js`. Extract a file when it establishes a reusable rule, independent lifecycle or clear content boundary; do not create one file per constant or callback. Keep browser/server dependency boundaries intact when consolidating.

## Review checklist

- Does each new module own a coherent behavior or state lifecycle?
- Can another content addition reuse the existing rules with a definition/registration change?
- Are imports directed toward the owning domain, without entry-point cycles?
- Are public contracts and gameplay values preserved?
- Do content validation, relevant tests and the build pass? Record any baseline failures and actual manual checks; do not weaken tests to hide a refactor regression.
