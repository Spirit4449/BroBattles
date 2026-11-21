#!/usr/bin/env node
// Candidate designs for Ninja's base shuriken, drawn in code as pixel art at
// the size the game shows it (about 26 world px), in the ally (steel blue) and
// enemy (red) team colours. Writes PNGs and a gallery page to look through:
//   node scripts/art/ninja-pixel/shuriken-options.cjs                  -> output/ninja-pixel/shuriken-options/index.html
//   node scripts/art/ninja-pixel/shuriken-options.cjs --install <key>  also installs that design as
//        public/assets/ninja/shuriken.webp (ally) and shuriken-red.webp (enemy), at the
//        installed 237 px so the game's shuriken scale is unchanged. The first install
//        keeps the originals in output/ninja-pixel/shuriken-options/original/.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'output/ninja-pixel/shuriken-options');
const N = 28; // art px
const INSTALLED_SIZE = 237; // the game's shuriken textures; projectile `scale` is tuned to it
const SUB = 4; // subsamples per axis for coverage
const TAU = Math.PI * 2;
const C = (N - 1) / 2 + 0.5; // centre, in pixel-corner coordinates

const PALETTES = {
  ally: { k: [17, 19, 35], d: [34, 51, 92], m: [63, 102, 173], l: [169, 195, 236], w: [255, 255, 255], accent: [96, 234, 160], accentDark: [30, 150, 112] },
  enemy: { k: [35, 10, 16], d: [112, 22, 32], m: [204, 48, 52], l: [255, 170, 160], w: [255, 255, 255], accent: [255, 214, 92], accentDark: [184, 110, 30] },
};
const CORD = { dark: [120, 14, 24], mid: [214, 34, 44], light: [255, 120, 110] };
const GOLD = { dark: [150, 96, 24], mid: [232, 176, 56], light: [255, 236, 150] };

// ---- signed distance (negative inside) -------------------------------------
function sdPolygon(p, v) {
  let d = (p[0] - v[0][0]) ** 2 + (p[1] - v[0][1]) ** 2, s = 1;
  for (let i = 0, j = v.length - 1; i < v.length; j = i, i++) {
    const e = [v[j][0] - v[i][0], v[j][1] - v[i][1]], w = [p[0] - v[i][0], p[1] - v[i][1]];
    const t = Math.max(0, Math.min(1, (w[0] * e[0] + w[1] * e[1]) / (e[0] * e[0] + e[1] * e[1])));
    const b = [w[0] - e[0] * t, w[1] - e[1] * t];
    d = Math.min(d, b[0] * b[0] + b[1] * b[1]);
    const c = [p[1] >= v[i][1], p[1] < v[j][1], e[0] * w[1] > e[1] * w[0]];
    if (c.every(Boolean) || c.every((x) => !x)) s = -s;
  }
  return s * Math.sqrt(d);
}
const circle = (p, r) => Math.hypot(p[0], p[1]) - r;
const polar = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
const star = (points, outer, inner, turn = -Math.PI / 2) => Array.from({ length: points * 2 }, (_, i) =>
  polar(i % 2 ? inner : outer, turn + (i * Math.PI) / points));

// ---- designs -----------------------------------------------------------------
// Each returns { body(p) -> sdf, hole(p) -> sdf | null, tips: angles of blade
// ridges, extra(p, P) -> colour | null drawn over the body }.
const DESIGNS = [
  {
    key: 'classic', name: 'Classic Edge',
    note: 'The current four-point star, redrawn sharper: faceted blades with a lit and a shadow side, a bright edge and a centre hole.',
    body: (p) => sdPolygon(p, star(4, 13.2, 4.6)),
    hole: (p) => circle(p, 1.7),
    tips: [0, 1, 2, 3].map((i) => -Math.PI / 2 + (i * Math.PI) / 2),
  },
  {
    key: 'hira', name: 'Six-Point Hira',
    note: 'A six-bladed throwing star: more points, a denser spin and a ring around the hole.',
    body: (p) => sdPolygon(p, star(6, 13.4, 5.6)),
    hole: (p) => circle(p, 2.0),
    ring: 4.2,
    tips: Array.from({ length: 6 }, (_, i) => -Math.PI / 2 + (i * TAU) / 6),
  },
  {
    key: 'pinwheel', name: 'Hooked Pinwheel',
    note: 'Four curved, hooked blades. When it spins the hooks trail like a saw, the most dynamic in motion.',
    body: (p) => {
      const pts = [];
      for (let b = 0; b < 4; b++) {
        const base = -Math.PI / 2 + (b * Math.PI) / 2;
        // Leading edge sweeps out and curls into a hooked tip, the trailing edge returns straight.
        for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(polar(4 + t * 9.6, base + t * t * 0.95)); }
        pts.push(polar(11.2, base + 0.62));
        for (let i = 6; i >= 0; i--) { const t = i / 6; pts.push(polar(4 + t * 4.5, base + 0.55 + t * 0.45 - 0.05)); }
        pts.push(polar(4.2, base + Math.PI / 2 - 0.05));
      }
      return sdPolygon(p, pts);
    },
    hole: (p) => circle(p, 1.8),
    tips: [0, 1, 2, 3].map((i) => -Math.PI / 2 + (i * Math.PI) / 2 + 0.95),
  },
  {
    key: 'tri', name: 'Tri-Blade',
    note: 'Three long swept blades, like a triskelion. Fewer, bigger blades read clearly at a distance.',
    body: (p) => {
      const pts = [];
      for (let b = 0; b < 3; b++) {
        const base = -Math.PI / 2 + (b * TAU) / 3;
        for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(polar(4.5 + t * 9.2, base + Math.sin(t * Math.PI * 0.5) * 0.55)); }
        for (let i = 8; i >= 0; i--) { const t = i / 8; pts.push(polar(4.5 + t * 5.5, base + 0.55 + t * 0.35 + 0.35 * (1 - t))); }
      }
      return sdPolygon(p, pts);
    },
    hole: (p) => circle(p, 2.0),
    ring: 4.6,
    tips: [0, 1, 2].map((i) => -Math.PI / 2 + (i * TAU) / 3 + 0.55),
  },
  {
    key: 'saw', name: 'Saw Disc',
    note: 'A round steel disc ringed with eight teeth, with a team-coloured inlay. Spins like a buzzsaw.',
    body: (p) => {
      const pts = [];
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 8;
        pts.push(polar(9.8, a), polar(13.4, a + 0.12), polar(9.8, a + 0.5));
      }
      return sdPolygon(p, pts);
    },
    hole: (p) => circle(p, 2.0),
    inlay: { inner: 4.2, outer: 6.6 },
    tips: Array.from({ length: 8 }, (_, i) => -Math.PI / 2 + (i * TAU) / 8 + 0.12),
  },
  {
    key: 'fuma', name: 'Fuma Cord-Wrap',
    note: 'Big four-point fuma shuriken with a red cord bound round the centre and gold rivets: the showiest.',
    body: (p) => sdPolygon(p, star(4, 13.6, 4.8, -Math.PI / 4)),
    hole: null,
    cord: 4.6,
    tips: [0, 1, 2, 3].map((i) => -Math.PI / 4 + (i * Math.PI) / 2),
  },
];

// ---- rendering ---------------------------------------------------------------
const LIGHT = [-0.6, -0.8]; // from the top left
function angleDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }

function render(design, P) {
  const px = Buffer.alloc(N * N * 4);
  const inside = new Uint8Array(N * N);
  const set = (x, y, c) => { const i = (y * N + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
  const sdf = (p) => {
    let d = design.body(p);
    if (design.hole) d = Math.max(d, -design.hole(p));
    return d;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let cover = 0;
    for (let sy = 0; sy < SUB; sy++) for (let sx = 0; sx < SUB; sx++) {
      if (sdf([x + (sx + 0.5) / SUB - C, y + (sy + 0.5) / SUB - C]) < 0) cover++;
    }
    if (cover / (SUB * SUB) < 0.45) continue;
    inside[y * N + x] = 1;
    const p = [x + 0.5 - C, y + 0.5 - C];
    const d = sdf(p), r = Math.hypot(p[0], p[1]), a = Math.atan2(p[1], p[0]);
    // Outward normal from the sdf gradient: edges facing the light catch it.
    const e = 0.25, g = [sdf([p[0] + e, p[1]]) - sdf([p[0] - e, p[1]]), sdf([p[0], p[1] + e]) - sdf([p[0], p[1] - e])];
    const gl = Math.hypot(g[0], g[1]) || 1, lit = -(g[0] * LIGHT[0] + g[1] * LIGHT[1]) / gl;
    let colour;
    if (d > -1.1) colour = lit > 0.25 ? P.l : lit < -0.35 ? P.d : P.m; // the bevelled edge
    else {
      // Facets: each blade's ridge runs from the centre to its tip; the side of
      // the ridge facing the light is lit.
      const tip = design.tips.reduce((best, t) => (Math.abs(angleDiff(a, t)) < Math.abs(angleDiff(a, best)) ? t : best));
      const side = Math.sign(angleDiff(a, tip));
      const facing = Math.cos(tip + side * Math.PI / 2 - Math.atan2(-LIGHT[1], -LIGHT[0]) - Math.PI);
      colour = facing > 0.15 ? P.l : facing < -0.15 ? P.d : P.m;
      if (Math.abs(angleDiff(a, tip)) * r < 0.6 && r > 3) colour = P.l; // the ridge line
    }
    if (design.ring && Math.abs(r - design.ring) < 0.55) colour = P.d;
    if (design.inlay && r > design.inlay.inner && r < design.inlay.outer) colour = r < (design.inlay.inner + design.inlay.outer) / 2 ? P.accent : P.accentDark;
    if (design.cord && r < design.cord + 0.4) {
      // Diagonal wraps of cord with gold rivets at the corners of the binding.
      const band = Math.floor((p[0] + p[1] + 40) / 1.6) % 2;
      colour = r > design.cord - 0.6 ? CORD.dark : band ? CORD.mid : CORD.light;
      if (r < 1.3) colour = GOLD.light;
    }
    set(x, y, colour);
  }
  if (design.cord) for (const t of design.tips) {
    const [rx, ry] = polar(design.cord + 1.8, t);
    const x = Math.floor(C + rx), y = Math.floor(C + ry);
    if (inside[y * N + x]) set(x, y, GOLD.mid);
  }
  // A glint on the upper-left blade's tip.
  const glintTip = design.tips.reduce((best, t) => (Math.cos(t - Math.atan2(LIGHT[1], LIGHT[0])) > Math.cos(best - Math.atan2(LIGHT[1], LIGHT[0])) ? t : best));
  const [gx, gy] = polar(8.5, glintTip);
  const gxI = Math.floor(C + gx), gyI = Math.floor(C + gy);
  if (inside[gyI * N + gxI]) set(gxI, gyI, P.w);
  // Outline: every empty pixel touching the shape.
  const out = Buffer.from(px);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (inside[y * N + x]) continue;
    const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inside[(y + dy) * N + (x + dx)] && x + dx >= 0 && x + dx < N && y + dy >= 0 && y + dy < N);
    if (touches) { const i = (y * N + x) * 4; out[i] = P.k[0]; out[i + 1] = P.k[1]; out[i + 2] = P.k[2]; out[i + 3] = 255; }
  }
  return out;
}

async function png(buffer, scale) {
  return sharp(buffer, { raw: { width: N, height: N, channels: 4 } }).resize(N * scale, N * scale, { kernel: 'nearest' }).png().toBuffer();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const uri = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
  const current = {
    ally: await sharp(path.join(ROOT, 'public/assets/ninja/shuriken.webp')).resize(N, N).png().toBuffer(),
    enemy: await sharp(path.join(ROOT, 'public/assets/ninja/shuriken-red.webp')).resize(N, N).png().toBuffer(),
  };
  const backdrop = await sharp(path.join(ROOT, 'public/assets/sky-soil/background.webp')).resize(480, 270, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer();
  const cards = [{ key: 'current', name: 'Current', note: 'The shuriken in the game now, for comparison.', images: {
    ally: { big: uri(await sharp(current.ally).resize(N * 8, N * 8, { kernel: 'nearest' }).png().toBuffer()), small: uri(current.ally) },
    enemy: { big: uri(await sharp(current.enemy).resize(N * 8, N * 8, { kernel: 'nearest' }).png().toBuffer()), small: uri(current.enemy) },
  } }];
  for (const design of DESIGNS) {
    const images = {};
    for (const [team, P] of Object.entries(PALETTES)) {
      const raw = render(design, P);
      const big = await png(raw, 8);
      fs.writeFileSync(path.join(OUT, `${design.key}-${team}.png`), await png(raw, 9));
      images[team] = { big: uri(big), small: uri(await png(raw, 1)) };
    }
    cards.push({ key: design.key, name: design.name, note: design.note, images });
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shuriken Options</title><style>
:root{--bg:#141826;--panel:#1e2436;--ink:#eef1f8;--muted:#9aa3bb;--accent:#ff8a3d}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,sans-serif;padding:24px 16px}
h1{margin:0 0 4px;font-size:22px}p.lead{margin:0 0 20px;color:var(--muted);max-width:760px}
.controls{display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:20px;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.card{background:var(--panel);border-radius:12px;padding:16px}
.card h2{margin:0 0 4px;font-size:17px}.card p{margin:0 0 12px;color:var(--muted);font-size:13px;min-height:38px}
.row{display:flex;gap:12px;align-items:center;justify-content:space-between}
.big{width:112px;height:112px;image-rendering:pixelated;background:#2a3148;border-radius:8px}
.scene{position:relative;width:120px;height:68px;border-radius:8px;background:url(${uri(backdrop)}) center/cover;overflow:hidden}
.scene img{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px;image-rendering:pixelated}
.spin{animation:spin var(--period,0.18s) linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.label{font-size:11px;color:var(--muted);text-align:center;margin-top:4px}
.tag{display:inline-block;background:var(--accent);color:#141826;font-weight:700;font-size:11px;border-radius:99px;padding:1px 8px;margin-left:6px;vertical-align:2px}
</style></head><body>
<h1>Ninja shuriken options</h1>
<p class="lead">Pixel art at in-game size (28 art px, shown 4x), in ally and enemy colours. The middle preview spins over Sky Soil at game scale (2x zoom); switch the spin speed to see the shape in motion. Nothing is installed yet.</p>
<div class="controls"><label><input type="radio" name="speed" value="0.18" checked> Game speed</label>
<label><input type="radio" name="speed" value="1.4"> Slow</label><label><input type="radio" name="speed" value="0"> Still</label>
<label><input type="radio" name="team" value="ally" checked> Ally</label><label><input type="radio" name="team" value="enemy"> Enemy</label></div>
<div class="grid">${cards.map((c) => `<div class="card" data-key="${c.key}"><h2>${c.name}${c.key === 'current' ? '<span class="tag">now</span>' : ''}</h2><p>${c.note}</p>
<div class="row"><div><img class="big" data-team-src='${JSON.stringify({ ally: c.images.ally.big, enemy: c.images.enemy.big })}' src="${c.images.ally.big}" alt="${c.name}"><div class="label">4x still</div></div>
<div><div class="scene"><img class="spin" data-team-src='${JSON.stringify({ ally: c.images.ally.big, enemy: c.images.enemy.big })}' src="${c.images.ally.big}" alt=""></div><div class="label">in game, spinning</div></div></div></div>`).join('')}</div>
<script>
for (const r of document.querySelectorAll('input[name=speed]')) r.addEventListener('change', () => {
  const v = Number(r.value); document.querySelectorAll('.spin').forEach(i => { i.style.animationPlayState = v ? 'running' : 'paused'; if (v) i.style.setProperty('--period', v + 's'); });
});
for (const r of document.querySelectorAll('input[name=team]')) r.addEventListener('change', () => {
  document.querySelectorAll('[data-team-src]').forEach(i => { i.src = JSON.parse(i.dataset.teamSrc)[r.value]; });
});
</script></body></html>`;
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  // A contact sheet for quick review.
  const tiles = [];
  for (const [i, design] of DESIGNS.entries()) for (const [j, team] of ['ally', 'enemy'].entries()) {
    tiles.push({ input: fs.readFileSync(path.join(OUT, `${design.key}-${team}.png`)), left: i * (N * 9 + 12), top: j * (N * 9 + 12) });
  }
  await sharp({ create: { width: DESIGNS.length * (N * 9 + 12), height: 2 * (N * 9 + 12), channels: 4, background: { r: 120, g: 150, b: 190, alpha: 1 } } })
    .composite(tiles).png().toFile(path.join(OUT, 'sheet.png'));
  console.log(`wrote ${path.relative(ROOT, OUT)}/index.html`);
  const chosen = process.argv[process.argv.indexOf('--install') + 1];
  if (process.argv.includes('--install')) {
    const design = DESIGNS.find((d) => d.key === chosen);
    if (!design) throw new Error(`--install needs one of: ${DESIGNS.map((d) => d.key).join(', ')}`);
    const assets = path.join(ROOT, 'public/assets/ninja'), backup = path.join(OUT, 'original');
    fs.mkdirSync(backup, { recursive: true });
    for (const [team, file] of [['ally', 'shuriken.webp'], ['enemy', 'shuriken-red.webp']]) {
      if (!fs.existsSync(path.join(backup, file))) fs.copyFileSync(path.join(assets, file), path.join(backup, file));
      await sharp(render(design, PALETTES[team]), { raw: { width: N, height: N, channels: 4 } })
        .resize(INSTALLED_SIZE, INSTALLED_SIZE, { kernel: 'nearest' }).webp({ lossless: true }).toFile(path.join(assets, file));
    }
    console.log(`installed ${design.name} as shuriken.webp and shuriken-red.webp`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
