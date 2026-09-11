# Bro Battles architecture

## Ownership and contracts

The browser uses Phaser, the server uses Express and Socket.IO, and persistent account/party state lives in MySQL. Keep socket events, HTTP responses, DOM identifiers, saved map schemas and gameplay tuning stable during structural changes.

Entry points assemble features. A feature owns its state and behavior; shared modules contain data and pure rules that can run in the browser, server or tests without Phaser, DOM or database dependencies. Explicit registries are preferred to directory scanning or a plugin framework.

## Content sources

| Content | Definition | Runtime integration |
| --- | --- | --- |
| Characters | `src/shared/characters/<key>.json`, registered in `index.js` alongside those files | Browser classes in `src/characters/manifest.js`; authoritative attacks and abilities under `src/server/core/gameRoom/` |
| Character progression/tuning access | `src/shared/characterStats.js`, `characterTuning.js` | Import the shared helpers directly; no forwarding modules |
| Character frames, duck cells, attack descriptors | Derived from character definitions | Exports from `characters/index.js` and rules in `ducking.js`; do not add parallel tables |
| Powerups | `src/shared/powerups.catalog.json` | `powerups.js` derives catalog exports and owns the shared pickup delay; `effectRules.js` shares modifiers with server callbacks and client prediction |
| Maps | Built-ins in `src/shared/maps/<id>.json`; saved overrides in `data/maps/` or `BB_MAP_DIR` | `mapDocument.js` validates; `maps/index.js` registers built-ins and derives catalog metadata |
| Modes | `src/shared/gameModes.catalog.json` | Server factories in `src/server/core/gameModes/index.js`; client factories/preloaders in `src/modes/index.js` |
| Shop items and cosmetics | `src/shared/shopCatalog.json`, `skinsCatalog.json`, `playerCardsCatalog.json`, `profileIconsCatalog.json` | Shop offers own prices; cosmetic catalogs own identity/assets. Commerce services validate and fulfill purchases |
| Terrain audio | `src/shared/terrainAudio.json` and each map's `metadata.terrain` | Shared movement-audio selection and preload helpers |

Registration of behavior remains explicit. A JSON file can configure an existing attack mechanism; a new mechanism still needs code, assets and tests.

## Browser domains

- `src/index.js` and `src/party.js` wire lobby/party flows. `src/lobby/` owns profile, trophy progression, character selection and join-request state. Controller factories receive their live data dependencies rather than importing entry-point state.
- `src/chat/` owns shared chat presentation and separate lobby/game controllers.
- `src/match/snapshotBuffer.js` owns interpolation, its defaults and the frame update entry point. `gameScene/movementAudio.js` owns footsteps, landing and duck sounds; `healthBarRenderer.js` owns bar drawing and batch updates.
- `src/game.js` wires scene lifecycle. `src/gameScene/`, `src/match/`, `src/hud/`, `src/powerups/` and `src/modes/` own their respective features.
- `src/player.js` coordinates the local entity. `src/players/wallMovement.js` owns wall contact/sliding, `localStateSync.js` applies authoritative stats and local movement/invisibility rules, and `RemotePlayer.js` owns the remote entity.
- `src/characters/<key>/` owns animation, attacks, specials and character presentation. `shared/animationBuilder.js` handles atlas selection and ordering; timing and deliberate pose ordering stay in character modules.
- `src/characters/networkRegistry.js` delegates optional character-specific protocol lifecycle. Ninja and Huntress currently use it. Protocol fields and trusted-contact rules remain explicit in their adapters.
- `src/maps/documentRuntime.js` builds map snapshots and stores runtime objects on their scene. Pass the scene to map queries. Scene shutdown clears that scene's references without deleting another scene's runtime for the same map ID.
- `public/styles/game.css` owns the formerly inline game-page styles. `src/styles/` contains styles imported by browser bundles; the public stylesheet keeps its original cascade position.

Import owning domains directly. Pass-through compatibility files have been removed; registries remain where they assemble definitions or dispatch behavior.

## Server domains

- `src/server/routes/` and `core/socketEvents/` adapt transport to `src/server/services/`. Keep database mutations and transaction rules in services.
- `src/server/core/gameRoom.js` coordinates room lifecycle and simulation. Its public methods delegate payload validation to `gameRoom/actionValidation.js`, socket registration to `playerTransport.js`, and hit processing to `damageResolver.js`.
- `gameRoom/characterAttackRegistry.js` maps attack runtime kinds to constructors and tick functions. `attackRuntimes/` groups linear/bouncing projectiles, melee, returning projectiles, hooks, shared geometry and target handling.
- `gameRoom/characterCombatRegistry.js` delegates Ninja/Huntress initialization, requests, ticks, bootstrap and disposal. Their protocol-specific engines own projectile trust and reconciliation. Huntress authoritative combat is always enabled; the old browser collision engine and rollout toggle are removed. Protocol version checks require stale clients to reload.
- `gameRoom/abilityRuntimeManager.js` selects character ability modules in `abilities/`. `effects/` owns timed effect application, stacking, expiry and snapshots.
- `core/gameModes/` owns authoritative victory/objective rules. Mode capability data controls client sudden-death behavior, and client mode factories own objective rendering/assets.
- `core/bots/` owns perception, navigation and tactics. Basic action identity comes from character definitions; aiming and special decisions can still be character-specific.

## Deliberate boundaries

The legacy JavaScript maps and in-match editor remain compatibility fallbacks. New maps use Map Studio documents and the authenticated map API, not new legacy modules. Legacy texture preloading is isolated in `src/maps/legacy/preloadAssets.js` and skipped when document textures are queued. See [Map Studio](MAP_EDITOR.md).

Effect modifiers stack multiplicatively through `src/shared/effectRules.js`. World snapshots retain numeric `playerEffects` durations and add `playerEffectMovement` with server-resolved movement, including per-application scaling and slows. Clients fall back to the shared base rules for older snapshots. Gravity Boots now use the server's 1.15 speed / 1.55 jump values; Rage and Thorg Rage retain their client speed boosts on the server too. This reconciles previously inconsistent gameplay, so movement and stacked effects need multiplayer checks.

Current map documents still model two teams and 1v1/2v2/3v3 variants, with Bank Bust-specific objective layout. Adding free-for-all, PvE waves or a new objective topology requires a deliberate schema/runtime change. Do not infer support from a catalog entry marked unimplemented.

Large orchestrators still contain lifecycle-sensitive code. Extract a further subsystem when it has clear ownership and a stable interface; do not create forwarding layers solely to reduce line counts.

## Validation and extension

Run `npm run validate:content`, relevant Node tests, then `npm test` and `npm run build` for cross-cutting changes. Content validation checks registered character data/assets, attack references/runtime kinds, powerup assets/effects, invalid body/reload values, duplicate cosmetic prices/movement tuning, shop offers and built-in map documents. It does not replace gameplay testing or the server's uploaded-map asset validation.

[Contributing](CONTRIBUTING.md) lists concrete extension steps; [Adding characters](ADDING_CHARACTERS.md) lists the design/art inputs.
