// Canonical body-relative mace head trajectory, shared by rendering and hit truth.
const THORG_SWEEP = Object.freeze({ windupMs: 70, strikeMs: 560, radiusX: 95, radiusY: 26, centerY: 13, headWidth: 54, headHeight: 40, rageScale: 1.25, footOffset: 37.8 });
function sampleThorgSweep({ x = 0, y = 0, direction = 1, scale = 1 } = {}, progress = 0) {
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  // Smooth acceleration and recovery; one complete revolution touches both sides.
  const eased = t - Math.sin(2 * Math.PI * t) / (2 * Math.PI);
  const theta = eased * 2 * Math.PI;
  const dx = (direction < 0 ? -1 : 1) * THORG_SWEEP.radiusX * scale * Math.cos(theta);
  const dy = THORG_SWEEP.radiusY * scale * Math.sin(theta);
  return { x: x + dx, y: y - THORG_SWEEP.footOffset * (scale - 1) + THORG_SWEEP.centerY * scale + dy, rotation: Math.atan2(dy, dx) - Math.PI / 2, behind: dy < -1 };
}
module.exports = { THORG_SWEEP, sampleThorgSweep };
