#!/usr/bin/env node
// Imports Ozzy's one-shot animations from image-to-video clips with the
// cleanup of video-clip.cjs:
//   node scripts/art/ozzy-pixel/actions-video.cjs <clip folder> [--install] [name...]
// Previews -> output/ozzy-pixel/actions-video/. --install replaces those
// animations' cells in public/assets/ozzy/spritesheet.webp and the atlas, and
// writes the measured staff tips into src/shared/characters/ozzy.json.
//
// Every frame below is a source frame number of its clip, picked by eye from
// the whole clip (all clips open on the rest pose):
// - Throws: six frames of wind-up and hold, the release pose (staff fully
//   out), then one frame of follow-through, the layout ozzyThrowFrameMs
//   times (shared/characters/ozzyCharge.js). Frames where the clip draws its
//   own glow ball are skipped: the game charges its own fireball on the tip.
//   `attack` is the level throw; aimhigh/up/down/low are its aimed variants
//   (characters/ozzy/aimPoses.js).
// - Dashes: three frames into the held pose. The clip lunges across the
//   frame, but the game moves the sprite, so each frame is re-centred on the
//   old dash art's centre of mass.
// - Jump and fall share a clip: take-off (21) to apex (37) is the jump,
//   scrubbed by vertical speed; the float after it is the falling loop. Both
//   are lifted out of the clip's rise the same way (centre of mass held,
//   floating feet on FALL_FEET like the old fall art).
// - Super: `special` is the cast (staff swing, the flash at the book, the
//   staff catching fire, every other frame; then the flames bursting up,
//   every third) and `surge` the engulfing flames, which loop until the cast
//   ends (characters/ozzy/anim.js).
const fs = require('node:fs');
const path = require('node:path');
const V = require('./video-clip.cjs');

const DASH_GRID = 16.59; // the dash clips share the idle clip's zoom
const FALL_FEET = 102; // sole row of the floating pose (the old fall art's)
const DISTINCT = 8; // palette slots for small distinct colours (the crystal)

const THROWS = [
  { name: 'attack', clip: 'attack_right', frames: [5, 7, 9, 12, 16, 20, 24, 32] },
  { name: 'aimhigh', clip: 'attack_up', frames: [11, 14, 17, 20, 23, 26, 28, 66] },
  { name: 'aimup', clip: 'attack_up_right', frames: [7, 9, 11, 12, 13, 14, 16, 40] },
  { name: 'aimdown', clip: 'attack_down_right', frames: [5, 7, 9, 11, 13, 15, 18, 44] },
  { name: 'aimlow', clip: 'attack_down', frames: [11, 13, 15, 17, 19, 21, 23, 50] },
];
const ANIMS = [
  ...THROWS.map((t) => ({ ...t, fps: 12, tips: true, dropGlow: true })),
  { name: 'dashright', clip: 'dash_right', grid: DASH_GRID, frames: [24, 27, 31], anchor: 'dash', fps: 12 },
  { name: 'dashdiagonal', clip: 'dash_up_right', grid: DASH_GRID, frames: [27, 31, 45], anchor: 'dash', fps: 12 },
  { name: 'jump', clip: 'jump+fall', frames: [21, 24, 27, 30, 33, 37], anchor: 'air', fps: 12 },
  { name: 'falling', clip: 'jump+fall', loop: { from: 38, minLoop: 12, maxLoop: 33, step: 3 }, anchor: 'air', fps: 8 },
  { name: 'special', clip: 'super', frames: [...range(7, 34, 2), ...range(35, 54, 3)], fps: 14, tips: 'flame' },
  { name: 'surge', clip: 'super', loop: { from: 36, minLoop: 12, maxLoop: 34, step: 2 }, fps: 12, tips: 'flame' },
];
const DASH_CENTRE = { dashright: [47, 79], dashdiagonal: [48, 76] }; // old dash art's centre of mass

function range(a, b, step) { const out = []; for (let i = a; i < b; i += step) out.push(i); return out; }

// The staff's crystal: centre of its cyan pixels (on the rest pose this is
// the rig's default staff tip).
function crystal(cell) {
  let n = 0; let sx = 0; let sy = 0;
  for (let y = 0; y < V.CELL; y++) for (let x = 0; x < V.CELL; x++) {
    const i = (y * V.CELL + x) * 4; const [r, g, b, a] = [cell[i], cell[i + 1], cell[i + 2], cell[i + 3]];
    if (a && b >= 150 && b - r >= 60 && g >= 120) { n++; sx += x; sy += y; }
  }
  return n ? [Math.round(sx / n), Math.round(sy / n)] : null;
}

// The staff's fire during the super: centre of the highest patch of hot
// yellow-white pixels (the robe's flames are violet and cyan; his face and
// the gold trim are warm too, but always below the staff head). Before the
// staff lights, the crystal stands in.
function flame(cell) {
  const warm = [];
  for (let y = 0; y < V.CELL; y++) for (let x = 0; x < V.CELL; x++) {
    const i = (y * V.CELL + x) * 4; const [r, g, b, a] = [cell[i], cell[i + 1], cell[i + 2], cell[i + 3]];
    if (a && r >= 220 && g >= 150 && b <= 170 && r - b >= 70) warm.push([x, y]);
  }
  if (!warm.length) return crystal(cell);
  const top = Math.min(...warm.map(([, y]) => y));
  const head = warm.filter(([, y]) => y <= top + 10);
  if (head.length < 3) return crystal(cell);
  return [0, 1].map((k) => Math.round(head.reduce((s, p) => s + p[k], 0) / head.length));
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) throw new Error('usage: actions-video.cjs <clip folder> [--install] [name...]');
  const only = args.filter((a) => !a.startsWith('--') && a !== dir);
  const install = args.includes('--install');
  const OUT = path.join(V.ROOT, 'output/ozzy-pixel/actions-video');
  const clips = new Map();
  const clipOf = (anim) => {
    const key = `${anim.clip}@${anim.grid || 'fit'}`;
    if (!clips.has(key)) {
      const clip = V.prepareClip(path.join(dir, `${anim.clip}.mp4`), { gridSize: anim.grid || 'fit', dropGlow: !!anim.dropGlow, distinct: DISTINCT });
      console.log(`${anim.clip}: grid ${clip.grid.size} px/art px${clip.grid.fit ? ` (fit, edge coherence ${clip.grid.fit.coherence})` : ''}`);
      clips.set(key, clip);
    }
    return clips.get(key);
  };

  const groups = []; const report = {};
  for (const anim of ANIMS) {
    if (only.length && !only.includes(anim.name)) continue;
    const clip = clipOf(anim);
    const count = clip.frames.length;
    const plain = (f) => clip.cell(f);

    // Re-anchoring shift for a source frame (see the header).
    const rest = V.stats(plain(0));
    let airLift = 0;
    if (anim.anchor === 'air') { const apex = V.stats(plain(37)); airLift = apex.y1 + Math.round(rest.cy - apex.cy) - FALL_FEET; }
    const shiftOf = (f) => {
      if (!anim.anchor) return [0, 0];
      const s = V.stats(plain(f));
      if (anim.anchor === 'air') return [0, Math.round(rest.cy - s.cy) - airLift];
      const [tx, ty] = DASH_CENTRE[anim.name];
      return [Math.round(tx - s.cx), Math.round(ty - s.cy)];
    };
    // A played frame and its source neighbours, all with the frame's shift.
    const pick = (f) => {
      const shift = shiftOf(f);
      const cell = clip.cell(f, shift);
      cell.neighbours = [Math.max(0, f - 1), f, Math.min(count - 1, f + 1)].map((g) => clip.cell(g, shift));
      return cell;
    };

    let frames = anim.frames;
    let loopNote = '';
    if (anim.loop) {
      const { from, minLoop, maxLoop, step } = anim.loop;
      const shifted = []; for (let f = 0; f < count; f++) shifted.push(f >= from ? clip.cell(f, shiftOf(f)) : null);
      let cut = null;
      for (let a = from; a < count; a++) for (let b = a + minLoop; b < count && b - a <= maxLoop; b++) {
        if ((b - a) % step) continue;
        const score = V.diff(shifted[a], shifted[b]);
        if (!cut || score < cut.score || (score === cut.score && b - a > cut.b - cut.a)) cut = { a, b, score };
      }
      frames = range(cut.a, cut.b, step);
      loopNote = ` loop ${cut.a}-${cut.b} seam ${cut.score}`;
    }
    const picked = frames.map(pick);
    picked.forEach((c, i) => { if (c.clipped) console.warn(`warning: ${anim.name} frame ${frames[i]} loses ${c.clipped} px outside the cell`); });
    const cells = V.cleanFrames(picked, { majority: true });
    const steps = cells.map((c, i) => (i + 1 < cells.length ? V.diff(c, cells[i + 1]) : null)).filter((v) => v !== null);
    console.log(`${anim.name}: ${cells.length} frames from ${anim.clip} [${frames.join(' ')}]${loopNote} | steps ${steps.join(' ')}`);
    await V.writePreviews(OUT, anim.name, cells, cells.map(() => 1000 / anim.fps));
    const entry = { clip: anim.clip, grid: clip.grid.size, sourceFrames: frames };
    if (anim.tips) {
      const find = anim.tips === 'flame' ? flame : crystal;
      let last = find(cells[0]) || [32, 57];
      entry.staffTip = cells.map((c) => (last = find(c) || last));
    }
    report[anim.name] = entry;
    groups.push({ name: anim.name, cells });
  }
  fs.writeFileSync(path.join(OUT, 'actions-video.json'), `${JSON.stringify(report, null, 1)}\n`);
  console.log(`wrote previews to ${path.relative(V.ROOT, OUT)}`);
  if (!install) return;
  await V.installCells(groups);

  // Staff tips per throw frame (shared/characters/characterRig.js looks them
  // up by frame prefix and index). Only the staffTip block is rewritten, one
  // track per line as in the rest of the file.
  const defPath = path.join(V.ROOT, 'src/shared/characters/ozzy.json');
  const text = fs.readFileSync(defPath, 'utf8');
  const tips = JSON.parse(text).rig.points.staffTip;
  for (const [name, entry] of Object.entries(report)) if (entry.staffTip) tips[name] = entry.staffTip;
  const block = /( *)"staffTip": \{[\s\S]*?\n\1\}/;
  const indent = block.exec(text)[1];
  const lines = Object.entries(tips).map(([k, v]) => `${indent}  "${k}": ${JSON.stringify(v).replace(/,/g, ', ')}`);
  fs.writeFileSync(defPath, text.replace(block, `${indent}"staffTip": {\n${lines.join(',\n')}\n${indent}}`));
  console.log('wrote staff tips into src/shared/characters/ozzy.json');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
