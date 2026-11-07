// Body-relative mace grip/tip poses shared by rendering and authoritative hits.
const THORG_SWEEP = Object.freeze(require('.').characterDefinitions.thorg.stats.tuning.attack.sweep);
const THORG_ATTACK_FRAMES = require('./thorgAttackFrames.json');

function thorgAttackFrameAt(elapsed = 0) {
  let end = 0;
  for (const frame of THORG_ATTACK_FRAMES) {
    end += frame.durationMs;
    if (elapsed < end - 1e-8) return frame;
  }
  return THORG_ATTACK_FRAMES[THORG_ATTACK_FRAMES.length - 1];
}

function sampleThorgSweep({ x = 0, y = 0, direction = 1, scale = 1 } = {}, progress = 0) {
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  // Use the displayed pose, including its grip, rather than an unrelated orbit.
  const frame = thorgAttackFrameAt(THORG_SWEEP.windupMs + t * THORG_SWEEP.strikeMs);
  const facing = direction < 0 ? -1 : 1;
  const world = ([px, py]) => ({ x: x + facing * px * scale,
    y: y - THORG_SWEEP.footOffset * (scale - 1) + py * scale });
  const grip = world(frame.grip), tip = world(frame.tip);
  return { ...tip, grip, tip, radius: frame.radius * scale,
    rotation: Math.atan2(tip.y - grip.y, tip.x - grip.x) - Math.PI / 2, behind: false };
}
// Gameplay reach deliberately exceeds the drawn mace without enlarging the art.
function sampleThorgHitbox(body = {}, progress = 0) {
  const { x = 0 } = body;
  const pose = sampleThorgSweep(body, progress);
  return { a: pose.grip,
    b: { x: x + (pose.tip.x - x) * THORG_SWEEP.hitboxReachScale, y: pose.tip.y },
    radius: pose.radius * THORG_SWEEP.hitboxHeightScale };
}

module.exports = { THORG_SWEEP, THORG_ATTACK_FRAMES, thorgAttackFrameAt, sampleThorgSweep, sampleThorgHitbox };
