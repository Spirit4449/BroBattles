# November 2026 cleanup handoff

The November cleanup was implemented on the local `tech-debt-cleanup` branch. Deployment and database state are environment-specific. The [architecture map](architecture.md), [client guide](client.md), [constants reference](constants.md) and [contribution checklists](contributing.md) replace the working audit as the editor references.

## Phase coverage

| Phase | Where to verify the result |
| --- | --- |
| 0 · Safety net | [CI](../../.github/workflows/ci.yml) installs both packages, checks generated defaults and map tracking, runs the default suite and builds the game. [Testing](contributing.md#testing) maps the focused suites, including shop and payment webhooks, to their owners. |
| 1 · Shared definitions | The [constants guide](constants.md) identifies the owners of gameplay and account rules. The [networking guide](networking.md) covers the wire contracts. [Map publication](maps.md#persistence-and-deployment) describes how a deployed map overrides the shipped document. |
| 2 · Removal and compatibility | The retired standalone profile URL redirects to the lobby. [Build tests](../../tests/pageRuntimeBuild.test.js) exercise scoped bundles and verify that development pruning preserves versions referenced by production HTML. |
| 3 · Module boundaries | The [server module map](architecture.md#server-module-map) and [client module map](client.md#where-to-make-a-change) name the owners. The battle entry still coordinates Phaser and the local-fighter facade still exposes the active fighter. Ammo, HUD, pointer input and body geometry have dedicated modules. |
| 4 · Operations and persistence | The [database guide](../operations/database.md) covers new and existing schemas. The [deployment guide](../operations/deployment.md) covers persistent state. Startup and shutdown, queue recovery, reward settlement and payment handling have focused tests in the [contributor guide](contributing.md#testing). |
| 5 · Editor documentation | The [extension checklists](contributing.md#add-a-character) cover characters, maps, modes, powerups and shop offers. CI checks the [generated tuning table](constants.md#default-values-and-precedence) against its runtime sources. |

## Decisions carried forward

| Original finding | Decision |
| --- | --- |
| GAM-4, actions arriving before the scene is ready | Keep the existing queued-action replay. Work on remote attack origins and local prediction preserved that replay contract. |
| SHR-10, automatic derivation of every registration from catalogs | Keep explicit registrations for behavior and the existing attack-distance validation policy. Editors adding content should follow the feature checklist. Powerup defaults and effect metadata use their own catalogs. |

## Rollout considerations

- Set `ADMIN_USERS` for the target environment. An empty list grants no admin access.
- Check the target with `npm run migrate:status` and follow the [upgrade guide](../operations/database.md#upgrade-an-existing-database) for any missing schema. The local development database passed the read-only check. Fresh bootstrap, guest login, WebSocket connection and logout revocation were exercised separately on disposable MySQL during Phase 4.
- Back up maps and their revision assets together. On a server with legacy overrides, follow [map persistence and deployment](maps.md#persistence-and-deployment) before removing those overrides. The importer preserves revision identity and reports historical asset recovery.
- The [art storage decision](../art/README.md#storage-for-future-source-artwork) covers large editable masters and shipped assets. The cleanup retained the existing Git history.
