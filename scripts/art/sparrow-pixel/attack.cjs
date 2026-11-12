#!/usr/bin/env node
// Sparrow attack: 6 frames, matching attack00-05 in animations.json (played at
// 24 fps for the basic shot; the special replays them as 00 01 02 02 03 04 05),
// plus the same six aimed high, up, down and low (attackHigh00-05, ...).
//   00 reach back over the shoulder for an arrow  03 full draw: string to the chin
//   01 lift it overhead                            04 release: hand flies back
//   02 nock it across the levelled bow             05 recover, bow coming down
// Like the legacy sheet she shoots standing tall: feet together and planted,
// legs straight, the bow raised level so the arrow sits at shoulder height.
// The body art only has bent running legs, so the standing legs are drawn here.
// The drawing arm, the arrow and the pulled string are painted per frame (the
// rest-pose art has none of them). The drawing arm is the far arm, so it paints
// only where nothing else is drawn.
//   node scripts/art/sparrow-pixel/attack.cjs   -> output/sparrow-pixel/attack/
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { SIZE, PALETTE, JOINTS } = require('./parts.cjs');
const { renderPose, mul, translate, rotateAbout, apply } = require('./render.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'output/sparrow-pixel/attack');
// Frames are exported square with the body canvas centred, the convention the
// sheet packer reads (it centres a larger canvas over the 64px art). The margin
// leaves room for the nocked arrow past the bow and the arrow lifted overhead.
const MARGIN = 16; // room for the bow tipped to a high or low shot
const SIDE = SIZE + MARGIN * 2;
const PREVIEW_SCALE = 6;

const RGB = Object.fromEntries(Object.entries(PALETTE).map(([ch, hex]) => [ch, [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))]));

// The rest bow string ('kbk', x 46-48) between the limb tips; drawn frames erase it.
const STRING = { x0: 46, x1: 49, y0: 14, y1: 53 };
const BOW_TOP = [46.5, 8.5];
const BOW_BOTTOM = [48, 58];
const ARROW_LENGTH = 22;
// Standing legs. The body art only has the bent running leg (its knee cuff and
// foot are drawn for a lunge), and no straightening of it reads as a standing
// leg, so these are drawn directly in the body's colours and lighting (lit from
// the front, like the other boots): a straight legging from the hip, a cuffed
// boot, a flat foot pointing forward. Rows run from just under the hip to the
// sole; the outline pass adds the sole line on the ground row. The back leg is
// the same leg one shade darker, standing a few px behind.
const STAND_LIFT = -2; // px taller than the idle crouch
const LEG = [
  ...Array(12).fill('Bbbo'), // legging, mostly under the skirt
  'Ggmll', 'GGgmm', // boot cuff
  ...Array(5).fill('GGgm'), // shaft
  'GGgmm', 'GGGgmm', 'GGGggmml', 'GGGGGGGg', // foot
];
const LEG_TOP = JOINTS.feet - LEG.length; // first legging row; the sole outline lands on the ground row
const NEAR_LEG_X = 34; // left edge of the front leg, under the near hip
const FAR_LEG_X = 28; // back leg, behind the far hip
const DARKER = { l: 'm', m: 'g', g: 'G', o: 'b', b: 'B' };

// Keyframes. lean: px the upper body sways back (whole pixels only: rotating
// the torso smears its shading). aim: bow-arm
// raise in degrees (negative is up). flex: px the limb tips bend toward the
// archer. arm: drawing arm joints in rest-pose px (they move with the body).
// nock: where the arrow's back end sits; 'string' = on the resting string, a
// number = drawn back to that x. Arrows ride the bow hand's height.
// turn: how much of an angled shot's aim the frame takes (the bow swings onto
// the aim while she nocks, holds it through the release, and eases off).
// follow: how far the drawing arm swings with the bow (1 while on the string).
const KEYS = [
  { lean: 0, aim: -8, flex: 0, turn: 0.35, arm: { elbow: [18, 23], hand: [24, 14] } },
  { lean: 0, aim: -14, flex: 0, turn: 0.6, arm: { elbow: [21, 19], hand: [30, 10] },
    arrow: { nock: [30, 9], toward: [8, 5] } },
  { lean: 0, aim: -20, flex: 0.5, turn: 1, follow: 1, arm: { elbow: [22, 27], hand: [45, 33] }, nock: 'string' },
  { lean: -1, aim: -20, flex: 1.5, turn: 1, follow: 1, arm: { elbow: [16, 29], hand: [38, 32] }, nock: 38 },
  { lean: 0, aim: -20, flex: 0, turn: 1, follow: 0.4, arm: { elbow: [18, 27], hand: [11, 25], open: true } },
  { lean: 0, aim: -10, flex: 0, turn: 0.6, restArm: { shoulder: 22, elbow: 12 } },
];

// Angled shots, like the ninja's directional throws. The level shot is the six
// keys above; each other direction swings the whole draw (bow arm, bow, string,
// arrow and the drawing hand) about the bow shoulder, after she bends at the
// waist for part of the aim, as an archer does: leaning back for a high shot,
// over for a low one. Directions and frame names come from the game's pose
// table so the art and the picker agree.
const { DIRECTIONS } = require('../../../src/client/game/characters/sparrow/aimPoses.js');
const DRAW_LENGTH = 17; // px from the anchor at her chin to the bow grip at full draw
const ANCHOR_CLEAR = 6; // px the anchor moves forward at a straight-up aim
const FOREARM_TIP = 0.45; // how much shorter the drawing forearm looks at a steep aim
const WAIST_SHARE = 0.4; // share of the elevation taken by the waist; the arms take the rest
const SKIRT_SHARE = 0.4; // the skirt follows the waist this much, so the hem stays over the legs

function attackPose(key, direction = DIRECTIONS.find((d) => !d.key)) {
  // The level draw is laid out upright, as before; an angled shot then bends the
  // body at the waist and swings the draw (bow arm, bow, string, arrow, drawing
  // hand) about the bow shoulder. Screen rotation is clockwise-positive, so
  // aiming up is a negative turn.
  const aimTurn = -direction.elevation * key.turn;
  const waist = aimTurn * WAIST_SHARE;
  const upright = translate(key.lean, STAND_LIFT);
  const hip = apply(upright, JOINTS.hip);
  const bend = rotateAbout(hip, waist);
  const body = mul(bend, upright);
  const skirt = mul(rotateAbout(hip, waist * SKIRT_SHARE), upright);
  const level = mul(upright, rotateAbout(JOINTS.frontShoulder, key.aim));
  const [gx, gy] = apply(level, JOINTS.grip);
  const bowShift = [Math.round(gx - JOINTS.grip[0]), Math.round(gy - JOINTS.grip[1])];
  // The anchor (the nock at full draw, by her chin) rides the waist; the bow sits
  // DRAW_LENGTH out from it along the aim, and the bow arm turns at the shoulder
  // to reach it. A level shot lands exactly on the level layout.
  // Aiming up, the anchor slides forward off her face so the arrow clears it.
  const rise = Math.max(0, Math.sin((-aimTurn * Math.PI) / 180));
  const anchor = apply(bend, [gx - DRAW_LENGTH + ANCHOR_CLEAR * rise, gy + 2 * rise]);
  const aimDir = [Math.cos((aimTurn * Math.PI) / 180), Math.sin((aimTurn * Math.PI) / 180)];
  const grip = [anchor[0] + aimDir[0] * DRAW_LENGTH, anchor[1] + aimDir[1] * DRAW_LENGTH];
  const draw = mul(rotateAbout(grip, aimTurn), translate(grip[0] - gx, grip[1] - gy));
  const undraw = mul(translate(gx - grip[0], gy - grip[1]), rotateAbout(grip, -aimTurn));
  const shoulderAt = apply(body, JOINTS.frontShoulder);
  const armGrip = apply(mul(bend, level), JOINTS.grip);
  const heading = (v) => Math.atan2(v[1] - shoulderAt[1], v[0] - shoulderAt[0]) * 180 / Math.PI;
  const bowArm = mul(rotateAbout(shoulderAt, heading(grip) - heading(armGrip)), mul(bend, level));
  const half = (BOW_BOTTOM[1] - BOW_TOP[1]) / 2;
  const drawn = typeof key.nock === 'number';
  const bowWarp = (ox, oy) => {
    const [x, y] = apply(undraw, [ox, oy]);
    const rx = x - bowShift[0]; const ry = y - bowShift[1];
    const reach = Math.min(1, Math.abs(ry - JOINTS.grip[1]) / half);
    const sx = rx + key.flex * reach * reach;
    if (drawn && sx >= STRING.x0 && sx < STRING.x1 && ry >= STRING.y0 && ry < STRING.y1) return [-99, -99];
    return [sx, ry];
  };
  const carried = (joint) => {
    const [x, y] = apply(body, joint);
    return translate(Math.round(x - joint[0]), Math.round(y - joint[1]));
  };
  const pose = {
    backLeg: { hidden: true }, frontThigh: { hidden: true }, frontBoot: { hidden: true },
    torso: { m: body },
    skirt: { m: skirt },
    quiver: { m: body },
    head: { m: carried(JOINTS.neck) }, hairBack: { m: carried(JOINTS.neck) },
    frontArm: { m: bowArm }, bow: { warp: bowWarp }, bowHand: { m: mul(draw, translate(...bowShift)) },
  };
  if (key.restArm) {
    const upper = mul(body, rotateAbout(JOINTS.backShoulder, key.restArm.shoulder));
    const fore = mul(upper, rotateAbout(JOINTS.backElbow, key.restArm.elbow));
    Object.assign(pose, { backUpper: { m: upper }, backFore: { m: fore }, backHand: { m: fore } });
  } else {
    Object.assign(pose, { backUpper: { hidden: true }, backFore: { hidden: true }, backHand: { hidden: true } });
  }
  // Level-draw points (upright, rest-canvas px) to where they are drawn.
  const drawnAt = (p) => apply(draw, p).map(Math.round);
  const tip = (p) => apply(draw, [p[0] + bowShift[0] - key.flex, p[1] + bowShift[1]]);
  const at = (p) => apply(upright, p).map(Math.round);
  const onBody = (p) => apply(bend, p).map(Math.round);
  const arrowY = Math.round(gy) - 1;
  const levelNock = key.nock === 'string' ? [STRING.x0 + 1 + bowShift[0], arrowY]
    : drawn ? [at([key.nock, 0])[0], arrowY] : null;
  // A drawing hand on the string swings with the draw; `follow` below 1 lets a
  // released hand lag between the body and the draw.
  const follow = key.follow ?? 0;
  const armAt = (p) => {
    const [bx, by] = apply(bend, at(p)); const [dx, dy] = apply(draw, at(p));
    return [Math.round(bx + (dx - bx) * follow), Math.round(by + (dy - by) * follow)];
  };
  // On the string the forearm lies along the arrow; tipped up or down it is
  // drawn shorter, as the elbow swings out of the picture plane.
  const drawArm = (arm) => {
    const hand = armAt(arm.hand);
    if (follow < 1) return { ...arm, elbow: armAt(arm.elbow), hand };
    const [lx, ly] = [at(arm.hand)[0] - at(arm.elbow)[0], at(arm.hand)[1] - at(arm.elbow)[1]];
    const fore = Math.hypot(lx, ly) * (1 - FOREARM_TIP * Math.abs(Math.sin((aimTurn * Math.PI) / 180)));
    const back = apply(draw, [at(arm.hand)[0] - lx, at(arm.hand)[1] - ly]);
    const unit = Math.hypot(back[0] - hand[0], back[1] - hand[1]) || 1;
    return { ...arm, hand, elbow: [0, 1].map((i) => Math.round(hand[i] + ((back[i] - hand[i]) / unit) * fore)) };
  };
  return {
    pose, drawn, bowTop: tip(BOW_TOP), bowBottom: tip(BOW_BOTTOM),
    nock: levelNock && drawnAt(levelNock),
    along: levelNock && apply(draw, [levelNock[0] + 40, levelNock[1]]),
    shoulder: apply(body, JOINTS.backShoulder),
    arm: key.arm && drawArm(key.arm),
    heldArrow: key.arrow && { nock: onBody(at(key.arrow.nock)), toward: onBody(at(key.arrow.toward)) },
  };
}

// --- painting on a char grid -------------------------------------------------
// Grids cover the whole exported square; coordinates stay in rest-canvas px, so
// the margin around the body (x, y < 0 or > 63) is paintable too.
const grid = () => new Array(SIDE * SIDE).fill('.');
const inside = (x, y) => x >= -MARGIN && y >= -MARGIN && x < SIDE - MARGIN && y < SIDE - MARGIN;
const cell = (x, y) => (y + MARGIN) * SIDE + x + MARGIN;
const put = (g, x, y, ch) => { if (inside(x, y)) g[cell(x, y)] = ch; };
const get = (g, x, y) => (inside(x, y) ? g[cell(x, y)] : '.');

function line(g, [x0, y0], [x1, y1], ch) {
  const pts = [];
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps); const y = Math.round(y0 + ((y1 - y0) * i) / steps);
    if (!pts.length || pts.at(-1)[0] !== x || pts.at(-1)[1] !== y) pts.push([x, y]);
  }
  for (const [x, y] of pts) put(g, x, y, ch);
  return pts;
}

// A limb segment shaded like the body art: lit along its upper edge, shadowed below.
function limb(g, a, b, radius, [light, mid, dark]) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(dx, dy) || 1;
  let [nx, ny] = [-dy / len, dx / len];
  if (ny > 0) [nx, ny] = [-nx, -ny]; // normal points up
  for (let y = Math.floor(Math.min(a[1], b[1]) - radius - 1); y <= Math.max(a[1], b[1]) + radius + 1; y++) {
    for (let x = Math.floor(Math.min(a[0], b[0]) - radius - 1); x <= Math.max(a[0], b[0]) + radius + 1; x++) {
      const px = x + 0.5; const py = y + 0.5;
      const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (len * len)));
      const cx = a[0] + dx * t; const cy = a[1] + dy * t;
      if (Math.hypot(px - cx, py - cy) > radius) continue;
      const side = (px - cx) * nx + (py - cy) * ny; // + is the lit side
      put(g, x, y, side > radius * 0.35 ? light : side < -radius * 0.35 ? dark : mid);
    }
  }
}

function outline(g) {
  const out = g.slice();
  for (let y = -MARGIN; y < SIDE - MARGIN; y++) for (let x = -MARGIN; x < SIDE - MARGIN; x++) {
    if (get(g, x, y) !== '.') continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => get(g, x + dx, y + dy) !== '.')) put(out, x, y, 'k');
  }
  return out;
}

// Wood shaft with a dark underside, a grey head and green fletching.
function arrow(g, nock, toward) {
  const [dx, dy] = [toward[0] - nock[0], toward[1] - nock[1]];
  const len = Math.hypot(dx, dy);
  const tip = [Math.round(nock[0] + (dx / len) * ARROW_LENGTH), Math.round(nock[1] + (dy / len) * ARROW_LENGTH)];
  const shaft = line(g, nock, tip, 'o');
  for (const [x, y] of shaft) if (get(g, x, y + 1) === '.') put(g, x, y + 1, 'k');
  // Head: a bright tip and a grey pixel behind it, outlined on its own so it
  // holds together at any angle.
  const [hx, hy] = tip;
  const [bx, by] = shaft[Math.max(0, shaft.length - 2)];
  put(g, hx, hy, 'W'); put(g, bx, by, 'i');
  for (const [cx, cy] of [[hx, hy], [bx, by]]) for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (get(g, cx + ox, cy + oy) === '.') put(g, cx + ox, cy + oy, 'k');
  }
  // Vanes sit on the shaft's two sides, one step behind the nock end.
  const [px, py] = [-dy / len, dx / len];
  for (let i = 1; i <= 3; i++) {
    const [fx, fy] = shaft[Math.min(i, shaft.length - 1)];
    put(g, Math.round(fx - px), Math.round(fy - py), 'l'); put(g, Math.round(fx + px), Math.round(fy + py), 'g');
  }
}

function drawLeg(g, left, shade) {
  LEG.forEach((row, i) => [...row].forEach((ch, x) => put(g, left + x, LEG_TOP + i, shade ? DARKER[ch] || ch : ch)));
}

function drawArm(g, shoulder, { elbow, hand, open }) {
  limb(g, shoulder, elbow, 1.4, ['S', 'S', 's']);
  limb(g, elbow, hand, 1.5, ['l', 'm', 'G']);
  const [hx, hy] = hand.map(Math.round);
  for (const [x, y, ch] of [[0, 0, 'S'], [1, 0, 'S'], [0, 1, 's'], [-1, 0, 'S'], [0, -1, 'S'], [1, 1, 's']]) put(g, hx + x, hy + y, ch);
  if (open) { put(g, hx - 2, hy - 1, 'S'); put(g, hx - 2, hy + 1, 's'); }
}

// ------------------------------------------------------------------------------
function renderAttack(key, direction) {
  const { pose, nock, along, drawn, bowTop, bowBottom, shoulder, arm, heldArrow } = attackPose(key, direction);
  const body = renderPose(pose);
  const px = Buffer.alloc(SIDE * SIDE * 4);
  for (let y = 0; y < SIZE; y++) body.copy(px, cell(0, y) * 4, y * SIZE * 4, (y + 1) * SIZE * 4);
  const empty = (x, y) => px[cell(x, y) * 4 + 3] === 0;
  const paint = (g, onlyEmpty) => {
    for (let y = -MARGIN; y < SIDE - MARGIN; y++) for (let x = -MARGIN; x < SIDE - MARGIN; x++) {
      const rgb = RGB[get(g, x, y)];
      if (!rgb || (onlyEmpty && !empty(x, y))) continue;
      const i = cell(x, y) * 4;
      px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = 255;
    }
  };

  const nearLeg = grid(); drawLeg(nearLeg, NEAR_LEG_X, false);
  const farLeg = grid(); drawLeg(farLeg, FAR_LEG_X, true);
  paint(outline(nearLeg), true);
  paint(outline(farLeg), true);

  const behind = grid();
  if (arm) drawArm(behind, shoulder, arm);
  paint(outline(behind), true);
  const front = grid();
  if (drawn) {
    line(front, bowTop.map(Math.round), nock, 'b');
    line(front, nock, bowBottom.map(Math.round), 'b');
  }
  if (heldArrow) arrow(front, heldArrow.nock, heldArrow.toward);
  if (nock) arrow(front, nock, along);
  paint(front, false);
  return px;
}

// Frames per direction, keyed by atlas frame prefix (attack, attackHigh, ...).
const SETS = Object.fromEntries(DIRECTIONS.map((d) => [d.frame, KEYS.map((key) => renderAttack(key, d))]));
const FRAMES = SETS.attack;
const raw = (data) => sharp(data, { raw: { width: SIDE, height: SIDE, channels: 4 } });

async function gif(name, order, fps, frames = FRAMES) {
  const dir = path.join(OUT_DIR, `.${name}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [n, i] of order.entries()) {
    await raw(frames[i]).resize(SIDE * PREVIEW_SCALE, SIDE * PREVIEW_SCALE, { kernel: 'nearest' })
      .flatten({ background: '#ffffff' }).png().toFile(path.join(dir, `${String(n).padStart(2, '0')}.png`));
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, '%02d.png'),
    '-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse=dither=none', '-loop', '0', path.join(OUT_DIR, `${name}.gif`)]);
  fs.rmSync(dir, { recursive: true });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // One strip row per direction, high at the top.
  const crops = [];
  for (const [row, [prefix, frames]] of Object.entries(SETS).entries()) {
    for (const [i, px] of frames.entries()) {
      const crop = await raw(px).png().toBuffer();
      await sharp(crop).toFile(path.join(OUT_DIR, `${prefix}${String(i).padStart(2, '0')}.png`));
      crops.push({ input: crop, left: i * SIDE, top: row * SIDE });
    }
    if (prefix !== 'attack') await gif(`${prefix}-preview`, [0, 1, 2, 3, 4, 5, 5, 5, 5, 5], 24, frames);
  }
  await sharp({ create: { width: SIDE * KEYS.length, height: SIDE * DIRECTIONS.length, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(crops).png().toFile(path.join(OUT_DIR, 'attack-strip.png'));
  // Basic shot at game speed, held on the last frame like the idle blend, plus the special's timing.
  await gif('attack-preview', [0, 1, 2, 3, 4, 5, 5, 5, 5, 5], 24);
  await gif('special-preview', [0, 1, 2, 2, 3, 4, 5, 5, 5, 5], 20);
  console.log(`wrote ${FRAMES.length} frames (${SIDE}x${SIDE}), strip and previews to ${path.relative(ROOT, OUT_DIR)}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { FRAMES, SETS, KEYS };
