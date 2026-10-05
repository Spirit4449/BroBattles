# Agent instructions

Bro Battles is a real-time multiplayer browser battle arena (Phaser client, Express and Socket.IO server). Start at [docs/README.md](docs/README.md) to find the guide for the area you are changing. `src/shared/` owns gameplay definitions and catalogs.

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
