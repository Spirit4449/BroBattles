# Bro Battles architecture

## Ownership and contracts

The browser uses Phaser, the server uses Express and Socket.IO, and persistent account/party state lives in MySQL. Human movement is client-simulated with server bounds and dash collision checks; combat outcomes and bot simulation are server-owned. Keep socket events, HTTP responses, DOM identifiers, saved map schemas and gameplay tuning stable during structural changes.

Entry points assemble features. A feature owns its state and behavior; shared modules contain data and pure rules that can run in the browser, server or tests without Phaser, DOM or database dependencies. Explicit registries are preferred to directory scanning or a plugin framework.

## Folder layout

```
src/
  client/            browser code (bundled by webpack)
    pages/           one entry per HTML page: lobby, game, login, signup, profile, admin, mapEditor
    game/            everything that runs during a battle
      scene/         Phaser scene helpers: camera, input, rendering, effects, in-match editor
      audio/         battle sound: player, movement, match music
      characters/    per-character animation, attacks, specials (+ shared/ helpers)
      players/       local and remote player entities and movement
      match/         match networking: snapshots, server clock, roster
      hud/ powerups/ modes/ maps/
    lobby/           lobby shell (background, hints, reveal, preload)
      party/         party roster, slots, bots, join requests, settings
      matchmaking/   queue client and overlay
      profile/       profile, trophies, character select, skins, leaderboard
      shop/
    chat/ friends/   social panels shared by lobby and game
    site/            site shell, preferences, key bindings, support
    navigation/      page transitions and lobby music
    editor/          Map Studio internals (entry is pages/mapEditor.js)
    account/         account and email settings UI
    ui/              generic widgets: toasts, confirm, popups, sounds, fullscreen
    views/           reusable renderers and asset URLs (badges, cards, portraits, rewards)
    lib/             non-UI utilities: socket, cookies, selection catalog, net logging
    styles/          CSS imported by bundles
  server/
    server.js        Express + Socket.IO bootstrap
    core/            live game runtime: gameRoom/, bots/, gameModes/, matchmaking/, socket events
    routes/          routes.js registers routes/modules/*
    services/<domain>/  auth, party, cosmetics, shop, trophies, email, moderation,
                     maps, site, social, match (business logic and DB access)
    middleware/ jobs/ lib/ (catalog loader, request windows, runtime config)
  shared/            data and pure rules used by browser, server and tests
    characters/      character JSON, stats, tuning, projectile/hitbox geometry
    physics/         movement, dash, ducking, collision, spawn placement
    maps/            built-in map documents and map schema
    catalogs/        cosmetics, shop, powerups, modes and trophy catalogs
    site/            site config and server-rendered HTML helpers
```

## Content sources

| Content | Definition | Runtime integration |
| --- | --- | --- |
| Characters | `src/shared/characters/<key>.json`, registered in `index.js` alongside those files | Browser classes in `src/client/game/characters/manifest.js`; authoritative attacks and abilities under `src/server/core/gameRoom/` |
| Character progression/tuning access | `src/shared/characters/characterStats.js`, `characterTuning.js` | Import the shared helpers directly; no forwarding modules. Use `DEFAULT_CHARACTER`/`resolveCharacterKey()` for missing or stored character keys rather than a `"ninja"` literal |
| Bot play style per character | `src/server/core/bots/characterProfiles.js` | One profile per character: spacing, melee/buff flags, aim model, super range and super decision. Content validation requires a profile for every registered character |
| Character frames, duck cells, attack descriptors | Derived from character definitions | Exports from `characters/index.js` and rules in `ducking.js`; do not add parallel tables |
| Powerups | `src/shared/catalogs/powerups.catalog.json` | `powerups.js` derives catalog exports and owns the shared pickup delay; `effectRules.js` shares modifiers with server callbacks and client prediction |
| Maps | Built-ins in `src/shared/maps/<id>.json`; saved overrides in `data/maps/` or `BB_MAP_DIR` | `mapDocument.js` validates; `maps/index.js` registers built-ins and derives catalog metadata |
| Modes | `src/shared/catalogs/gameModes.catalog.json` | Server factories in `src/server/core/gameModes/index.js`; client factories/preloaders in `src/client/game/modes/index.js` |
| Shop items and cosmetics | `src/shared/catalogs/shopCatalog.json`, `skinsCatalog.json`, `playerCardsCatalog.json`, `profileIconsCatalog.json` | Shop offers own prices; cosmetic catalogs own identity/assets. Commerce services validate and fulfill purchases |
| Terrain audio | `src/shared/physics/terrainAudio.json` and each map's `metadata.terrain` | Shared movement-audio selection and preload helpers |

Registration of behavior remains explicit. A JSON file can configure an existing attack mechanism; a new mechanism still needs code, assets and tests.

## Browser domains

- `src/client/pages/lobby.js` and `src/client/lobby/party/party.js` wire lobby/party flows. `src/client/lobby/profile/` owns profile, trophy progression and character selection; `lobby/party/` owns join-request state. `lobby/matchmaking/matchmakingClient.mjs` owns the matchmaking session (queue context, roster preview, found-match lock, ready-ack and queue-health timers, post-battle suppression) and its queue/match socket handlers; `lobby/matchmaking/matchmakingOverlay.js` only renders the overlay. `lobby/lobbyBackground.js` owns the backdrop cross-fade. `party.js` must not import `pages/lobby.js`. Controller factories receive their live data dependencies rather than importing entry-point state.
- `src/client/chat/` owns shared chat presentation and separate lobby/game controllers.
- `src/client/game/match/snapshotBuffer.js` owns interpolation, its defaults and the frame update entry point. `game/audio/movementAudio.js` owns footsteps, landing and duck sounds; `game/scene/healthBarRenderer.js` owns bar drawing and batch updates.
- `src/client/pages/game.js` wires scene lifecycle. `src/client/game/scene/`, `src/client/game/match/`, `src/client/game/hud/`, `src/client/game/powerups/` and `src/client/game/modes/` own their respective features.
- `src/client/game/players/localPlayer.js` coordinates the local entity. `handlePlayerMovement` is an ordered per-frame pipeline of named steps (input gating, dash, physics limits, input, control locks, actions, ducking, horizontal motion, jumps, wall slide, airborne state, presentation, replicated input); keep that order when adding a step. `src/client/game/players/localMovementAudio.js` owns footsteps and the wall-slide/falling-air loops, `localMovementFx.js` owns landing/dust/trail/turn effects and their timers, `wallMovement.js` owns wall contact/sliding, `localStateSync.js` applies authoritative stats and local movement/invisibility rules, and `RemotePlayer.js` owns the remote entity.
- `src/client/game/characters/<key>/` owns animation, attacks, specials and character presentation. `shared/animationBuilder.js` handles atlas selection and ordering; timing and deliberate pose ordering stay in character modules.
- `shared/characterEntityBase.js` documents the class hooks generic code calls instead of checking character names: `attackFlow`/`emitAttackAction` (basic attack timing), `handleRemoteAttack`/`handleLocalAuthoritativeAttack`, `handleActionTargetingLocalPlayer` (e.g. Gloop's hook pull), `socketEvents` (e.g. Wizard's arcane surge), `updateMovementLock` (e.g. Draven's Inferno hover), `setupSkinAnimations`, and the powerup visuals. `loadBaseAtlas`/`loadFiles` cover standard preloading; `getStats` derives from `key`. `shared/packetDedupe.js` and `shared/powerupFx.js` hold shared presentation helpers.
- Client presentation settings live in the character definition's `presentation` block (`hiResArt`, `specialAnimationLockMs`, `abilityLockAnimation`); aim/reticle behaviour lives in its `aim` blocks (`trajectory`, `reticleRoundCorners`, `reticleEndAlpha`, `reticleFadeOnTurn`, `scalesWithSprite`, `reticleScaleLiftY`). Skin-only runtime assets and animation overrides live in the skin catalog's `gameAssets` (`weaponSpin`, `animationOverrides`).
- `src/client/game/characters/networkRegistry.js` delegates optional character-specific protocol lifecycle. Ninja and Huntress currently use it. Protocol fields and trusted-contact rules remain explicit in their adapters.
- `src/client/game/maps/documentRuntime.js` builds map snapshots and stores runtime objects on their scene. Pass the scene to map queries. Scene shutdown clears that scene's references without deleting another scene's runtime for the same map ID.
- `public/styles/game.css` owns the formerly inline game-page styles. `src/client/styles/` contains styles imported by browser bundles; the public stylesheet keeps its original cascade position.

Import owning domains directly. Pass-through compatibility files have been removed; registries remain where they assemble definitions or dispatch behavior.

## Server domains

- `src/server/routes/` and `core/socketEvents/` adapt transport to `src/server/services/<domain>/`. Keep database mutations and transaction rules in services; there is no separate helpers layer, so put domain logic in its domain folder and only generic utilities in `src/server/lib/`.
- `src/server/core/gameRoom/index.js` coordinates room lifecycle and simulation. Its public methods delegate payload validation to `gameRoom/actionValidation.js`, socket registration to `playerTransport.js`, and hit processing to `damageResolver.js`.
- `gameRoom/characterAttackRegistry.js` maps attack runtime kinds to constructors and tick functions. `attackRuntimes/` groups linear/bouncing projectiles, melee, returning projectiles, hooks, shared geometry and target handling.
- `gameRoom/characterCombatRegistry.js` delegates Ninja/Huntress initialization, requests, ticks, bootstrap and disposal. Their protocol-specific engines own projectile trust and reconciliation. Huntress authoritative combat is always enabled; the old browser collision engine and rollout toggle are removed. Protocol version checks require stale clients to reload.
- `gameRoom/abilityRuntimeManager.js` selects character ability modules in `abilities/`. `effects/` owns timed effect application, stacking, expiry and snapshots.
- `core/gameModes/` owns authoritative victory/objective rules. Mode capability data controls client sudden-death behavior, and client mode factories own objective rendering/assets.
- `core/bots/` owns perception, navigation and tactics. Basic action identity comes from character definitions; per-character play style lives only in `bots/characterProfiles.js`. Bot modules read profile fields instead of comparing `char_class` strings; protocol-specific helpers such as `startNinjaSwarm` remain explicit.

## Deliberate boundaries

Every map, including the four built-ins in `src/shared/maps/*.json`, is a Map Studio document; `src/client/game/maps/manifest.js` only answers queries over those documents. The legacy JavaScript map modules and their texture preloader have been removed. The in-match editor remains a compatibility tool. New maps use Map Studio and the authenticated map API. See [Map Studio](maps.md).

Effect modifiers stack multiplicatively through `src/shared/effectRules.js`. World snapshots retain numeric `playerEffects` durations and add `playerEffectMovement` with server-resolved movement, including per-application scaling and slows. Clients fall back to the shared base rules for older snapshots. Gravity Boots now use the server's 1.15 speed / 1.55 jump values; Rage and Thorg Rage retain their client speed boosts on the server too. This reconciles previously inconsistent gameplay, so movement and stacked effects need multiplayer checks.

Current map documents still model two teams and 1v1/2v2/3v3 variants, with Bank Bust-specific objective layout. Adding free-for-all, PvE waves or a new objective topology requires a deliberate schema/runtime change. Do not infer support from a catalog entry marked unimplemented.

Large orchestrators still contain lifecycle-sensitive code. Extract a further subsystem when it has clear ownership and a stable interface; do not create forwarding layers solely to reduce line counts.

## Validation and extension

Run `npm run validate:content`, relevant Node tests, then `npm test` and `npm run build` for cross-cutting changes. Content validation checks registered character data/assets, attack references/runtime kinds, powerup assets/effects, invalid body/reload values, duplicate cosmetic prices/movement tuning, shop offers and built-in map documents. It does not replace gameplay testing or the server's uploaded-map asset validation.

[Contributing](contributing.md) lists concrete extension steps; The character brief in that guide lists design/art inputs.
