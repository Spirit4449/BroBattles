# Spawn placement

Player spawn coordinates identify a **landing surface**, not a sprite center. The shared resolver uses the character's collision body, rejects disabled decoration and obstructed surfaces, and keeps feet safely inside platform edges. An `anchorId` binds a slot to a platform; `dx` offsets it from the collision body's center. Free `x,y` markers select the nearest clear walkable surface.

In the map editor, select a player spawn marker and drag it near the desired surface. The marker snaps to the resolved landing point. Existing import/export and undo retain spawn edits. (Documents may still carry a legacy `dropHeight`; it is validated but unused.)

Use **Export Map Snippets** to persist edits:

- Maps 1–3: replace the exported map entry in `src/shared/duelMaps.json`.
- Bank Bust / Iron Junction: replace `src/shared/bankSpawnGeometry.json` with the exported object. This file owns both client and server collision/spawn data, including Bank Bust respawns.

Both export formats can be imported back into the editor. Exporting does not automatically write repository files.

The server is the single authority for start positions: `spawnStateFor` in `src/server/core/gameRoom/roomStateManager.js` picks the slot (roster order by participant ID, map-variant slot layout, facing right) for humans, bots, playtests and Bank Bust respawns alike. A player's spawn is assigned on join, sent in `game:init`, re-established when the countdown starts and sent again in `game:start`; the client stands every fighter on those coordinates (`applyServerSpawns` in `src/game.js`) and only falls back to its own map placement when the server has not sent a position. Movement packets are ignored until FIGHT.

The server establishes landing positions before sending `game:start`. Fighters stand at their spawns through the pregame and countdown (see `src/shared/matchIntroTiming.js` and `src/gameScene/matchIntro.js`); keyboard input and movement sync start at FIGHT, which broadcasts shield effects **without issuing another respawn**. Live reconnects skip the pregame. Ordinary Bank Bust death respawns use validated landing slots.

Regression checks: `node --test tests/spawnPlacement.test.js tests/gameRoomStartup.test.js tests/pregameFlythrough.test.js`.
