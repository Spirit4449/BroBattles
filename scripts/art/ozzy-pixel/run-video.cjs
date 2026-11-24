#!/usr/bin/env node
// Imports Ozzy's run from an image-to-video clip (grey backdrop) that opens
// on the rest pose and breaks into an in-place run.
//   node scripts/art/ozzy-pixel/run-video.cjs <clip.mp4> [--install]
// Previews -> output/ozzy-pixel/running-video/. --install replaces the
// runningNN cells of public/assets/ozzy/spritesheet.webp and their atlas rows;
// characters/ozzy/anim.js sets the playback rate. sheet.cjs --install packs
// the code run from run.cjs instead, so rerun this after it.
// The cleanup steps are listed in video-clip.cjs.
const { importClip } = require('./video-clip.cjs');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) throw new Error('usage: run-video.cjs <clip.mp4> [--install]');
const opt = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
importClip({
  file,
  name: 'running',
  step: opt('step', 2), // every other source frame: at most 12 frames per stride
  majority: !args.includes('--no-majority'),
  from: opt('from', 20), // the rest pose and the break into the run come first
  minLoop: opt('min', 18), // one stride (both feet) is about 22-24 source frames
  maxLoop: opt('max', 24),
  install: args.includes('--install'),
}).catch((e) => { console.error(e); process.exitCode = 1; });
