#!/usr/bin/env node
// Procedural sound layers for Ninja's Shuriken Swarm, synthesised in code so
// they can be retuned like the pixel art (scripts/art/ninja-pixel/swarm-fx.cjs):
//   swarm-cast     the barrage starts: a blade scraped into a ringing shing
//   swarm-throw    each of the fifteen throws: the basic attack sound, sharpened
//   swarm-pocket   each returning shuriken pocketed: a sharp whoosh that snaps shut
//   swarm-pocket-crown  the crown skin's pocket: a sharp, bright ding
//   shuriken-flight  looped under a flying shuriken: a whoop-whoop spin whoosh
//   shuriken-hit     a shuriken hitting anything (wall or player): a hard steel clank
//   node scripts/art/ninja-pixel/swarm-sfx.cjs            -> output/ninja-pixel/sfx/
//   node scripts/art/ninja-pixel/swarm-sfx.cjs --install  also writes the mp3s
//                                                         into public/assets/ninja/
// Prints each file's loudest-200 ms K-weighted loudness and the volume that
// puts it at the -27 dB reference used by combatSoundVolumes (playerAudio.js).
// The DSP helpers match scripts/art/draven-pixel/inferno-sfx.cjs.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'output/ninja-pixel/sfx');
const ASSETS = path.join(ROOT, 'public/assets/ninja');
const SR = 48000;
const TAU = Math.PI * 2;
const RELEASE_MS = 36;
const SHARDS = 15;
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

// Gentle finish: no saturation (it made the first pass harsh), a soft lowpass
// that takes the fizz off the top, a faded tail and peaks at about -3 dBFS.
function finish(out, fadeSec = 0.02, cutoff = 7500) {
  const lp = biquad('lp', 0.6);
  let peak = 0;
  for (let i = 0; i < out.length; i++) { out[i] = lp(out[i], cutoff); peak = Math.max(peak, Math.abs(out[i])); }
  const fade = Math.round(fadeSec * SR);
  for (let k = 0; k < fade; k++) out[out.length - 1 - k] *= k / fade;
  const norm = 0.7 / (peak || 1);
  for (let i = 0; i < out.length; i++) out[i] *= norm;
  return out;
}

// A short burst of filtered noise: a puff of air or cloth, never a crack.
function burst(out, at, { type = 'bp', f = 1500, q = 0.8, attack = 0.004, decay = 0.03, gain = 1, seed = 5, sweep = null }) {
  const r = rng(seed), filter = biquad(type, q);
  for (let i = Math.round(at * SR), k = 0; i < out.length; i++, k++) {
    const t = k / SR;
    if (t > attack + decay * 7) break;
    out[i] += gain * filter(r() * 2 - 1, sweep ? sweep(t) : f) * env(t, attack, decay);
  }
}

// Steel, modelled rather than beeped: a bank of resonators at a steel plate's
// inharmonic modes, rung by whatever excites it (a strike, a scrape). Higher
// modes die faster, as they do in real metal, so it rings bright then mellows.
const PLATE = [1, 1.47, 2.09, 2.56, 3.12, 3.73, 4.41, 5.2, 5.88, 6.83];
const PLATE_GAIN = [1, 0.7, 0.55, 0.45, 0.35, 0.3, 0.22, 0.16, 0.12, 0.08];
function steel(out, at, { base = 1500, decay = 0.4, gain = 1, excite, length = 0.01, modes = PLATE.length, seed = 9 }) {
  const r = rng(seed);
  const banks = PLATE.slice(0, modes).map((ratio, k) => {
    const f = base * ratio * (1 + (r() - 0.5) * 0.01);
    const rr = Math.exp(-1 / ((decay / (1 + k * 0.45)) * SR));
    return { a1: 2 * rr * Math.cos((TAU * f) / SR), a2: rr * rr, b: (1 - rr) * PLATE_GAIN[k] * 6, y1: 0, y2: 0 };
  });
  const start = Math.round(at * SR), n = Math.round((length + decay * 6) * SR);
  for (let k = 0; k < n && start + k < out.length; k++) {
    const x = k < length * SR ? excite(k / SR) : 0;
    let v = 0;
    for (const m of banks) { const y = m.a1 * m.y1 - m.a2 * m.y2 + m.b * x; m.y2 = m.y1; m.y1 = y; v += y; }
    out[start + k] += gain * v;
  }
}
// Excitations: a soft strike (a click rounded off by a lowpass) and a scrape
// (band noise that swells while the blade slides).
function strike(seed, soft = 5000) {
  const r = rng(seed), lp = biquad('lp', 0.7);
  return (t) => lp((r() * 2 - 1) * Math.exp(-t / 0.0015), soft);
}
function scrape(seed, length, centre = 3500) {
  const r = rng(seed), bp = biquad('bp', 0.9);
  return (t) => bp(r() * 2 - 1, centre) * Math.sin(Math.PI * Math.min(1, t / length)) ** 0.7 * 0.35;
}

// Air moving past a spinning shuriken: band noise that falls in pitch as it
// leaves (a quick doppler), lowpassed so it is a "fwip", never a hiss.
function fwip(out, at, { from = 1900, to = 650, dur = 0.075, gain = 1, seed = 6 }) {
  const r = rng(seed), bp = biquad('bp', 1.1), lp = biquad('lp', 0.7);
  for (let k = 0, n = Math.round(dur * SR); k < n; k++) {
    const i = Math.round(at * SR) + k;
    if (i >= out.length) break;
    const u = k / n;
    out[i] += gain * lp(bp(r() * 2 - 1, lerpExp(from, to, u)), 3000) * Math.sin(Math.PI * u) ** 1.5 * 2.2;
  }
}

const SOUNDS = {
  // The blade drawn: a scrape along the steel that blooms into a ringing
  // shing, over a soft rush of air and a low swell.
  'swarm-cast': () => {
    const o = buffer(1.2);
    thump(o, 0, { f0: 85, f1: 50, sweep: 0.12, decay: 0.12, gain: 0.35, seed: 12 });
    whoosh(o, 0, 0.42, (u) => lerpExp(300, 1200, u), (u) => Math.sin(Math.PI * u) ** 2, { q: 0.7, gain: 0.25, seed: 14 });
    steel(o, 0.0, { base: 1580, decay: 0.55, gain: 0.9, length: 0.2, excite: scrape(15, 0.2, 3800), seed: 16 });
    steel(o, 0.19, { base: 1580, decay: 0.55, gain: 0.5, length: 0.004, excite: strike(17), seed: 16 });
    return finish(o, 0.25, 9000);
  },

  // One shuriken home and pocketed: a sharp whoosh rushing in that snaps
  // shut as he catches it.
  'swarm-pocket': () => {
    const o = buffer(0.2);
    const r = rng(91), bp = biquad('bp', 1.4), hp = biquad('hp', 0.7);
    const dur = 0.085;
    for (let k = 0, n = Math.round(dur * SR); k < n; k++) {
      const u = k / n;
      // Rising as it comes in (doppler), loudest just before the catch.
      const shape = u ** 2.2 * (u > 0.93 ? (1 - u) / 0.07 : 1);
      o[k] += hp(bp(r() * 2 - 1, lerpExp(1100, 4200, u)), 600) * shape * 2.4;
    }
    burst(o, dur - 0.004, { type: 'bp', f: 3000, q: 1.2, attack: 0.0005, decay: 0.004, gain: 0.9, seed: 92 });
    return finish(o, 0.03, 10000);
  },
  // A shuriken in flight, looped while it flies: "whoop whoop" as its blades
  // spin through the air. Seven whoops a second, each band noise that swells
  // and swoops up then down in pitch; silent between whoops, so the loop point
  // never clicks.
  'shuriken-flight': () => {
    const o = buffer(1.0), whoops = 7;
    const r = rng(101), bp = biquad('bp', 1.3), lp = biquad('lp', 0.7);
    for (let i = 0; i < o.length; i++) {
      const u = ((i / o.length) * whoops) % 1;
      const swell = Math.sin(Math.PI * u) ** 2;
      const centre = 650 + 1100 * Math.sin(Math.PI * Math.min(1, u * 1.2));
      o[i] += lp(bp(r() * 2 - 1, centre), 2600) * swell * 2;
    }
    return finish(o, 0.001, 6000);
  },
  // A shuriken hitting anything (a wall, a player): a hard steel clank. A
  // sharp strike rings two steel bodies, the blade and a brighter edge, over a
  // short knock for weight.
  'shuriken-hit': () => {
    const o = buffer(0.6);
    thump(o, 0, { f0: 170, f1: 95, sweep: 0.02, decay: 0.025, gain: 0.3, seed: 111 });
    steel(o, 0, { base: 2350, decay: 0.22, gain: 0.85, excite: strike(113, 10000), length: 0.002, modes: 8, seed: 114 });
    steel(o, 0, { base: 3920, decay: 0.1, gain: 0.35, excite: strike(115, 11000), length: 0.002, modes: 4, seed: 116 });
    return finish(o, 0.1, 11000);
  },
  // The crown skin's pocket: a sharp, bright ding. A hard strike on a few
  // clean steel modes, so it rings like a bell rather than clanks.
  'swarm-pocket-crown': () => {
    const o = buffer(0.45);
    steel(o, 0, { base: 3150, decay: 0.16, gain: 1, excite: strike(83, 9000), length: 0.002, modes: 3, seed: 84 });
    steel(o, 0, { base: 6300, decay: 0.05, gain: 0.25, excite: strike(85, 11000), length: 0.002, modes: 2, seed: 86 });
    return finish(o, 0.08, 11000);
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

// The swarm's throw: the basic attack sound (shurikenThrow.mp3) made sharper,
// so fifteen in half a second stay distinct: its lead-in and long tail trimmed,
// the low thud cut and the top lifted.
const THROW_SOURCE = path.join(ASSETS, 'shurikenThrow.mp3');
const THROW_FILTER = 'atrim=start=0.06:end=0.34,asetpts=PTS-STARTPTS,highpass=f=280,treble=g=5:f=3500,'
  + 'acompressor=threshold=-24dB:ratio=3:attack=1:release=60,afade=t=in:d=0.003,afade=t=out:st=0.13:d=0.15';

function main() {
  const install = process.argv.includes('--install');
  fs.mkdirSync(OUT, { recursive: true });
  const REF = -27;
  for (const [name, make] of Object.entries(SOUNDS)) {
    const wav = path.join(OUT, `${name}.wav`), mp3 = path.join(OUT, `${name}.mp3`);
    writeWav(wav, make());
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '3', mp3]);
    const L = loudness200(decode(mp3));
    console.log(`${name.padEnd(14)} ${L.toFixed(1)} LUFS(200ms)  volume ${(10 ** ((REF - L) / 20)).toFixed(3)}`);
    if (install) fs.copyFileSync(mp3, path.join(ASSETS, `${name}.mp3`));
  }
  const throwMp3 = path.join(OUT, 'swarm-throw.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', THROW_SOURCE, '-af', THROW_FILTER, '-ar', String(SR), '-ac', '1', '-codec:a', 'libmp3lame', '-q:a', '3', throwMp3]);
  const L = loudness200(decode(throwMp3));
  console.log(`${'swarm-throw'.padEnd(14)} ${L.toFixed(1)} LUFS(200ms)  volume ${(10 ** ((REF - L) / 20)).toFixed(3)}`);
  if (install) fs.copyFileSync(throwMp3, path.join(ASSETS, 'swarm-throw.mp3'));
}

main();
