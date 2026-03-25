# Spritesheet Generator

Small local Express app for building a Bro Battles-ready character atlas with a real frame editor.

## What it generates

For each character run, the tool outputs:

- `output/<character>/body.webp`
- `output/<character>/spritesheet.webp`
- `output/<character>/animations.json`
- `output/<character>/import-notes.md`
- `output/<character>.zip`

The generated atlas uses these canonical frame prefixes:

- `idle`
- `running`
- `jumping`
- `falling`
- `attack`
- `dying` from the uploaded `dead` clip
- `wall` from the uploaded `wall jump` clip
- `special`

Each animation can use its own fps.

## Requirements

- Node.js 18+ installed locally
- `ffmpeg` available on your PATH

## Install

From this folder:

```bash
npm install
```

## Run

```bash
node server.js
```

Open [http://localhost:3015](http://localhost:3015)

## Workflow

1. Enter a character name.
2. Pick the solid background key color used by your AI videos.
3. Create a session.
4. Upload any animation you want to work on first. You do not need all 8 videos up front.
5. Set that animation's fps and process it.
6. Open the animation editor to:
   - scrub through a scrollable frame timeline
   - draw with a brush
   - erase pixels
   - move frame-to-frame with buttons or left/right arrow keys
   - import still images straight into the timeline
   - add blank frames
   - duplicate frames
   - delete bad frames
   - set the current frame as the exported `body.webp`
7. Repeat for any other animations you want.
8. Click `Export Bundle` when the frame timelines look right.
9. Download the generated zip or copy the output folder into Bro Battles.

## Import into Bro Battles

Copy the generated character folder into:

```text
../public/assets/<character>/
```

The generated assets are compatible with the existing Bro Battles pattern that expects:

- `body.webp` for lobby/HUD/profile imagery
- `spritesheet.webp` + `animations.json` for Phaser atlas loading

This tool does not edit Bro Battles runtime files for you. You still need to manually register the new character in:

- `src/lib/characterStats.js`
- `src/characters/manifest.js`

And add the runtime character modules under:

```text
src/characters/<character>/
```
