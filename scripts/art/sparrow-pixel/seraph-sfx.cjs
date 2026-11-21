#!/usr/bin/env node
// Generate Seraph's bow charge and release. Run with --install to
// copy the MP3s into public/assets/sparrow. Requires FFmpeg with libmp3lame.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SERAPH } = require('../../../src/shared/characters/sparrowLightBolt');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'output/sparrow-pixel/sfx');
const ASSETS = path.join(ROOT, 'public/assets/sparrow');
const SAMPLE_RATE = 48000;
const TAU = Math.PI * 2;
const AIM_PHASE_SECONDS = SERAPH.aimMs / 1000;
const AIM_SECONDS = AIM_PHASE_SECONDS + SERAPH.releaseGraceMs / 1000 + 1.75;
const stereo = seconds => Array.from({ length: 2 }, () => new Float32Array(Math.round(seconds * SAMPLE_RATE)));
const midiHz = note => 440 * 2 ** ((note - 69) / 12);
const decay = (t, attack, tail) => Math.min(1, t / attack) * Math.exp(-t / tail);

function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32 * 2 - 1;
  };
}

// Bands of upper harmonics give the choir its open vowel. Rougher voices
// add a low undertone and move the harmonics with a slow growl.
const VOWEL = [1, 0.58, 0.32, 0.25, 0.16, 0.1];
function choir(out, note, { duration, at = 0, pan, gain, vibrato, phase, envelope, grit = 0 }) {
  const periods = Math.round(midiHz(note) * duration);
  const start = Math.round(at * SAMPLE_RATE);
  const count = Math.round(duration * SAMPLE_RATE);
  for (let k = 0; k < count; k++) {
    const t = k / SAMPLE_RATE;
    const u = k / count * TAU;
    const base = periods * u + phase;
    const angle = base + 0.13 * Math.sin(TAU * vibrato * t + phase) + grit * Math.sin(base * 0.49);
    let sample = grit * 0.3 * Math.sin(base * 0.5);
    for (const [i, weight] of VOWEL.entries()) {
      const harmonic = i + 1;
      sample += weight * Math.sin(angle * harmonic) * (1 + 0.17 * Math.sin(u + harmonic + phase));
    }
    const i = start + k;
    if (i >= out[0].length) break;
    const value = gain * envelope(t) * sample;
    out[0][i] += value * pan;
    out[1][i] += value * (1 - pan);
  }
}

function aim() {
  const out = stereo(AIM_SECONDS);
  const progress = t => Math.min(1, t / AIM_PHASE_SECONDS);
  const tail = t => Math.min(1, (AIM_SECONDS - t) / 0.55);
  for (const [note, pan, gain, vibrato, phase, grit, enters] of [
    [38, 0.52, 0.13, 3.0, 1.1, 0.4, 0],
    [50, 0.53, 0.14, 3.6, 0.3, 0.37, 0],
    [44, 0.7, 0.095, 4.7, 0.5, 0.68, 0.12],
    [51, 0.31, 0.084, 5.1, 1.5, 0.53, 0.35],
    [56, 0.74, 0.085, 5.2, 2.2, 0.65, 0.54],
    [61, 0.37, 0.055, 5.8, 1.8, 0.55, 0.67],
  ]) {
    choir(out, note, { duration: AIM_SECONDS, pan, gain, vibrato, phase, grit,
      envelope: t => {
        const charge = progress(t);
        const entry = enters === 0 ? 1 : Math.min(1, Math.max(0, (charge - enters) / 0.3));
        return entry * (0.61 + 0.33 * charge) * (0.94 + 0.06 * Math.sin(t * 2 + phase)) * tail(t);
      } });
  }
  // A rounded, rising hum flutters faster above the darker pressure pulse.
  const noise = random(7483);
  let rumblePhase = 0, tremorPhase = 0, risePhase = 0;
  let air = 0, lowAir = 0;
  for (let i = 0; i < out[0].length; i++) {
    const t = i / SAMPLE_RATE, charge = progress(t);
    const urgency = charge ** 2;
    rumblePhase += TAU * (43 + 19 * urgency) / SAMPLE_RATE;
    tremorPhase += TAU * (1.65 + 9.2 * urgency) / SAMPLE_RATE;
    risePhase += TAU * (146.8 + 146.8 * urgency) / SAMPLE_RATE;
    air += (noise() - air) * (0.032 + 0.06 * urgency);
    lowAir += (air - lowAir) * 0.008;
    const pulse = 0.66 + 0.34 * Math.sin(tremorPhase);
    const pressure = (0.016 + 0.101 * charge ** 1.6) * pulse;
    const rumble = pressure * (Math.sin(rumblePhase) + 0.47 * Math.sin(rumblePhase * 3));
    const vowel = risePhase + 0.16 * Math.sin(tremorPhase);
    const humLevel = 0.14 * urgency * (0.77 + 0.23 * Math.sin(tremorPhase + 0.4));
    const hum = (Math.sin(vowel) + 0.27 * Math.sin(vowel * 2) + 0.13 * Math.sin(vowel * 3)) * humLevel;
    const harmony = 0.39 * humLevel * Math.sin(vowel * 1.5 + 0.25 * Math.sin(t * 5));
    const upperVoice = 0.11 * humLevel * Math.sin(vowel * 2.5 - 0.23 * Math.sin(t * 4.7));
    const breath = (air - lowAir) * (0.023 + 0.065 * urgency) * pulse;
    out[0][i] += (rumble + hum + 0.55 * harmony + upperVoice + breath) * tail(t);
    out[1][i] += (rumble + 0.85 * hum + harmony + 0.53 * upperVoice + 0.84 * breath) * tail(t);
  }
  return out;
}

function release() {
  const duration = 4.15;
  const out = stereo(duration);
  const noise = random(6031), sideNoise = random(8206), scatterNoise = random(5047);
  // Several descending low modes spread the impact into a long, uneven rumble.
  const modes = [
    { floor: 36, fall: 29, decayTime: 1.32, gain: 0.98, phase: 0.8 },
    { floor: 46, fall: 47, decayTime: 1.16, gain: 0.72, phase: 1.9 },
    { floor: 62, fall: 59, decayTime: 0.79, gain: 0.51, phase: 3.2 },
    { floor: 82, fall: 56, decayTime: 0.54, gain: 0.33, phase: 3.9 },
  ];
  let pressure = 0, sub = 0, edge = 0, side = 0, debris = 0, debrisLow = 0, air = 0, airLow = 0;
  for (let i = 0; i < out[0].length; i++) {
    const t = i / SAMPLE_RATE;
    let boom = 0;
    for (const mode of modes) {
      mode.phase += TAU * (mode.floor + mode.fall * Math.exp(-t / 0.08) +
        2.4 * Math.sin(t * 3.7 + mode.floor)) / SAMPLE_RATE;
      boom += mode.gain * Math.sin(mode.phase) * decay(t, 0.008, mode.decayTime);
    }
    const hit = noise();
    edge += (hit - edge) * (0.06 + 0.49 * Math.exp(-t / 0.028));
    pressure += (hit - pressure) * (0.014 + 0.045 * Math.exp(-t / 0.19));
    sub += (pressure - sub) * 0.002;
    side += (sideNoise() - side) * 0.024;
    debris += (hit - debris) * (0.095 + 0.17 * Math.exp(-t / 0.48));
    debrisLow += (debris - debrisLow) * 0.055;
    air += (scatterNoise() - air) * (0.23 + 0.28 * Math.exp(-t / 0.075));
    airLow += (air - airLow) * 0.14;
    const crack = 1.25 * (edge - pressure) * decay(t, 0.002, 0.054);
    const shock = Math.tanh(2.4 * (boom + 6.2 * (pressure - sub) * decay(t, 0.009, 0.64))) * 0.6;
    const grit = 2.3 * (debris - debrisLow) * decay(t, 0.018, 0.74);
    // An irregular high band makes the shock ring and crackle as it spreads.
    const sputter = 0.55 + 0.45 * Math.sin(t * 37 + 0.65 * Math.sin(t * 103)) ** 2;
    const scatter = 1.4 * (air - airLow) * decay(t, 0.004, 0.37) * sputter;
    const wake = 1.35 * side * decay(t, 0.12, 1.08);
    out[0][i] = 0.58 * boom + shock + crack + grit + wake + scatter;
    out[1][i] = 0.58 * boom + shock + crack + grit - wake * 0.62 - scatter * 0.44;
  }
  // A suggestion of a low distorted voice sits behind the blast.
  for (const [note, pan, at] of [[33, 0.68, 0.045], [39, 0.31, 0.093]]) {
    choir(out, note, { duration: 1.8, at, pan, gain: 0.15, vibrato: 4.1, phase: pan * TAU, grit: 0.88,
      envelope: t => decay(t, 0.03, 0.37) * Math.min(1, (1.8 - t) / 0.24) });
  }
  // Clean upper voices bloom after the transient, above the darker bass.
  const bloomDuration = 3.15;
  for (const [note, pan, gain, at] of [[62, 0.29, 0.19, 0.065], [69, 0.72, 0.21, 0.12],
    [74, 0.41, 0.14, 0.17], [78, 0.65, 0.09, 0.25], [81, 0.36, 0.052, 0.32]]) {
    choir(out, note, { duration: bloomDuration, at, pan, gain, vibrato: 3.8, phase: pan * TAU,
      envelope: t => decay(t, 0.18, 0.93) * Math.min(1, (bloomDuration - t) / 0.4) });
  }
  for (const channel of out) {
    for (let j = 0; j < SAMPLE_RATE * 0.24; j++) channel[channel.length - 1 - j] *= j / (SAMPLE_RATE * 0.24);
  }
  return out;
}

function writeSample(file, channels) {
  const count = channels[0].length;
  let peak = 0;
  for (const channel of channels) for (const value of channel) peak = Math.max(peak, Math.abs(value));
  const pcm = Buffer.alloc(count * 8);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 2; c++) pcm.writeFloatLE(channels[c][i] * 0.7 / peak, (i * 2 + c) * 4);
  }
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SAMPLE_RATE),
    '-ac', '2', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-q:a', '3', file], { input: pcm });
}

function measureLoudness(file) {
  // BS.1770 K-weighting at 48 kHz. Match the combat mix's loudest 200 ms window.
  const shelf = 'biquad=b0=1.53512485958697:b1=-2.69169618940638:b2=1.19839281085285:a1=-1.69065929318241:a2=0.73248077421585';
  const highPass = 'biquad=b0=1:b1=-2:b2=1:a1=-1.99004745483398:a2=0.99007225036621';
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-af', `${shelf},${highPass}`, '-f', 'f32le', 'pipe:1'],
    { maxBuffer: 8 * 1024 * 1024 });
  const window = 0.2 * SAMPLE_RATE * 8;
  const energyAt = i => pcm.readFloatLE(i) ** 2 + pcm.readFloatLE(i + 4) ** 2;
  let total = 0, best = 0;
  for (let i = 0; i < pcm.length; i += 8) {
    total += energyAt(i);
    if (i >= window) total -= energyAt(i - window);
    best = Math.max(best, total);
  }
  return -0.691 + 10 * Math.log10(best / (window / 8));
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, make, target] of [['seraph-aim', aim, -32], ['seraph-release', release, -27]]) {
  const file = path.join(OUT, `${name}.mp3`);
  writeSample(file, make());
  const loudness = measureLoudness(file);
  console.log(`${name}: ${loudness.toFixed(1)} LUFS (200 ms), mix gain ${(10 ** ((target - loudness) / 20)).toFixed(3)}`);
  if (process.argv.includes('--install')) fs.copyFileSync(file, path.join(ASSETS, `${name}.mp3`));
}
