// Body-relative mace grip/tip poses shared by rendering and authoritative hits.
const THORG_SWEEP = Object.freeze(require('./characters').characterDefinitions.thorg.stats.tuning.attack.sweep);
const THORG_ATTACK_FRAMES = require('./thorgAttackFrames.json');

function thorgAttackFrameAt(elapsed = 0) {
  let end = 0;
  for (const frame of THORG_ATTACK_FRAMES) {
    end += frame.durationMs;
    if (elapsed < end - 1e-8) return frame;
  }
  return THORG_ATTACK_FRAMES[THORG_ATTACK_FRAMES.length - 1];
}

function sampleThorgSweep({ x = 0, y = 0, direction = 1, scale = 1, legacy = false } = {}, progress = 0) {
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  if (!legacy) {
    // Use the displayed pose, including its grip, rather than an unrelated orbit.
    const frame = thorgAttackFrameAt(THORG_SWEEP.windupMs + t * THORG_SWEEP.strikeMs);
    const facing = direction < 0 ? -1 : 1;
    const world = ([px, py]) => ({ x: x + facing * px * scale,
      y: y - THORG_SWEEP.footOffset * (scale - 1) + py * scale });
    const grip = world(frame.grip), tip = world(frame.tip);
    return { ...tip, grip, tip, radius: frame.radius * scale,
      rotation: Math.atan2(tip.y - grip.y, tip.x - grip.x) - Math.PI / 2, behind: false };
  }
  // Smooth acceleration and recovery; one complete revolution touches both sides.
  const eased = t - Math.sin(2 * Math.PI * t) / (2 * Math.PI);
  const theta = eased * 2 * Math.PI;
  const dx = (direction < 0 ? -1 : 1) * THORG_SWEEP.radiusX * scale * Math.cos(theta);
  const dy = THORG_SWEEP.radiusY * scale * Math.sin(theta);
  return { x: x + dx, y: y - THORG_SWEEP.footOffset * (scale - 1) + THORG_SWEEP.centerY * scale + dy, rotation: Math.atan2(dy, dx) - Math.PI / 2, behind: dy < -1 };
}
// Gameplay reach deliberately exceeds the drawn mace without enlarging the art.
function sampleThorgHitbox(body = {}, progress = 0) {
  const { x = 0, y = 0, scale = 1 } = body;
  const pose = sampleThorgSweep(body, progress);
  const grip = pose.grip || { x,
    y: y - THORG_SWEEP.footOffset * (scale - 1) + THORG_SWEEP.centerY * scale };
  const dx = pose.x - grip.x, dy = pose.y - grip.y;
  const length = Math.hypot(dx, dy) || 1;
  const tip = pose.tip || { x: pose.x + dx / length * THORG_SWEEP.tipOffset * scale,
    y: pose.y + dy / length * THORG_SWEEP.tipOffset * scale };
  return { a: grip,
    b: { x: x + (tip.x - x) * THORG_SWEEP.hitboxReachScale, y: tip.y },
    radius: (pose.radius || THORG_SWEEP.hitboxRadius * scale) * THORG_SWEEP.hitboxHeightScale };
}
module.exports = { THORG_SWEEP, THORG_ATTACK_FRAMES, thorgAttackFrameAt, sampleThorgSweep, sampleThorgHitbox };
