#!/usr/bin/env node
// Sparrow's super, Seraph: angel wings, a hover and a bow drawn tight on a
// nocked arrow of light, aiming with one eye closed.
//   seraphRise00-07  she rises: wings unfurl from her back while she reaches
//                    for the light arrow, nocks it and draws (attack keys 0-3)
//   seraphAimDDFF    the held draw aimed in direction DD (00 straight up, 06
//                    level, 12 straight down, every 15 deg), wing flutter FF 0-3
// The body is the attack rig's full draw (attack.cjs) bent onto the aim, with
// the fall's dangling legs (jump.cjs) under a flared hem. Wings are a fan of
// feathers drawn per frame behind her; the arrow is light, not wood.
//   node scripts/art/sparrow-pixel/seraph.cjs   -> output/sparrow-pixel/seraph/
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { JOINTS } = require('./parts.cjs');
const { renderPose, apply } = require('./render.cjs');
const A = require('./attack.cjs');
const J = require('./jump.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'output/sparrow-pixel/seraph');
const { MARGIN, SIDE } = A;
// The wings reach past the attack frames' canvas, so Seraph frames are wider.
const WIDE_MARGIN = 34;
const WIDE = 64 + WIDE_MARGIN * 2;
const PREVIEW_SCALE = 5;

// Aim directions, shared with the game's pose picker.
const { SERAPH_DIRECTIONS, SERAPH_FLUTTER_FPS } = require('../../../src/shared/characters/sparrowSeraphAim.js');

// Feather palette: white plumage shaded cool, a gold leading edge.
const WING_RGB = {
  X: [255, 255, 255], Y: [232, 237, 250], Z: [190, 201, 232], Q: [138, 150, 196],
  U: [255, 226, 140], V: [214, 166, 72], L: [255, 250, 214], // light-arrow core
};
const RGB = { ...A.RGB, ...WING_RGB };
const DARKER = { X: 'Y', Y: 'Z', Z: 'Q', Q: 'Q', U: 'V', V: 'V' };

// --- wings ------------------------------------------------------------------
// An angel's wing seen from the side: an arched bone (the leading edge) rising
// up and back from her shoulder blade, rounded coverts along it with a gold
// edge, and primaries hanging from it that sweep back and down, longest at the
// wing tip. Angles in degrees on screen (0 = right, 90 = down); she faces right.
const BONE = { length: 25, angle: -116, arch: 6 };
const FEATHERS = 9;

// Points along the bone, root (s = 0) to tip (s = 1), bowed upward.
function bonePoint(root, s, { lift, scale }) {
  const a = ((BONE.angle + lift) * Math.PI) / 180;
  const along = BONE.length * scale * s;
  const bow = BONE.arch * scale * Math.sin(Math.PI * s);
  return [root[0] + Math.cos(a) * along + Math.sin(a) * bow, root[1] + Math.sin(a) * along - Math.cos(a) * bow];
}

function paintWing(layerOut, root, { rotate = 0, open = 1, spread = 1, darker = false }) {
  const scale = 0.4 + 0.6 * open;
  const shade = (ch) => (darker ? DARKER[ch] || ch : ch);
  const layer = new Map(); // pixel -> char, later layers on top
  const plot = (x, y, ch) => layer.set(`${x},${y}`, ch);
  // Primaries, tip feathers first so the inner ones lie over them.
  for (let k = FEATHERS - 1; k >= 0; k--) {
    const s = 0.12 + (0.88 * k) / (FEATHERS - 1);
    const base = bonePoint(root, s, { lift: rotate, scale });
    const deg = 108 + 92 * s * spread + rotate * 0.6;
    const len = (9 + 21 * s ** 1.3) * scale * (0.85 + 0.15 * spread);
    const [ux, uy] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
    const half = 2.4;
    for (let y = Math.floor(base[1] - len - 3); y <= base[1] + len + 3; y++) {
      for (let x = Math.floor(base[0] - len - 3); x <= base[0] + len + 3; x++) {
        const dx = x + 0.5 - base[0]; const dy = y + 0.5 - base[1];
        const t = dx * ux + dy * uy; const side = -dx * uy + dy * ux;
        const w = half * (t > len - 3 ? Math.max(0.2, (len - t) / 3) : 1);
        if (t < -1 || t > len || Math.abs(side) > w) continue;
        // Lit on the upper (leading) side, a shadow line on the trailing edge.
        const ch = side > w - 0.9 ? 'Z' : t > len - 2.2 ? 'Y' : side < -0.6 ? 'X' : 'Y';
        plot(x, y, ch);
      }
    }
  }
  // Coverts: a thick rounded band along the bone, gold on its top edge.
  for (let i = 0; i <= 40; i++) {
    const s = i / 40;
    const [bx, by] = bonePoint(root, s, { lift: rotate, scale });
    const r = (4.6 - 2.2 * s) * (0.7 + 0.3 * scale);
    for (let y = Math.floor(by - r - 1); y <= by + r + 1; y++) for (let x = Math.floor(bx - r - 1); x <= bx + r + 1; x++) {
      const dx = x + 0.5 - bx; const dy = y + 0.5 - by;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const top = dy < -r * 0.45;
      plot(x, y, top && d > r - 1.4 ? (s > 0.75 ? 'V' : 'U') : d > r - 1.1 && dy > 0 ? 'Y' : 'X');
    }
  }
  for (const [key, ch] of layer) layerOut.set(key, shade(ch));
}

// Flutter: the stroke angle and spread for each of the four looped frames.
const FLUTTER = [
  { rotate: -20, spread: 1.08 },
  { rotate: -6, spread: 1 },
  { rotate: 12, spread: 0.86 },
  { rotate: -6, spread: 1 },
];

// --- body -------------------------------------------------------------------
const FULL_DRAW = A.KEYS[3];
// Dangling legs from the fall pose, toes pointed.
const LEGS = { near: [26, 58, 50], far: [-8, 30, 58] };
const SKIRT = { back: 0.9, front: 0.35, rise: 3 };

function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const [a, b, c, d] = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

function hoverPose(key, direction) {
  const built = A.attackPose(key, direction);
  const { pose } = built;
  const bodyM = pose.torso.m;
  const near = J.legChain(apply(bodyM, J.NEAR_HIP), LEGS.near);
  const far = J.legChain(apply(bodyM, J.FAR_HIP), LEGS.far);
  Object.assign(pose, {
    backLeg: { hidden: true },
    farKnee: far.thigh, farThigh: far.thigh, farBoot: far.boot,
    nearKnee: near.thigh, frontThigh: near.thigh, frontBoot: near.boot,
    skirt: { warp: J.flare(invert(pose.skirt.m), SKIRT) },
  });
  return { ...built, bodyM };
}

// The near eye (rest canvas px), closed to a lid line for the aim.
const EYE = { open: [[41, 21], [42, 21]], lid: [[41, 22], [42, 22]] };

function lightArrow(g, nock, toward) {
  const [dx, dy] = [toward[0] - nock[0], toward[1] - nock[1]];
  const len = Math.hypot(dx, dy);
  const tip = [Math.round(nock[0] + (dx / len) * 22), Math.round(nock[1] + (dy / len) * 22)];
  const shaft = A.line(g, nock, tip, 'L');
  for (const [x, y] of shaft) if (A.get(g, x, y + 1) === '.') A.put(g, x, y + 1, 'U');
  const [hx, hy] = tip;
  for (const [ox, oy, ch] of [[0, 0, 'X'], [1, 0, 'Y'], [-1, 0, 'Y'], [0, 1, 'Y'], [0, -1, 'Y']]) A.put(g, hx + ox, hy + oy, ch);
}

// Each limb curves away from her hand and ends in a curled tip. The outer
// strokes leave stepped amber pixels around the nearly white inner limb.
function lightBow({ grip, aimDir: [ux, uy], nock }, plot) {
  const at = (reach, height) => [grip[0] + ux * reach - uy * height, grip[1] + uy * reach + ux * height];
  const limb = [[-12, 34], [-8, 32], [-7, 27], [-3, 23], [3, 18], [6, 12], [5, 7], [1, 3], [0, 0]];
  const paths = [0.76, -1].map((side) => limb.map(([reach, height]) => at(reach, height * side)));
  const stroke = (points, radius, color, alpha) => {
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
      for (let j = 0; j <= steps; j++) {
        const x = Math.round(ax + (bx - ax) * j / steps);
        const y = Math.round(ay + (by - ay) * j / steps);
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy <= radius * radius) plot(x + dx, y + dy, color, alpha);
        }
      }
    }
  };
  for (const path of paths) {
    stroke(path, 5, 'U', 32);
    stroke(path, 3, 'U', 79);
    stroke([path[0], nock], 1, 'U', 85);
    stroke([path[0], nock], 0, 'L', 205);
  }
  for (const path of paths) {
    stroke(path, 2, 'V', 255);
    stroke(path, 1, 'U', 255);
    stroke(path, 0, 'X', 255);
    stroke(path.slice(0, 2), 1, 'L', 255);
  }
}

// A char layer (Map of "x,y" in rest-canvas px) with a 1px dark outline.
function outlined(layer) {
  const out = new Map(layer);
  for (const key of layer.keys()) {
    const [x, y] = key.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy}`;
      if (!layer.has(k)) out.set(k, 'k');
    }
  }
  return out;
}

function renderSeraph(key, direction, { flutter = FLUTTER[1], open = 1, eyeClosed = true } = {}) {
  const built = hoverPose(key, direction);
  const { pose, bodyM, nock, along, drawn, shoulder, arm, heldArrow } = built;
  if (drawn) pose.bow = { hidden: true };
  const body = renderPose(pose, { size: SIDE });
  const px = Buffer.alloc(WIDE * WIDE * 4);
  const at = (x, y) => (y + WIDE_MARGIN) * WIDE + x + WIDE_MARGIN;
  const inWide = (x, y) => x >= -WIDE_MARGIN && y >= -WIDE_MARGIN && x < WIDE - WIDE_MARGIN && y < WIDE - WIDE_MARGIN;
  for (let y = -MARGIN; y < SIDE - MARGIN; y++) for (let x = -MARGIN; x < SIDE - MARGIN; x++) {
    body.copy(px, at(x, y) * 4, A.cell(x, y) * 4, A.cell(x, y) * 4 + 4);
  }
  const empty = (x, y) => px[at(x, y) * 4 + 3] === 0;
  const put = (x, y, ch, onlyEmpty) => {
    const rgb = RGB[ch];
    if (!rgb || !inWide(x, y) || (onlyEmpty && !empty(x, y))) return;
    px.set([...rgb, 255], at(x, y) * 4);
  };
  const paint = (g, onlyEmpty) => {
    for (let y = -MARGIN; y < SIDE - MARGIN; y++) for (let x = -MARGIN; x < SIDE - MARGIN; x++) put(x, y, A.get(g, x, y), onlyEmpty);
  };
  const paintLayer = (layer) => { for (const [k, ch] of layer) { const [x, y] = k.split(',').map(Number); put(x, y, ch, true); } };
  if (eyeClosed) {
    const [hx, hy] = [Math.round(pose.head.m[4]), Math.round(pose.head.m[5])];
    const set = ([x, y], ch) => { const i = at(x + hx, y + hy) * 4; if (px[i + 3]) px.set([...RGB[ch], 255], i); };
    EYE.open.forEach((p) => set(p, 'S'));
    EYE.lid.forEach((p) => set(p, 'k'));
  }
  // Wings hang from her upper back, which leans with the waist. The near wing
  // goes first so it covers the far one (both stay behind her body).
  const root = apply(bodyM, [JOINTS.backShoulder[0] + 1, JOINTS.backShoulder[1] + 2]).map(Math.round);
  if (open > 0) {
    const nearWing = new Map();
    paintWing(nearWing, root, { ...flutter, open });
    paintLayer(outlined(nearWing));
    const far = new Map();
    paintWing(far, [root[0] + 4, root[1] - 3], { ...flutter, rotate: flutter.rotate + 14, open, darker: true });
    paintLayer(outlined(far));
  }
  const behind = A.grid();
  if (arm) A.drawArm(behind, shoulder, arm);
  paint(A.outline(behind), true);
  if (drawn) {
    const bow = Buffer.alloc(px.length);
    // Adjacent stamps share a halo without stacking up translucent paint.
    lightBow(built, (x, y, ch, alpha) => {
      if (!inWide(x, y)) return;
      const i = at(x, y) * 4;
      if (alpha >= bow[i + 3]) bow.set([...RGB[ch], alpha], i);
    });
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0 && bow[i + 3]) bow.copy(px, i, i, i + 4);
    }
  }
  const front = A.grid();
  if (heldArrow) lightArrow(front, heldArrow.nock, heldArrow.toward);
  if (nock) lightArrow(front, nock, along);
  paint(front, false);
  return px;
}

// Rise: reach for the light arrow, nock, draw; wings unfurl.
const LEVEL = SERAPH_DIRECTIONS.find((d) => d.elevation === 0);
const RISE = [
  { key: 0, open: 0.15 }, { key: 0, open: 0.35 }, { key: 1, open: 0.55 }, { key: 1, open: 0.75 },
  { key: 2, open: 0.9 }, { key: 2, open: 1 }, { key: 3, open: 1 }, { key: 3, open: 1 },
].map((f, i) => renderSeraph(A.KEYS[f.key], LEVEL, { open: f.open, flutter: FLUTTER[i % 4], eyeClosed: f.key === 3 }));

const SETS = { seraphRise: RISE };
for (const direction of SERAPH_DIRECTIONS) {
  SETS[direction.frame] = FLUTTER.map((flutter) => renderSeraph(FULL_DRAW, direction, { flutter }));
}

const raw = (data) => sharp(data, { raw: { width: WIDE, height: WIDE, channels: 4 } });

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const big = WIDE * PREVIEW_SCALE;
  const rows = Object.entries(SETS);
  const cols = Math.max(...rows.map(([, frames]) => frames.length));
  const tiles = [];
  for (const [row, [, frames]] of rows.entries()) {
    for (const [i, px] of frames.entries()) {
      tiles.push({ input: await raw(px).resize(big, big, { kernel: 'nearest' }).png().toBuffer(), left: i * big, top: row * big });
    }
  }
  await sharp({ create: { width: big * cols, height: big * rows.length, channels: 4, background: '#8a9bb0' } })
    .composite(tiles).png().toFile(path.join(OUT_DIR, 'seraph-sheet.png'));
  // Level rise and hover at their respective game speeds.
  const dir = path.join(OUT_DIR, '.gif');
  fs.mkdirSync(dir, { recursive: true });
  const fps = 24;
  const order = [
    ...RISE.flatMap((_, i) => Array.from({ length: fps / 12 }, () => ['seraphRise', i])),
    ...Array.from({ length: 16 * fps / SERAPH_FLUTTER_FPS }, (_, i) => [LEVEL.frame, Math.floor(i * SERAPH_FLUTTER_FPS / fps) % 4]),
  ];
  for (const [n, [set, i]] of order.entries()) {
    await raw(SETS[set][i]).resize(big, big, { kernel: 'nearest' }).flatten({ background: '#8a9bb0' }).png()
      .toFile(path.join(dir, `${String(n).padStart(2, '0')}.png`));
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, '%02d.png'),
    '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse=dither=none', '-loop', '0', path.join(OUT_DIR, 'seraph-preview.gif')]);
  fs.rmSync(dir, { recursive: true });
  console.log(`wrote ${rows.length} sets to ${path.relative(ROOT, OUT_DIR)}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { SETS };
