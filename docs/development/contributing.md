# Contributing

Read [Architecture](architecture.md) before changing ownership. Preserve socket/HTTP contracts, DOM identifiers, database schemas and tuning unless the feature explicitly requires a migration.

## Local workflow

```bash
nvm use
npm ci
npm run dev
```

Use the Node version in `.nvmrc`. If the development server is already running on port 3002, reuse it.

Database and environment setup are in the [root README](../../README.md) and [database guide](../operations/database.md).

CI runs the linter, default tests, generated constants check, content validation and production build on the Node version in `.nvmrc`. It also checks that Map Studio publications stay outside Git. The bug-catching ESLint rules report warnings while existing findings are cleaned up.

Each successful production build protects its current bundles and prunes earlier versions. Development prunes after its first successful compilation and protects bundles referenced by on-disk HTML. Both keep the five newest versions of each bundle and any versions less than a day old. Use `npm run cleanbuild` for a full cleanup.

The server loads webpack and its development middleware only when `NODE_ENV` is outside production. Build assets with all dependencies installed. To serve a prebuilt `dist/` with a production-only install, use `npm ci --omit=dev` and run `NODE_ENV=production node src/server/server.js`.

## Testing

Tests use the built-in `node --test` runner. There is no test framework to install.

| Command | Runs | When |
| --- | --- | --- |
| `node --test tests/<file>.test.js` | One file | While iterating on a change |
| `npm run test:<area>` | Focused group: `network`, `bots`, `shop`, `trophies`, `battle-log` | Changes inside that area |
| `npm test` | Top-level `tests/*.test.{js,cjs,mjs}` | Once after completing a code change |
| `npm run test:slow` | `tests/slow/`: exhaustive bot movement sweeps over every character and Duel map, plus Bank Bust routes | Changes to bot navigation, bot movement, bot physics, map geometry or spawns |
| `npm run test:all` | Default suite plus `tests/slow/` | When both suites are needed under the rules above |
| `npm run test:db` | MySQL integration scripts | Only when requested, with a configured database |

Skip tests for docs, art and copy that no test reads. Run `npm run validate:content` after changing characters, maps, catalogs or assets. Run `npm run build` after changing client entry points, Webpack configuration or HTML.

Start with the focused files below. Use `rg -l '<module name>' tests/` to find other callers and fixtures.

| Code area | Focused tests under `tests/` |
| --- | --- |
| Character definitions, combat runtimes and showcase parity | `contentContracts.test.js`, `profileCharacters.test.js`, `attackDelivery.test.js`, `lagCompensation.test.js` and the character's combat tests |
| Map documents, editor and scene map runtime | `mapEditor.test.js`, `mapRuntime.test.js` |
| Room startup, Bank Bust economy and results | `gameRoomStartup.test.js`, `bankBustEconomy.test.js`, `battleLog.test.js` |
| Powerup contacts, application and modifiers | `powerups.test.js`, `pickupTiming.test.js`, `effectMovement.test.js` |
| Bot perception, tactics, aiming and objectives | `botBehavior.test.js`, `botAiming.test.js`, `botObjectives.test.js`, `botTeamwork.test.js` |
| Bot navigation and worker integration | `navigation.test.js`, `navigationService.test.js`, `botDashNavigation.test.js` |
| Socket party and presence handlers, chat and friends | `partyReadiness.test.js`, `chatRegression.test.js`, `friendPresence.test.mjs`, `friendPrivacy.test.js` |
| Match wire format, timing and snapshots | `networkTiming.test.mjs`, `snapshotDelta.test.js`, `serverClockAndHistory.test.js` |
| HTTP route behavior and guards | `cosmeticRoutes.test.js`, `admin.test.js`, `upgradeRateLimit.test.js`, `productionHardening.test.js` |
| Shop catalog, presentation, fulfillment and Stripe | `shopCatalog.test.js`, `shopPresentation.test.js`, `shopCommerce.test.js`, `stripeWebhook.test.js` |
| Navigation lifecycle, lobby readiness and built pages | `pageScope.test.mjs`, `lobbyReadyUi.test.js`, `pageRuntimeBuild.test.js` |

Writing tests:

- Test behavior by calling real modules. Load complete client modules through `tests/helpers/clientModule.js`; do not extract private functions from source strings or strip imports/exports with regular expressions. Stub browser, network, media or rendering boundaries while keeping the behavior under test real.
- Do not assert on source or CSS text (regular expressions over a file's contents), and do not pin tuning constants to literal numbers. Both break on harmless edits and were removed in the October 2026 test trim.
- Extend the existing file for a feature instead of adding a new file for one regression. Each file is a separate process.
- Put anything that takes more than about a second in `tests/slow/`. It is excluded from `npm test`.
- Match a dependency's exact import specifier when a fixture intercepts `require`. Load the real dependency for behavior the test covers.

### Test fixtures

- `tests/helpers/botRoom.js` builds a headless room with bots.
- `tests/helpers/clientModule.js` compiles browser modules and resolves real relative dependencies in an isolated VM.
- `tests/helpers/browserFixture.js` supplies a LinkeDOM DOM and explicit browser boundaries. `lobbyFixture.js` loads the actual lobby template.
- `tests/helpers/localPlayerFixture.js` initializes the player controller and Arcade body with rendering doubles.
- Use the Playwright harnesses in `tests/browser/` for real browser layout, rendering and playback. See the [local scripts guide](../../scripts/README.md).

## Add a character

1. Create `src/shared/characters/<key>.json` using an existing character as a shape reference. Include `key`, `stats` (including `tuning`), `frame`, one-based `duckFrame` cell, `basicAction`, `basicHitTypes`, `specialHitTypes`, and `attacks`. These hit-type lists control super charging; distinguish the emitted action ID from its damage hit type.
2. Register the definition in `src/shared/characters/index.js`. Stats, frame dimensions, duck cells, attack descriptors and bot basic-action IDs are derived. Import shared helpers directly; do not create another stats/frame table.
3. Add browser behavior in `src/client/game/characters/<key>/` and register its constructor in `src/client/game/characters/manifest.js`. Extend `CharacterEntityBase`: declare `key`, `sounds`, `attackFlow`, `performSpecial({ scene, player, isOwner, aim })` and a `preload` built from `loadBaseAtlas`/`loadFiles`, then override only the hooks the kit needs (listed at the top of `characterEntityBase.js`). Put presentation settings in the definition's `presentation` and `aim` blocks rather than adding `character === "<key>"` checks to player, reticle or match code. Keep unique attack choreography in that character's modules.
4. Put runtime assets in `public/assets/<key>/`. The validator expects `body.webp`, `spritesheet.webp` and `animations.json`. Register weapon/audio/effect files in the character preloader; confirm their names and paths. The roster preloader loads participating characters and selected skins.
5. Configure an existing authoritative attack runtime through the definition's `attacks`. If it needs tuning-to-runtime translation, add that mapping in `attackDescriptorResolver.js`. A genuinely new attack mechanism gets a module under `shared/combat/runtime/attackRuntimes/` and a registry entry in `characterAttackRegistry.js`.
6. For an ordinary server special, add a module under `src/shared/combat/runtime/abilities/` and register it in that runtime’s `abilityRuntimeManager.js`. A specialized network protocol may instead require adapters in the client `characters/networkRegistry.js` and server `shared/combat/runtime/characterCombatRegistry.js`. Preserve validation and server ownership; adapters alone do not establish trusted damage.
7. Add a bot profile in `src/shared/combat/characterProfiles.js` (spacing, melee/buff flags, aim model, super range and `shouldUseSuper`). Content validation fails until it exists. Shared action registration does not teach bots a novel mechanic; add a profile field rather than a `char_class` comparison in bot modules.
8. Check the server reach guard in `src/shared/combat/matchConfig.js` and its use in `combatValidation.js` for hit types the new kit submits. Add a character-specific `ATTACK_MAX_DIST_MAP` entry if the existing fallback would reject a legitimate hit or accept hits beyond the kit's intended reach.
9. Add the default skin to `src/shared/catalogs/skinsCatalog.json` and any profile icon or purchase offer using the [cosmetic checklist](#add-a-shop-offer-or-cosmetic). Configure the unlock in the character definition. For progression rewards, update the relevant Trophy Road entry. Add a character-key alias only when migrating an existing identifier.
10. Check the lobby showcase. The default roster and portrait fallback are automatic. Animations and Fight run the shared attacks, abilities and effects through `PreviewSession`. Define custom team scenarios as participant data in `showcaseRoster` in `src/client/lobby/profile/showcaseKit.js`. Optional `src/client/game/characters/<key>/showcase.js` files override art framing (`visual.height`, `visual.maxWidth`, `visual.bodyTop`). A dedicated projectile protocol must register its instance factory in `characters/networkRegistry.js` for matches and previews. Extend `tests/profileCharacters.test.js` for any new combat mechanic and host parity.

Run content validation and focused attack, ability and network tests. In two browser clients, verify selection and skins, basic and special attack delivery, super charging, effects and hit/death animations. Check showcase Animations and Fight for clipping, missing sounds, cleanup and console errors. Use the [character brief](#character-brief) for design and art inputs.

## Add or edit a map

1. In [Map Studio](maps.md) or the authenticated map API, clone or export a schema-version-1 document. Give a new map a unique ID. Select the authoring mode and arena profile, which supply the world and camera. Edit the layout and asset library, terrain, spawn formations and mode-specific objectives.
2. Set powerup spawn positions and enable or disable pickups. If `powerups.types` is present, add only the catalog types intended for that map. An omitted list uses the shared default types. Validate every supported variant.
3. Save through Map Studio or the API for a deployment-specific map. The environment’s published revision takes precedence over a legacy override and the shipped document. Maps live in `data/maps/` unless `BB_MAP_DIR` is set. See [map persistence](maps.md#persistence-and-deployment). The lobby derives its map picker from the catalog, and a new match snapshots the selected document.
4. To ship a built-in map, add `src/shared/maps/<id>.json` and register it in `src/shared/maps/index.js`. Place referenced art under `public/assets/` and declare it in the document. Set `metadata.terrain` to a terrain audio profile from `src/shared/physics/terrainAudio.json` if needed. Update any deployed override separately for the built-in changes to take effect there.

Run content validation, `node --test tests/mapEditor.test.js tests/mapRuntime.test.js`, and the slow suite after changing geometry or spawns. In an isolated playtest, check the intended team sizes, collisions, boundaries, camera, powerups and objectives.

## Add a mode

1. Add a stable mode ID, variant IDs, team sizes, default variant, artwork, lobby presentation and capabilities to `src/shared/catalogs/gameModes.catalog.json`. Keep `implemented` and `queueable` disabled until the end-to-end flow is ready. Set `capabilities.suddenDeath` for the intended poison behavior.
2. Implement the authoritative rules under `src/server/core/gameModes/` and register the `runtimeClass` factory in `src/server/core/gameModes/index.js`. Cover initialization, scoring or survival, respawn if supported, victory, cleanup and the mode state sent to clients.
3. Register each new map authoring variant that needs its own world and camera in `src/shared/maps/arenas.json`. Build compatible map documents, spawn formations and objectives against those profiles. Duel formations share the `duels` authoring mode and select a profile with `arenaId`.
4. Add mode-specific rendering and asset loading under `src/client/game/modes/<mode>/` and register the factory and preloader in `src/client/game/modes/index.js`. Register a HUD factory in `modeHud.js` when mode snapshots need DOM updates before Phaser starts. Check queue selection, party readiness, preload and editor defaults for assumptions about existing modes.
5. For bot-enabled modes, set the catalog objective and wire decisions through `src/server/core/bots/objectives.js` and `controller.js` as needed. For a mode that awards trophies or other progress, check `src/shared/catalogs/trophySystem.catalog.json` and the room reward flow. Verify labels in `src/server/services/match/battleLog.js` and add public mode presentation in `src/server/services/site/aboutPage.js` if the mode is featured.
6. Validate content and test queueing through match completion and return to the lobby, including result labels, payout, and cleanup. Exercise bots and any new map geometry with the applicable focused and slow tests before enabling queueing.

The current map schema supports two teams with one to three players each. Free-for-all, PvE and different objective layouts require changes across schema, matchmaking, spawning, victory and HUD.

## Add a powerup or timed effect

1. For a collectible, add a key to `src/shared/catalogs/powerups.catalog.json` with `assetDir`, colors, duration, modifiers and `tickVolume` when it plays a tick sound. The catalog supplies the shared types, asset mappings and defaults. Set `scalesWithPower` when its effect uses power-based scaling.
2. Add an authoritative effect definition in `src/shared/combat/runtime/effects/effectDefs.js`. Use the shared duration/modifiers and existing effect lifecycle. Update the pickup/application dispatch only if the pickup needs behavior outside that lifecycle.
3. Add `icon.webp` and `touch.mp3` under `public/assets/powerups/<assetDir>/`. Include `tick.mp3` if `tickVolume` is set. Check sound loading and playback.
4. Add the key to explicit `powerups.types` allowlists on built-in maps and saved overrides where it should spawn. Verify editor selection and room spawning. Review pickup scoring in `src/server/core/bots/tactics.js` if bots need special incentives or avoidance.
5. Use catalog modifiers or shared rules in `src/shared/effectRules.js` for movement and other gameplay changes. Check the snapshot and local-effect paths for any new movement field. Server snapshots carry the authoritative movement values.
6. Configure bubble order/strength, tint priority and particle settings in the catalog's `visual` object. Register custom auras in `src/client/game/powerups/powerupVisuals.js`. Check `src/client/game/scene/statusIconStack.js` for any new icon behavior. Keep character-inflicted artwork with the character.

An ability-only timed effect starts at the effect definition and shared rules, then needs snapshot and presentation integration for its visible state. Validate content and check contact or ability application, stacking, expiry, death/respawn cleanup and local/remote visibility.

## Add a shop offer or cosmetic

1. Define a skin, profile icon, player card or title in the matching `src/shared/catalogs/{skins,profileIcons,playerCards,titles}Catalog.json` file. Use a stable ID, existing unlock method and valid runtime asset URLs. A skin supplies its portrait, game spritesheet and animation JSON as appropriate. Verify skin poses against the actual atlas and the character's animation definitions.
2. For an item sold in the shop, add an offer in `src/shared/catalogs/shopCatalog.json` with its section, stable offer ID, grants, price and applicable availability, eligibility or purchase limits. Check the rotation inputs if it should appear in a rotating section or daily reward. The offer owns the cosmetic price. Character unlock prices and upgrade costs remain in the character definition and `characterStats.js` respectively.
3. Reuse the shop service and cosmetic ownership services for existing grant types. For a new type, update catalog validation, eligibility and the appropriate redemption or order-fulfillment path under `src/server/services/shop/`. Cover transaction and duplicate-delivery behavior. Money offers currently support unlimited currency packs. Verify Stripe configuration, checkout and webhook fulfillment using [Payments](../operations/payments.md). See [Progression](progression.md) for grant and offer rules.
4. Run content validation and `npm run test:shop`. Check `tests/cosmeticRoutes.test.js` when ownership/equip behavior changes. In the lobby, verify offer appearance, purchase or claim, owned-state updates, and equipping in the relevant picker. Check equipped assets in the match if the cosmetic appears there.

Animation selection/sorting belongs in `src/client/game/characters/shared/animationBuilder.js`. Keep timing and deliberate pose order in the character's `anim.js`. Keep editable artwork, exports and licensing information clearly named and check asset references before moving files.

## Add an HTTP route or service

1. Define the shared URL in `src/shared/net/apiPaths.js` and add the handler to the owning module under `src/server/routes/modules/`. Register a new module in `src/server/routes/routes.js` before the not-found and error handlers. Follow the owning module's URL, method and status conventions.
2. Use the appropriate auth function from the registration context and enforce resource ownership or admin permissions before performing mutations. Validate request fields and follow the route helpers in `src/server/routes/http.js`. Apply relevant rate limits through `src/server/middleware/abuseHttpMiddleware.js` or the domain's existing abuse guard.
3. Put domain logic in `src/server/services/<domain>/`. Pass dependencies through the existing registration, use parameterized queries through `src/server/core/sql.js`, and use `withTransaction` for multi-write operations that must succeed together. Use the [migration checklist](#add-a-database-migration) when changing persistence.
4. Update the calling client and extend the owning route or service test. Cover successful behavior, invalid input, missing authentication, permissions and limits where applicable.

## Add a socket event

1. Define its name in `src/shared/net/socketEvents.js` and use that constant in client emitters/listeners and server handlers. For compact gameplay payloads, update the matching encode/decode functions in `src/shared/networkWire.js` and review the match protocol compatibility check in `src/server/core/socketEvents/clientCompatibility.js`.
2. Register a lobby event in the owning module under `src/server/core/socketEvents/`, wired by `src/server/core/socket.js`. Match-scoped events registered per room/player belong in the appropriate GameRoom transport or combat adapter. Use the established acknowledgement and error shape. `defineSocketHandler` handles acknowledgements, auth, guards and errors on lobby handlers that use it.
3. Validate membership, action eligibility and payload fields against server state. Broadcast to the appropriate socket or room. Register client listeners in the owning page/controller or match transport and dispose them on exit.
4. Extend the owning socket test, using `tests/helpers/fakeIo.js` for socket boundaries where appropriate. Verify request/ack, rejection, intended recipients and cleanup on disconnect or navigation. For match wire changes, test real encoders/decoders across the client/server boundary and check reconnect or resync behavior. See [Networking](networking.md).

## Add a client page or lobby panel

1. For a separate page, add its entry module under `src/client/pages/`, its template under `public/`, its named Webpack entry in `webpack.config.js` and the matching bundle reference in the HTML. Serve it through `src/server/routes/modules/pageRoutes.js` or the owning route module with the intended auth policy.
2. For a panel within the lobby, add the DOM in `public/index.html` and the feature controller under `src/client/lobby/`. Wire it from `src/client/pages/lobby.js`, following existing lazy initialization for panels such as the shop. Keep panel CSS with the owning feature.
3. Use the existing navigation/page scope for listeners, requests, timers and observers. Tear down any resources outside that scope on page exit. Check access both by direct URL and through in-app navigation.
4. Run `npm run build` for entry points, Webpack or HTML changes. Extend the relevant lifecycle or DOM tests. Open, leave and reopen the page or panel in a browser to check controls, layout, assets and duplicate handlers. See [Client](client.md).

## Add a bot behavior

1. Start at `src/server/core/bots/controller.js` and put the logic in the existing owner. Use `perception.js` for observed state, `tactics.js` and `objectives.js` for decisions, `combat.js` and `supers.js` for attack decisions, and `travel.js` and `navigation.js` for movement and route execution.
2. Express kit-specific behavior in `src/shared/combat/characterProfiles.js`. Check difficulty parameters in `src/server/services/match/bots/config.js`. For an objective, start with the mode's catalog objective and keep decisions based on the room's authoritative state.
3. Route actions through the existing GameRoom input/combat and physics paths. Reuse the navigation service and movement solver for reachable destinations, hazards and timing.
4. Extend the closest test with the headless `botRoom.js` fixture when needed. Assert the resulting decision or action with time/seed control where relevant. Run the slow suite if navigation, movement, physics, geometry or spawns change. See [Gameplay](gameplay.md#bots-and-matchmaking).

## Add a database migration

Add `migrations/<date>_<feature>.sql` with additive DDL and explicit existence checks compatible with MySQL. Register it in `BOOTSTRAP_ORDER` in `scripts/db/apply-migration.cjs` and keep `src/server/core/schemaRequirements.js` current. Add a named step when the migration needs checks or backfills, using the helpers in `scripts/db/db.cjs`. Verify the bootstrap against an empty disposable database and use `npm run migrate:status` to check an existing schema with metadata queries. Document the upgrade and any one-time backfill in [Database setup](../operations/database.md#upgrade-an-existing-database).

## Module boundaries

Keep feature constants, defaults and small helpers in the module that owns their behavior. For example, pickup delay belongs in `shared/powerups.js`, snapshot defaults in `client/game/match/snapshotBuffer.js`, and duck sounds in `client/game/audio/movementAudio.js`. Extract a file when it establishes a reusable rule, independent lifecycle or clear content boundary; do not create one file per constant or callback. Keep browser/server dependency boundaries intact when consolidating.

## Review checklist

- Does each new module own a coherent behavior or state lifecycle?
- Can another content addition reuse the existing rules with a definition/registration change?
- Are imports directed toward the owning domain, without entry-point cycles?
- Are public contracts and gameplay values preserved?
- Do content validation, relevant tests and the build pass? Record any baseline failures and actual manual checks; do not weaken tests to hide a refactor regression.

## Character brief

Before implementation, specify the stable lowercase key, display name/description, free/shop/Trophy Road unlock rule, base health/damage, ammo capacity and cooldown/reload times, and super charge rules. Describe basic and special targeting, windup, trajectory, range, collision geometry, effects, and interruption behavior. Damage and eligibility must be validated by the server.

Supply the body portrait, sprite atlas and animation JSON, attack/VFX art, sounds, skin variants, and optional profile icon. Define sprite scale and collision-body offsets separately. Required animation names depend on the character's `anim.js`; verify every referenced frame, including duck, wall and dash fallbacks. Use [the art workflow](../art/README.md) for source and export conventions. Existing Gloop and Sparrow JSON definitions are the reference for their shipped kits; old request briefs are not tuning specifications.
