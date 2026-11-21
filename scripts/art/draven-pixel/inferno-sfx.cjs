#!/usr/bin/env node
// Procedural sound layers for Draven's Inferno super, synthesised in code so
// they can be retuned like the pixel art. They sit on top of the existing
// special.mp3 swell and are triggered by what happens in the super:
//   inferno-ignite   cast: a sub thump and a rising whoosh as the circle lights
//   inferno-crackle  bed under the whole channel: fire crackle and pops
//   inferno-pulse    each shock ring the rune circle sends out (twice a second)
//   inferno-hit      each Inferno explosion on a target: crack and sizzle
//   inferno-end      the channel ending: the fire released in a falling whoosh
//   node scripts/art/draven-pixel/inferno-sfx.cjs            -> output/draven-pixel/sfx/
//   node scripts/art/draven-pixel/inferno-sfx.cjs --install  also writes the mp3s
//                                                            into public/assets/draven/
// Prints each file's loudest-200 ms K-weighted loudness and the volume that
// puts it at the -27 dB reference used by combatSoundVolumes (playerAudio.js).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'output/draven-pixel/sfx');
const ASSETS = path.join(ROOT, 'public/assets/draven');
const SR = 48000;
const TAU = Math.PI * 2;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// RBJ biquad whose cutoff/centre may change every sample.
function biquad(type, q = 0.707) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x, f) => {
    const w = TAU * Math.min(f, SR * 0.45) / SR, c = Math.cos(w), a = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = a; b1 = 0; b2 = -a; } // band-pass, 0 dB peak
    const a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

const buffer = (sec) => new Float32Array(Math.round(sec * SR));
const env = (t, attack, decay) => (t < 0 ? 0 : t < attack ? t / attack : Math.exp(-(t - attack) / decay));
const lerpExp = (a, b, u) => a * (b / a) ** Math.max(0, Math.min(1, u));

// A pitched sub thump (sine falling from f0 to f1) with a click of noise.
function thump(out, at, { f0 = 95, f1 = 38, sweep = 0.12, decay = 0.22, gain = 1, seed = 1 }) {
  const r = rng(seed), lp = biquad('lp');
  let phase = 0;
  for (let i = Math.round(at * SR); i < out.length; i++) {
    const t = i / SR - at;
    if (t > decay * 7) break;
    phase += TAU * lerpExp(f0, f1, t / sweep) / SR;
    const body = Math.sin(phase) * env(t, 0.004, decay);
    const click = lp(r() * 2 - 1, 1800) * env(t, 0.001, 0.012);
    out[i] += gain * (body + click * 0.8);
  }
}

// Band-passed noise whose centre follows `centre(u)` over `dur` seconds.
function whoosh(out, at, dur, centre, shape, { q = 1.1, gain = 1, seed = 2 }) {
  const r = rng(seed), bp = biquad('bp', q), bp2 = biquad('bp', q * 0.8);
  for (let i = Math.round(at * SR), n = Math.round(dur * SR), k = 0; k < n && i < out.length; i++, k++) {
    const u = k / n, f = centre(u);
    out[i] += gain * shape(u) * (bp(r() * 2 - 1, f) + 0.5 * bp2(r() * 2 - 1, f * 1.9));
  }
}

// Fire crackle: sparse snapping clicks (band-passed, randomly bright) plus
// occasional fatter pops. `density(t)` is clicks per second.
function crackle(out, at, dur, density, { gain = 1, seed = 3, bright = [1800, 7000] }) {
  const r = rng(seed);
  let t = 0;
  while (t < dur) {
    t += -Math.log(1 - r()) / Math.max(1, density(t));
    if (t >= dur) break;
    const pop = r() < 0.18;
    const f = pop ? 500 + r() * 900 : bright[0] + r() * (bright[1] - bright[0]);
    const decay = pop ? 0.012 + r() * 0.01 : 0.002 + r() * 0.004;
    const amp = (pop ? 0.9 : 0.35 + r() * 0.65) * gain;
    const bp = biquad('bp', pop ? 1.5 : 2.5);
    const start = Math.round((at + t) * SR);
    for (let k = 0; k < decay * 8 * SR && start + k < out.length; k++) {
      out[start + k] += amp * bp(r() * 2 - 1, f) * env(k / SR, 0.0004, decay) * 3;
    }
  }
}

// Low fire roar: low-passed noise with slow flicker.
function roar(out, at, dur, shape, { cutoff = 420, gain = 1, seed = 4 }) {
  const r = rng(seed), lp = biquad('lp', 0.9), lp2 = biquad('lp', 0.7);
  for (let k = 0, n = Math.round(dur * SR); k < n; k++) {
    const i = Math.round(at * SR) + k;
    if (i >= out.length) break;
    const t = k / SR;
    const flicker = 0.75 + 0.25 * Math.sin(TAU * 3.1 * t) * Math.sin(TAU * 0.7 * t + 1);
    out[i] += gain * shape(k / n) * flicker * lp2(lp(r() * 2 - 1, cutoff), cutoff * 1.5) * 2.2;
  }
}

// Soft-clip and fade the tail so nothing ends on a cliff.
function finish(out, fadeSec = 0.02) {
  let peak = 0;
  for (let i = 0; i < out.length; i++) { out[i] = Math.tanh(out[i] * 1.2) / 1.2; peak = Math.max(peak, Math.abs(out[i])); }
  const fade = Math.round(fadeSec * SR);
  for (let k = 0; k < fade; k++) out[out.length - 1 - k] *= k / fade;
  const norm = 0.89 / (peak || 1); // ~ -1 dBFS peak
  for (let i = 0; i < out.length; i++) out[i] *= norm;
  return out;
}

const SOUNDS = {
  'inferno-ignite': () => {
    const o = buffer(1.1);
    thump(o, 0, { f0: 110, f1: 36, sweep: 0.18, decay: 0.28, gain: 1.0, seed: 11 });
    whoosh(o, 0.02, 0.95, (u) => lerpExp(260, 2600, Math.min(1, u * 1.6)) * (u > 0.6 ? 1 - (u - 0.6) * 0.8 : 1),
      (u) => Math.sin(Math.PI * Math.min(1, u * 1.3)) ** 1.5, { q: 0.9, gain: 0.9, seed: 12 });
    roar(o, 0.05, 1.0, (u) => Math.sin(Math.PI * u) ** 0.8, { cutoff: 600, gain: 0.55, seed: 13 });
    crackle(o, 0.08, 0.9, (t) => 70 * Math.exp(-t * 2.5), { gain: 0.6, seed: 14 });
    return finish(o, 0.08);
  },
  'inferno-crackle': () => {
    // Long enough for the whole channel; the game stops it when the super ends.
    const o = buffer(5.4);
    roar(o, 0, 5.4, (u) => Math.min(1, u * 8), { cutoff: 380, gain: 0.5, seed: 21 });
    crackle(o, 0, 5.4, (t) => 26 + 12 * Math.sin(t * 2.1) ** 2, { gain: 0.75, seed: 22 });
    return finish(o, 0.25);
  },
  'inferno-pulse': () => {
    const o = buffer(0.45);
    thump(o, 0, { f0: 78, f1: 44, sweep: 0.1, decay: 0.12, gain: 0.9, seed: 31 });
    whoosh(o, 0, 0.4, (u) => lerpExp(900, 380, u), (u) => env(u * 0.4, 0.015, 0.09), { q: 1.4, gain: 0.45, seed: 32 });
    crackle(o, 0.01, 0.2, () => 60, { gain: 0.35, seed: 33 });
    return finish(o, 0.05);
  },
  'inferno-hit': () => {
    const o = buffer(0.5);
    thump(o, 0, { f0: 140, f1: 55, sweep: 0.06, decay: 0.07, gain: 0.8, seed: 41 });
    // Sizzle: high band noise that fizzles out.
    const r = rng(42), hp = biquad('hp', 0.8), bp = biquad('bp', 1.2);
    for (let i = 0; i < o.length; i++) {
      const t = i / SR;
      const fizz = hp(r() * 2 - 1, 3200) * env(t, 0.003, 0.11) * (0.7 + 0.3 * Math.sin(TAU * 31 * t));
      const crack = bp(r() * 2 - 1, 1400) * env(t, 0.0005, 0.018) * 1.6;
      o[i] += fizz * 0.6 + crack;
    }
    crackle(o, 0.01, 0.3, (t) => 90 * Math.exp(-t * 9), { gain: 0.5, seed: 43 });
    return finish(o, 0.06);
  },
  'inferno-end': () => {
    const o = buffer(1.0);
    thump(o, 0, { f0: 90, f1: 34, sweep: 0.2, decay: 0.2, gain: 0.7, seed: 51 });
    whoosh(o, 0, 0.9, (u) => lerpExp(2400, 220, u), (u) => env(u * 0.9, 0.02, 0.28), { q: 0.9, gain: 1.0, seed: 52 });
    crackle(o, 0.05, 0.85, (t) => 45 * Math.exp(-t * 3), { gain: 0.5, seed: 53 });
    return finish(o, 0.15);
  },
};

// ---------- loudness (BS.1770 K-weighting, loudest 200 ms window) ----------
function kWeighted(x) {
  // 48 kHz pre-filter (high shelf) and RLB high-pass coefficients from BS.1770.
  const stage = (b, a) => { let x1 = 0, x2 = 0, y1 = 0, y2 = 0; return (v) => { const y = b[0] * v + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; return y; }; };
  const s1 = stage([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]);
  const s2 = stage([1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
  return Float32Array.from(x, (v) => s2(s1(v)));
}
function loudness200(channels) {
  const k = channels.map(kWeighted), n = k[0].length, w = Math.round(0.2 * SR);
  let sum = 0, best = 0;
  for (let i = 0; i < n; i++) {
    for (const c of k) sum += c[i] * c[i];
    if (i >= w) for (const c of k) sum -= c[i - w] * c[i - w];
    if (i >= w - 1) best = Math.max(best, sum / Math.min(w, i + 1));
  }
  return -0.691 + 10 * Math.log10(best || 1e-12);
}
function decode(file) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 });
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const l = new Float32Array(all.length / 2), r = new Float32Array(all.length / 2);
  for (let i = 0; i < l.length; i++) { l[i] = all[2 * i]; r[i] = all[2 * i + 1]; }
  return [l, r];
}

function writeWav(file, mono) {
  const data = Buffer.alloc(mono.length * 2);
  for (let i = 0; i < mono.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mono[i])) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

function main() {
  const install = process.argv.includes('--install');
  fs.mkdirSync(OUT, { recursive: true });
  const REF = -27;
  for (const [name, make] of Object.entries(SOUNDS)) {
    const wav = path.join(OUT, `${name}.wav`), mp3 = path.join(OUT, `${name}.mp3`);
    writeWav(wav, make());
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '3', mp3]);
    const L = loudness200(decode(mp3));
    console.log(`${name.padEnd(16)} ${L.toFixed(1)} LUFS(200ms)  volume ${(10 ** ((REF - L) / 20)).toFixed(3)}`);
    if (install) fs.copyFileSync(mp3, path.join(ASSETS, `${name}.mp3`));
  }
  if (process.argv.includes('--check')) {
    for (const f of ['fireball', 'hit', 'special']) {
      const L = loudness200(decode(path.join(ASSETS, `${f}.mp3`)));
      console.log(`reference draven ${f.padEnd(9)} volume ${(10 ** ((REF - L) / 20)).toFixed(3)}`);
    }
  }
}

main();
