#!/usr/bin/env node
// Huntress idle: 10 frames at 8 fps, matching the idle row in animations.json.
// A ready-stance breath: the hips dip and the torso leans in while the feet stay
// planted (knees bend outward), and every loose part trails the body by a bit
// more than its parent: back arm shoulder -> elbow -> wrist, bow arm -> bow,
// head -> hanging hair. Phases are fractions of the loop. renderPose rebuilds
// the outline afterwards so rotated parts keep clean 1px edges.
//   node scripts/art/huntress-pixel/idle.cjs   -> output/huntress-pixel/idle/
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { SIZE, JOINTS } = require('./parts.cjs');
const { renderPose, mul, translate, rotateAbout, apply } = require('./render.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'output/huntress-pixel/idle');
const FPS = 8;
const PREVIEW_SCALE = 6;

const FRAME_COUNT = 10;
const DROP = 3; // px the hips dip at the bottom of the breath
const LEAN = 2.5; // degrees the torso tips toward the bow
const KNEE_SPREAD = 0.7; // how far the knees push outward per px of dip

function idlePose(frame) {
  const t = frame / FRAME_COUNT;
  const wave = (lag) => Math.sin(2 * Math.PI * (t - lag));
  const dip = (lag) => (1 - Math.cos(2 * Math.PI * (t - lag))) / 2;
  const bodyAt = (lag) => mul(translate(0, DROP * dip(lag)), rotateAbout(JOINTS.hip, LEAN * dip(lag)));

  // The head rides the lean without rotating so the face stays crisp.
  const carried = (lag, joint) => {
    const [x, y] = apply(bodyAt(lag), joint);
    return translate(x - joint[0], y - joint[1]);
  };

  const body = bodyAt(0);
  const head = carried(0.08, JOINTS.neck);
  const backUpper = mul(body, rotateAbout(JOINTS.backShoulder, 5 * wave(0.12)));
  const backFore = mul(backUpper, rotateAbout(JOINTS.backElbow, 7 * wave(0.22)));
  const backHand = mul(backFore, rotateAbout(JOINTS.backWrist, 10 * wave(0.32)));
  const frontArm = mul(body, rotateAbout(JOINTS.frontShoulder, -3 * wave(0.1)));
  const bow = mul(frontArm, rotateAbout(JOINTS.grip, 3 * wave(0.22)));

  const drop = DROP * dip(0);
  const top = JOINTS.legTop; const span = JOINTS.feet - top;
  const leg = (side) => (x, y) => {
    const sy = y < top + drop ? y - drop : top + ((y - top - drop) * span) / (span - drop);
    const knee = Math.sin((Math.PI * Math.min(span, Math.max(0, sy - top))) / span);
    return [x - side * KNEE_SPREAD * drop * knee, sy];
  };

  return {
    torso: { m: body },
    skirt: { m: body },
    quiver: { m: mul(bodyAt(0.1), rotateAbout(JOINTS.quiverStrap, 2 * wave(0.2))) },
    head: { m: head },
    hairBack: { m: mul(carried(0.16, JOINTS.neck), rotateAbout(JOINTS.hairRoot, 4 * wave(0.28))) },
    backUpper: { m: backUpper },
    backFore: { m: backFore },
    backHand: { m: backHand },
    frontArm: { m: frontArm },
    bow: { m: bow },
    bowHand: { m: bow },
    backLeg: { warp: leg(-1) },
    frontThigh: { warp: leg(1) },
    frontBoot: { warp: leg(1) },
  };
}

const FRAMES = Array.from({ length: FRAME_COUNT }, (_, i) => renderPose(idlePose(i)));
const raw = (data, width, height = width) => sharp(data, { raw: { width, height, channels: 4 } });

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const names = [];
  for (const [i, px] of FRAMES.entries()) {
    const name = `idle${String(i).padStart(2, '0')}.png`;
    await raw(px, SIZE).png().toFile(path.join(OUT_DIR, name));
    await raw(px, SIZE).resize(SIZE * PREVIEW_SCALE, SIZE * PREVIEW_SCALE, { kernel: 'nearest' })
      .flatten({ background: '#ffffff' }).png().toFile(path.join(OUT_DIR, `big-${name}`));
    names.push(name);
  }
  await sharp({ create: { width: SIZE * FRAMES.length, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(names.map((name, i) => ({ input: path.join(OUT_DIR, name), left: i * SIZE, top: 0 })))
    .png().toFile(path.join(OUT_DIR, 'idle-strip.png'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(OUT_DIR, 'big-idle%02d.png'),
    '-vf', 'split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=none', '-loop', '0', path.join(OUT_DIR, 'idle-preview.gif')]);
  for (const name of names) fs.rmSync(path.join(OUT_DIR, `big-${name}`));
  console.log(`wrote ${FRAMES.length} frames, idle-strip.png and idle-preview.gif to ${path.relative(ROOT, OUT_DIR)}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { FPS, FRAMES, idlePose };
