# Bro Battles

A multiplayer browser arena built with Phaser 3, Express, Socket.IO, and MySQL.
Human movement is simulated by the browser with server validation; the server owns combat outcomes, bots, match state, and rewards.

Playable modes are Duels (1v1, 2v2, 3v3) and Bank Bust (3v3). The six fighters are Ninja, Thorg, Draven, Wizard, Huntress, and Gloop. Other catalog modes are marked Coming Soon. Map Studio edits the four built-in maps and saved custom maps.

## Run locally

Use Node.js 18 or newer and a MySQL installation compatible with the repository's SQL. The repository has incremental migrations, **not a complete empty-database bootstrap**. Obtain a sanitized base schema from the maintainer and follow [database setup](docs/operations/database.md) before starting the server.

```sh
npm ci
cp .env.example .env
```

Set the `DB_*` connection values in `.env`. Keep local credentials out of Git. `COOKIE_SECRET` can be omitted for development; the server persists a generated value in `.cookie-secret`. Configure `ADMIN_USERS` for admin and Map Studio access. Stripe, email, and optional assisted help search have separate server-side credentials described in [services](docs/operations/services.md) and [payments](docs/operations/payments.md).

```sh
npm run migrate:status
npm run dev
```

Open http://localhost:3002 (or `PORT`). Development uses webpack middleware for browser assets and nodemon for server/shared changes. For production:

```sh
npm run build
npm start
```

Read [deployment and recovery](docs/operations/deployment.md) before operating a persistent server.

## Documentation

Start at the [documentation index](docs/README.md).

- [Development](docs/development/architecture.md): ownership, contribution workflow, gameplay, networking, browser lifecycle, maps, and progression.
- [Operations](docs/operations/deployment.md): deployment, databases, payments, public content, email, and support.
- [Art](docs/art/README.md): installed assets, production tools, and retained generation prompts.
- [Player help](content/help/getting-started.md): articles served by the game at `/help`.
- [Sprite Workshop](spritesheet-generator/README.md): separate local editor and CLI.

## Checks

```sh
npm run validate:content
npm test
npm run build
```

Focused suites include `test:network`, `test:bots`, `test:shop`, `test:trophies`, and `test:battle-log`. Database checks (`npm run test:db`) require configured MySQL; see their prerequisites in the database guide. Browser rendering harnesses have separate Playwright requirements described in the client guide.

Run commands from the repository root unless a guide says otherwise. `package.json` is the command reference; `src/shared/` owns gameplay definitions and catalogs.
