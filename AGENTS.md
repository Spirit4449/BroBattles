# Agent instructions

Bro Battles is a real-time multiplayer browser battle arena (Phaser client, Express and Socket.IO server). Start at [docs/README.md](docs/README.md) to find the guide for the area you are changing. `src/shared/` owns gameplay definitions and catalogs.

## Where to make a change

| Change | Start here |
| --- | --- |
| Tune gameplay or change a limit | [Constants ownership and overrides](docs/development/constants.md). Change the owning rule once and derive values at the call site. After tuning, refresh the generated defaults with `node scripts/dev/print-constants.cjs --write`. |
| Add content | Follow the [character](docs/development/contributing.md#add-a-character), [map](docs/development/contributing.md#add-or-edit-a-map), [mode](docs/development/contributing.md#add-a-mode), [powerup](docs/development/contributing.md#add-a-powerup-or-timed-effect) or [shop offer](docs/development/contributing.md#add-a-shop-offer-or-cosmetic) checklist. |
| Change battle simulation, bots or rewards | `src/server/core/gameRoom/` owns the room, `core/bots/` owns decisions, and `src/server/services/match/` owns persisted outcomes. See the [server module map](docs/development/architecture.md#server-module-map). |
| Change a route, session or socket event | Start at `src/server/routes/routes.js` or `src/server/core/socketEvents/`. Define cross-layer names in `src/shared/net/`. See the [HTTP](docs/development/contributing.md#add-an-http-route-or-service) and [socket](docs/development/contributing.md#add-a-socket-event) checklists. |
| Change a page, HUD or lobby panel | Start at [client module ownership](docs/development/client.md#where-to-make-a-change). The lobby account lives in `src/client/lobby/session.mjs`. Full-page tool screens and retained party routes have different lifetimes. |

## Change checklist

- Trace a shared rule to its definition, readers, units, and overrides before adding a fallback. Use a catalog for authored content, the owning domain module for cross-layer rules, and a feature-local constant for a single feature. Independently tunable effects can have equal values.
- Follow existing call and wire contracts when splitting modules. Client VM fixtures stub exact import specifiers. Update the corresponding fixture when you intentionally move a dependency.
- Capture existing behavior before restructuring a flow with little coverage. Keep fixes that change player-visible behavior explicit.
- In scoped page bundles, lexical window/document listeners, timers and scoped resize, mutation and intersection observers retire with the screen. Register teardown for sockets, Phaser resources, external subscriptions and observers created outside the scope. Reset party state on retained lobby navigation. See [client lifecycle](docs/development/client.md).
- Edit a published map through Map Studio or its revision-aware API. The environment's publication takes precedence over a legacy override and then the shipped document. See [map persistence](docs/development/maps.md#persistence-and-deployment).
- Check shared CSS changes in the affected page and state. A selector may be used by generated markup or a lazy panel. Keep commits scoped when commits are requested.

## Running tests

Run as little as proves the change. Full details are in [Testing](docs/development/contributing.md#testing).

1. While iterating, run only the files for the code you touched: `node --test tests/<file>.test.js [more files]`. Find them by name or with `grep -rl "<module name>" tests/`.
2. When the change is done, run `npm test` once (about 4 seconds). Do not rerun it after every edit.
3. Run `npm run test:slow` only if you changed bot navigation, bot movement, bot physics, map geometry or spawns.
4. Skip tests entirely for changes that cannot affect them: docs, art, and copy that no test reads.
5. `npm run test:db` needs a configured MySQL database. Do not run it unless asked.

If a test fails, decide whether your change broke it or the test pinned something you were asked to change. Never delete or weaken a test just to get a pass; say so when you change a test's expectations.

## Writing tests

- Test behavior through real modules. Do not assert on source or CSS text, and do not pin tuning constants to literal numbers.
- Add to the existing test file for the feature rather than creating a new file for a single regression.
- Anything that takes more than about a second goes in `tests/slow/`.

## Other checks

- `npm run validate:content` after changing characters, maps, catalogs or assets.
- `npm run build` after changing client entry points, webpack config or HTML.
- The developer usually has `npm run dev` running on port 3002. Do not start a second server on that port.
