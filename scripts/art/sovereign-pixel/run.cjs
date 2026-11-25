const { layersRig } = require('./rig.cjs');
const { mul, rotateAbout, translate } = require('../pixel-rig/rig.cjs');

const ART = 'running00';
const capeEdge = [36, 35, 33, 32, 31, 30, 29, 28, 27, 26, 24, 23, 22];
const isCape = (x, y) => y >= 40 && y <= 63 && x <= (capeEdge[y - 40] ?? 25);
const isFrontArm = (x, y) => x >= 54 && y >= 41 && y <= 50;
const rig = layersRig([
  ['cape', ART, isCape],
  ['farThigh', 'runThigh'], ['farShin', 'runShin'], ['farBoot', 'runBoot'],
  ['nearThigh', 'runThigh'], ['nearShin', 'runShin'], ['nearBoot', 'runBoot'],
  ['torso', ART, (x, y) => (y <= 55 || (y <= 58 && x >= 38 && x <= 47)) &&
    !isCape(x, y) && !isFrontArm(x, y)],
  ['frontArm', ART, isFrontArm],
]);

const SHADE = { H: 'Y', y: 'G', Y: 'o', G: 'O', O: 'b', g: 'd' };
const SOLE = 67;
const ANKLE_TO_SOLE = 5;
const BONE = 9;
const LENGTH = 24;
const JOINT = [5, 3];

function place(at, angle) {
  return mul(translate(at[0] - JOINT[0], at[1] - JOINT[1]), rotateAbout(JOINT, angle));
}

function bone(from, to) {
  const [dx, dy] = to.map((value, i) => value - from[i]);
  const angle = -Math.atan2(dx, dy) * 180 / Math.PI;
  return place(from, angle);
}

// One stance goes forward contact -> underneath -> rear toe-off. The other
// leg uses the same path half a cycle later, so their contacts alternate.
function feet(phase) {
  if (phase < 0.5) return [10 - 20 * (phase * 2), 0, 0];
  const swing = (phase - 0.5) * 2;
  return [-10 * Math.cos(Math.PI * swing), 9 * Math.sin(Math.PI * swing), 12 * Math.sin(2 * Math.PI * swing)];
}

function leg(hip, [step, lift, toe], center, swap) {
  const ankle = [center + step, SOLE - ANKLE_TO_SOLE - lift];
  const dx = ankle[0] - hip[0];
  const dy = ankle[1] - hip[1];
  const distance = Math.hypot(dx, dy);
  const bend = Math.sqrt(Math.max(0, BONE ** 2 - (distance / 2) ** 2));
  const knee = [(hip[0] + ankle[0]) / 2 + dy / distance * bend,
    (hip[1] + ankle[1]) / 2 - dx / distance * bend];
  return [
    { m: bone(hip, knee), swap },
    { m: bone(knee, ankle), swap },
    { m: place(ankle, toe), swap },
  ];
}

function runFrame(i) {
  const t = i / LENGTH;
  const phase = t * 2 * Math.PI;
  const bob = Math.round(1.1 * Math.cos(phase * 2 - 0.5));
  const [nearThigh, nearShin, nearBoot] = leg([44, 51 + bob], feet(t), 45);
  const [farThigh, farShin, farBoot] = leg([39, 51 + bob], feet((t + 0.5) % 1), 41, SHADE);
  return rig.renderPose({
    torso: { m: translate(0, bob) },
    frontArm: { m: mul(translate(0, bob), rotateAbout([52, 45], 5 * Math.cos(phase))) },
    cape: { warp: (x, y) => {
      // The shoulder stays fixed. A small wave trails toward the fur hem.
      const tail = Math.max(0, Math.min(1, (33 - x) / 23));
      return [x, y - bob - 2.5 * tail * Math.sin(phase * 2 - tail * 2.8)];
    } },
    farThigh, farShin, farBoot, nearThigh, nearShin, nearBoot,
  }, { patch: false });
}

function runFrames() {
  return Array.from({ length: LENGTH }, (_, i) => runFrame(i));
}

module.exports = { runFrames };
