const { getResolvedCharacterSpecialConfig } = require("../../../characters/characterTuning.js");

// Inferno's rise, shared by the server (which places a channelling Draven) and
// the client (which flies the owner and stages the ignite around these beats).
// Tuning lives in src/shared/characters/draven.json special.inferno.
const INFERNO = getResolvedCharacterSpecialConfig("draven", "inferno");

// Fractions of riseMs: he sinks into a crouch until `gather`, surges past his
// hover height until `apex`, then settles onto it by riseMs.
const INFERNO_RISE_BEATS = Object.freeze({ gather: 0.18, apex: 0.72 });

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const outQuad = (u) => 1 - (1 - u) ** 2;
const outCubic = (u) => 1 - (1 - u) ** 3;
const inOutSine = (u) => (1 - Math.cos(Math.PI * u)) / 2;

// Upward offset from the cast anchor, in px, `elapsedMs` into the channel.
function infernoLiftAt(elapsedMs, tuning = INFERNO) {
  const { riseMs, liftPx, riseDipPx = 0, riseOvershoot = 0, bobPx = 0, bobWaveMs = 1 } = tuning;
  const u = clamp01(Math.max(0, elapsedMs) / riseMs);
  const { gather, apex } = INFERNO_RISE_BEATS;
  const peak = liftPx * (1 + riseOvershoot);
  let lift;
  if (u < gather) lift = -riseDipPx * outQuad(u / gather);
  else if (u < apex) lift = -riseDipPx + (peak + riseDipPx) * outCubic((u - gather) / (apex - gather));
  else lift = peak - (peak - liftPx) * inOutSine((u - apex) / (1 - apex));
  // The hover bob fades in once he has settled, so it never fights the rise.
  const bobIn = clamp01((elapsedMs - riseMs) / 250);
  return lift + Math.sin(elapsedMs / bobWaveMs) * bobPx * bobIn;
}

module.exports = { INFERNO_RISE_BEATS, infernoLiftAt };
