function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function lerp(from, to, progress) {
  return from + (to - from) * progress;
}

function smoothstep(progress) {
  const t = clamp01(progress);
  return t * t * (3 - 2 * t);
}

module.exports = { clamp, clamp01, lerp, smoothstep };
