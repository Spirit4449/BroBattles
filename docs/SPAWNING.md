# Spawn placement and countdown drops

Player spawn coordinates identify a **landing surface**, not a sprite center. The shared resolver uses the character's collision body, rejects disabled decoration and obstructed surfaces, and keeps feet safely inside platform edges. An `anchorId` binds a slot to a platform; `dx` offsets it from the collision body's center. Free `x,y` markers select the nearest clear walkable surface.

In the map editor, select a player spawn marker and drag it near the desired surface. The marker snaps to the resolved landing point. Set **Spawn drop height** (0–320 pixels; default 180). Ceilings automatically shorten the descent so a character never starts inside an overhead platform. Existing import/export and undo retain this field.

Use **Export Map Snippets** to persist edits:

- Maps 1–3: replace the exported map entry in `src/shared/duelMaps.json`.
- Bank Bust / Iron Junction: replace `src/shared/bankSpawnGeometry.json` with the exported object. This file owns both client and server collision/spawn data, including Bank Bust respawns.

Both export formats can be imported back into the editor. Exporting does not automatically write repository files.

The server establishes landing positions before sending `game:start`. During the countdown, clients use Arcade gravity, capped descent velocity, and map collision for the parachute drop. Falling animation and a swaying canopy play until contact; contact triggers the existing spawn burst. Input and remote interpolation do not move characters during this phase. Fight start restores normal movement and broadcasts shield effects, **without issuing another respawn**. Live reconnects skip the intro. Ordinary Bank Bust death respawns use validated landing slots; parachutes are the initial match entrance only.

The parachutes use the single-frame `parachute-blue.png` (you/allies) and `parachute-red.png` (opponents), drawn at 89 pixels high with their original proportions. Descent is capped at 88 px/s. Tuning constants live at the top of `src/gameScene/spawnIntro.js`.

A gentle one-way glide starts each character upwind of the landing spot (up to 36 pixels horizontally). A slightly curved approach eases into the spawn X without reversing direction. The canopy smoothly leans toward actual horizontal velocity instead of oscillating on a timer. Launch side and distance vary deterministically per player; nearby walls and narrow platform edges reduce the offset or choose the safer side. Vertical clearance and the editor's drop height still control the launch altitude.

The drop uses `movement/parachute-open.mp3`: “Paracaídas.wav” by sbaneat on Freesound, released under CC0. The dedicated parachute-opening sample plays once at natural pitch, with 1–3 quiet delayed echoes based on player count; it does not loop the opening or use the generic wind sound. Audio fades out once everyone lands and is destroyed on fight start or scene shutdown; it respects Phaser's global audio settings. Source and license are recorded in `public/assets/movement/parachute-open.LICENSE.md`. Normal gameplay falling still uses its separate wind sound.

Regression checks: `node --test tests/spawnPlacement.test.js tests/spawnIntro.test.js tests/gameRoomStartup.test.js`.
