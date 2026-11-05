// Leg rig shared by poses that move the legs far from the idle stance (run, death):
// the front leg's thigh + boot used as a two-bone chain hanging from any hip.
const { JOINTS, PARTS } = require('./parts.cjs');
const { mul, translate, rotateAbout, apply } = require('./render.cjs');

const angleOf = (from, to) => (Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const THIGH_LEN = dist(JOINTS.frontHip, JOINTS.frontKnee);
const SHIN_LEN = dist(JOINTS.frontKnee, JOINTS.frontAnkle);
const REST_THIGH = angleOf(JOINTS.frontHip, JOINTS.frontKnee);
const REST_SHIN = angleOf(JOINTS.frontKnee, JOINTS.frontAnkle);
const SOLE_FROM_ANKLE = [1.5, 3.5]; // template boot: sole centre relative to the ankle
const GROUND = JOINTS.feet + 0.5; // centre of the bottom pixel row

// Rotation that turns the template's thigh / shin to an absolute angle (degrees
// from vertical, + = forward). Screen rotation is clockwise-positive, which
// swings a hanging limb backward.
function legChain(hip, thigh, shin) {
  const thighM = mul(translate(hip[0] - JOINTS.frontHip[0], hip[1] - JOINTS.frontHip[1]),
    rotateAbout(JOINTS.frontHip, REST_THIGH - thigh));
  const bootM = mul(thighM, rotateAbout(JOINTS.frontKnee, (REST_SHIN - shin) - (REST_THIGH - thigh)));
  return { thighM, bootM };
}

// Two-bone IK: put the ankle on `target`, knee bending forward (to the front of
// the hip-ankle line), the leg straight if the target is out of reach.
function reach(hip, target) {
  const dx = target[0] - hip[0]; const dy = target[1] - hip[1];
  const d = Math.min(THIGH_LEN + SHIN_LEN - 1e-3, Math.max(Math.abs(THIGH_LEN - SHIN_LEN) + 1e-3, Math.hypot(dx, dy)));
  const ux = dx / Math.hypot(dx, dy); const uy = dy / Math.hypot(dx, dy);
  const along = (THIGH_LEN ** 2 + d ** 2 - SHIN_LEN ** 2) / (2 * d);
  const out = Math.sqrt(Math.max(0, THIGH_LEN ** 2 - along ** 2));
  const knee = [hip[0] + ux * along + uy * out, hip[1] + uy * along - ux * out];
  const ankle = [hip[0] + ux * d, hip[1] + uy * d];
  return legChain(hip, angleOf(hip, knee), angleOf(knee, ankle));
}

const BOOT_PIXELS = PARTS.frontBoot.rows.flatMap((row, y) => [...row].flatMap((ch, x) =>
  (ch === '.' ? [] : [[PARTS.frontBoot.at[0] + x + 0.5, PARTS.frontBoot.at[1] + y + 0.5]])));
const lowestBootY = (m) => Math.max(...BOOT_PIXELS.map((p) => apply(m, p)[1]));

module.exports = { angleOf, legChain, reach, lowestBootY, GROUND, SOLE_FROM_ANKLE };
