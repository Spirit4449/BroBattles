# Bro Battles Architecture Map

This document is the structural source of truth for the repository. Use it to decide where code belongs before writing it.

## 1. Design Rules

1. Composition files wire modules together; they should not own feature rules.
2. Feature behavior lives in feature domains (characters, maps, powerups, matchmaking, party).
3. Shared constants and identifiers have one owner. Do not duplicate tables in random files.
4. Keep public contracts stable unless you intentionally migrate both sides:
   - Socket event names and payload shape
   - HTTP routes and response shape
   - DOM IDs/classes consumed by JS

## 2. Runtime Topology

- Client: Phaser scenes + UI orchestration in src/.
- Server: Express + Socket.IO + server-authoritative simulation in src/server/.
- Database: MySQL schema and migrations in server/migrations/.

Main runtime loop:

1. Browser posts /status to identify/create user.
2. Browser fetches /gamedata for match payload.
3. Browser joins game room via game:join.
4. Server game room ticks simulation and emits game:snapshot.
5. Client interpolates snapshots and renders local/remote entities.

## 3. Ownership Map

### Client domains

- src/game.js
  - Scene lifecycle orchestration and dependency wiring.
  - Should delegate to modules under src/gameScene/, src/match/, src/hud/, src/powerups/, src/players/.
- src/match/
  - Socket-driven match lifecycle and snapshot buffering.
- src/gameScene/
  - Frame-level scene helpers: camera, interpolation orchestration, local input sync, poison rendering, preload wiring.
- src/players/
  - Local player socket/state modules.
- src/player.js
  - Local player runtime integration point. Still large, but should continue shrinking by delegating behavior to src/players/ and character modules.
- src/opPlayer.js
  - Remote player entity runtime. Candidate for further split (socket events, ui bars, effect lifecycle).
- src/characters/
  - Character classes and behavior registration via src/characters/manifest.js and src/characters/index.js.
- src/maps/
  - Map definitions and map registry via src/maps/manifest.js.
- src/powerups/
  - Client powerup config and rendering.

### Server domains

- src/server/core/socket.js + src/server/core/socketEvents/
  - Socket transport and event registration by domain.
- src/server/core/matchmaking.js + src/server/core/matchmaking/
  - Queue, balancing, ready-check, match assembly.
- src/server/core/gameRoom.js + src/server/core/gameRoom/
  - Authoritative simulation, combat, timed effects, snapshots.
- src/server/services/
  - Reusable mutation and response-building business logic used by routes and socket paths.
- src/server/routes/
  - HTTP adapters; should delegate business logic to services.

## 4. Registries and Single Sources of Truth

- Characters: src/characters/manifest.js + src/characters/index.js + src/lib/characterStats.js.
- Maps: src/maps/manifest.js + each map definition file.
- Client powerup identity/asset mapping: src/powerups/powerupConfig.js.
- Server powerup identity/effect/timing: src/server/core/gameRoomConfig.js + src/server/core/gameRoom/effects/effectDefs.js.

Important: powerup identity currently exists in both client and server config layers. Keep them synchronized until they are unified into a shared registry.

## 5. High-Value Data Flows

### Match join and startup

- Client entry: src/game.js
- Server endpoints: src/server/routes/modules/gameRoutes.js -> src/server/services/gameDataService.js
- Socket join path: src/server/core/socketEvents/gameEvents.js and/or game room join handlers

### Live simulation and rendering

- Server tick and snapshot assembly: src/server/core/gameRoom.js + src/server/core/gameRoom/roomStateManager.js
- Client snapshot ingest/interpolation: src/match/matchCoordinator.js + src/match/snapshotBuffer.js

### Party and presence

- Route adapters: src/server/routes/modules/partyRoutes.js, statusRoutes.js
- Service layer: src/server/services/partyStateService.js, partyPresenceService.js

## 6. Extension Navigation (3 common additions)

For exact implementation steps, use docs/CONTRIBUTING.md:

- Add a character
- Add a map
- Add a powerup

Those checklists are opinionated for this codebase and list all required files.
