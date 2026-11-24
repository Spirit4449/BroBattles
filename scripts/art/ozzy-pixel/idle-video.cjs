#!/usr/bin/env node
// Imports Ozzy's idle from an image-to-video breathing clip (grey backdrop).
//   node scripts/art/ozzy-pixel/idle-video.cjs <clip.mp4> [--install]
// Previews -> output/ozzy-pixel/idle-video/. --install replaces the idleNN
// cells of public/assets/ozzy/spritesheet.webp and their atlas rows;
// characters/ozzy/anim.js plays them at 12 fps. sheet.cjs --install packs
// the code idle from idle.cjs instead, so rerun this after it.
// The cleanup steps are listed in video-clip.cjs.
const { importClip } = require('./video-clip.cjs');

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file) throw new Error('usage: idle-video.cjs <clip.mp4> [--install]');
importClip({
  file,
  name: 'idle',
  step: 2, // every other source frame plays (12 fps)
  majority: true,
  minLoop: 48, // at least two seconds of breathing per loop
  install: process.argv.includes('--install'),
}).catch((e) => { console.error(e); process.exitCode = 1; });
