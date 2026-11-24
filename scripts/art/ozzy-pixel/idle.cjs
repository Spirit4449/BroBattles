#!/usr/bin/env node
// Ozzy idle: 6 frames at 6 fps, after the legacy idle: he stands with the
// staff planted and the book floating over his open palm. The book bobs and
// its pages riffle, the palm rises under it a beat behind, the shoulders sink
// a pixel on the breath and the crystal glints once a loop. The feet, coat and
// staff foot stay planted; the face only translates.
//   node scripts/art/ozzy-pixel/idle.cjs   -> output/ozzy-pixel/rig/idle/
const { figure, render, writePreview } = require('./pose.cjs');

const FPS = 6;
const FRAME_COUNT = 6;
// Page riffle: pages swap light and shade as they lift.
const PAGES = [null, { W: 'd' }, { d: 'W' }, null, { W: 'd' }, null];
const GLINT = [null, null, null, { X: 'd' }, { F: 'X' }, null];

function idlePose(i) {
  const t = i / FRAME_COUNT;
  const wave = (lag) => Math.sin(2 * Math.PI * (t - lag));
  const dip = (lag) => (1 - Math.cos(2 * Math.PI * (t - lag))) / 2;
  const drop = Math.round(dip(0));
  const pose = figure({
    drop, slide: drop,
    book: [0, Math.round(-1.5 * wave(0)) - 1],
  });
  pose.book.swap = PAGES[i] || undefined;
  pose.staff.swap = GLINT[i] || undefined;
  return pose;
}

const FRAMES = Array.from({ length: FRAME_COUNT }, (_, i) => render(idlePose(i)));

if (require.main === module) writePreview('idle', FRAMES, FPS).catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { FPS, FRAMES, idlePose };
