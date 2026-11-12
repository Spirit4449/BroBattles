// Synthesized layers for the pre-fight countdown: a sub thump under each
// number, a rising noise sweep into FIGHT, and a boom on FIGHT itself. They
// sit under the existing beep/start samples on the shared (already unlocked)
// navigation AudioContext and follow the SFX volume setting.
import { getSettings } from "../../site/preferences.js";

function context() {
  try {
    const ctx = window.__BB_NAVIGATION__?.getAudioContext?.();
    if (!ctx) return null;
    if (ctx.state === "suspended") ctx.resume?.().catch?.(() => {});
    return ctx;
  } catch (_) {
    return null;
  }
}

function volume() {
  try {
    return Math.max(0, Math.min(1, Number(getSettings()?.sfx ?? 1)));
  } catch (_) {
    return 1;
  }
}

function output(ctx, gain) {
  const node = ctx.createGain();
  node.gain.value = gain * volume();
  node.connect(ctx.destination);
  return node;
}

let noiseBuffer = null;
function noise(ctx) {
  if (noiseBuffer?.sampleRate === ctx.sampleRate) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 2);
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

/** Sub-bass hit under a countdown number; `heat` 0..1 makes it heavier. */
export function playCountdownThump(heat = 0) {
  const ctx = context();
  if (!ctx || volume() <= 0) return;
  try {
    const t = ctx.currentTime;
    const out = output(ctx, 0.32 + heat * 0.28);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150 + heat * 40, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + 0.34);
  } catch (_) {}
}

/** Filtered noise that sweeps up for `durationMs`, landing on FIGHT. */
export function playCountdownRiser(durationMs = 3000) {
  const ctx = context();
  if (!ctx || volume() <= 0) return;
  try {
    const t = ctx.currentTime;
    const end = t + Math.max(0.2, durationMs / 1000);
    const out = output(ctx, 0.2);
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 3.5;
    filter.frequency.setValueAtTime(260, t);
    filter.frequency.exponentialRampToValueAtTime(5200, end);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, end - 0.04);
    env.gain.linearRampToValueAtTime(0, end);
    src.connect(filter).connect(env).connect(out);
    src.start(t);
    src.stop(end + 0.02);
  } catch (_) {}
}

/** Low boom plus a noise crack for FIGHT. */
export function playFightBoom() {
  const ctx = context();
  if (!ctx || volume() <= 0) return;
  try {
    const t = ctx.currentTime;
    const out = output(ctx, 0.55);
    const osc = ctx.createOscillator();
    const oscEnv = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.6);
    oscEnv.gain.setValueAtTime(0.0001, t);
    oscEnv.gain.exponentialRampToValueAtTime(1, t + 0.01);
    oscEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    osc.connect(oscEnv).connect(out);
    osc.start(t);
    osc.stop(t + 0.82);

    const crack = ctx.createBufferSource();
    crack.buffer = noise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(6000, t);
    filter.frequency.exponentialRampToValueAtTime(300, t + 0.45);
    const crackEnv = ctx.createGain();
    crackEnv.gain.setValueAtTime(0.5, t);
    crackEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    crack.connect(filter).connect(crackEnv).connect(out);
    crack.start(t);
    crack.stop(t + 0.52);
  } catch (_) {}
}
