# Contributing Guide

This guide is for making structural changes safely in this repository.

## 1. Before You Change Code

1. Read docs/ARCHITECTURE_MAP.md.
2. Keep public contracts stable unless migration is intentional.
3. Prefer extraction + delegation over in-place growth of large files.

## 2. Local Workflow

Install and run:

```bash
npm install
npm run dev
```

Build validation:

```bash
npm run build
```

Database setup and environment details are in README.md and database.md.

## 3. Pull Request Quality Bar

Your change should include:

1. Minimal, domain-aligned file edits.
2. Updated registry entries when adding new content.
3. Manual verification notes for gameplay-affecting changes.
4. Successful npm run build.

## 4. How To Add A New Character

This is the required path for adding a playable class.

### Step 1: Add character stats

Edit src/lib/characterStats.js:

1. Add a new character entry in characterStats.
2. Include combat, progression, and tuning values used by client and server logic.

### Step 2: Add character runtime modules

Create src/characters/<key>/ with:

- constructor.js
- anim.js
- attack.js
- special.js
- effects.js (optional; only if needed)

Follow existing classes (ninja/thorg/draven/wizard) and expose static methods consumed by src/characters/index.js.

### Step 3: Register character

Edit src/characters/manifest.js:

1. Import the new constructor class.
2. Add it to CHARACTER_MANIFEST.

### Step 4: Add assets

Add character assets under public/assets/<key>/.
Confirm constructor preload paths and animation keys match actual files.

### Step 5: Verify integration points

1. Character appears in selection UI (driven from character stats and existing UI logic).
2. Local attacks/specials work.
3. Remote attack rendering works (constructor static handleRemoteAttack).
4. Build passes.

Verification checklist:

- Lobby selection renders correctly.
- Match starts with the new character.
- Basic attack, special, hit/death animations function.
- No missing texture/audio warnings in browser console.

## 5. How To Add A New Map

Use map definitions + registry. Do not add map-specific conditionals in game.js.

### Step 1: Create map definition file

Create src/maps/<mapName>.js exporting definition with:

- id (unique integer)
- name
- bgAsset
- build(scene)
- getObjects()
- positionSpawn(scene, sprite, team, index, teamSize)

Use src/maps/lushyPeaks.js or src/maps/mangroveMeadow.js as canonical patterns.

### Step 2: Register map in map manifest

Edit src/maps/manifest.js:

1. Import your map definition.
2. Add to the MAPS registry initializer list.

### Step 3: Add preload assets

Edit src/gameScene/preloadGameAssets.js to preload any new map textures/audio not already loaded.

### Step 4: Add map option in party UI

Edit public/index.html map dropdown (select#map) to include the new map id/name option.

### Step 5: Add server powerup spawn points for the map

Edit src/server/core/gameRoomConfig.js:

1. Add POWERUP_PLATFORM_POINTS[<mapId>] with valid coordinates.

Without this, powerup spawning may fail or be sparse on the new map.

Verification checklist:

- Map selectable in party UI.
- Map builds and colliders load.
- Team spawns are correct for all modes.
- Powerups spawn and can be collected.
- Build passes.

## 6. How To Add A New Powerup

Powerups currently require coordinated client and server updates.

### Step 1: Add server powerup identity and duration

Edit src/server/core/gameRoomConfig.js:

1. Add key to POWERUP_TYPES.
2. Add duration in POWERUP_DURATIONS_MS.
3. Add additional tuning constants if needed.

### Step 2: Define server effect behavior

Edit src/server/core/gameRoom/effects/effectDefs.js:

1. Add effect definition entry with duration, modifiers, and optional onApply/onTick.
2. Set snapshotKey for client effect snapshots.

### Step 3: Add client identity/assets mapping

Edit src/powerups/powerupConfig.js:

1. Add key to POWERUP_TYPES.
2. Add POWERUP_ASSET_DIR entry.
3. Add POWERUP_COLORS entry.
4. Add optional tick sound mapping in createPowerupTickSounds.

### Step 4: Add assets

Create public/assets/powerups/<folder>/ with at minimum:

- icon.webp
- touch.mp3 (or .wav fallback)
- tick.mp3 (or .wav fallback)

### Step 5: Optional custom visuals

If default visuals are not enough, extend src/powerups/powerupRenderer.js and/or character-level powerup hooks in src/characters/\*.

Verification checklist:

- Server applies/removes effect on pickup/expiry.
- Snapshot includes effect key as expected.
- Client renders icon + aura/effect behavior.
- touch/tick sounds play.
- Build passes.

## 7. What Not To Do

1. Do not add map if/else branches in src/game.js for spawn/build logic.
2. Do not add duplicate powerup type tables in random files.
3. Do not change socket event names or payloads casually.
4. Do not bypass service layer for party/presence mutations on the server.
