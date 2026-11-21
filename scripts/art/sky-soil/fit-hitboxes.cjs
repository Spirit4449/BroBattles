#!/usr/bin/env node
// Fits Sky Soil's platform hitboxes to its artwork.
//
//   node scripts/art/sky-soil/fit-hitboxes.cjs [--install]
//
// Rule (shared by every platform, taken from the small floating platforms):
// (the island art is moved, not the floor, to keep the arena's shared floor height)
// the floor sits 2 world px below the visible grass surface, the side walls sit
// on the artwork's outer edges, and no hitbox reaches below the artwork.
//
// The main island is one decorative `island-base` scenery image; its four
// invisible rows p0-p3 (middle, pillar, left ledge, right ledge) carry the
// collision. Each row is matched to the grass surface it was meant for, read
// from that map's own island image, so the shipped and saved layouts each fit
// their own art. Without --install it only prints the change.
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { mapRepository } = require('../../../src/server/services/maps/mapRepository');
const { geometryFromMap } = require('../../../src/shared/maps/mapDocument');
const { mapArena } = require('../../../src/shared/maps/arenas');
const { updateSkySoil } = require('./map-install.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const INSTALL = process.argv.includes('--install');
const SINK = 2;          // world px the floor sits below the grass surface
const OVERLAP = 8;       // side ledges tuck this far under the middle's walls
const PILLAR_DEPTH = 30; // the pillar's body reaches this far into the middle
// Maps sharing an arena keep their main floor at one height (tests/mapRuntime),
// so the camera frames them alike. The island art moves to meet that floor
// rather than the floor moving to meet the art.
const MAIN_FLOOR = 580;

const images = new Map();
async function alphaOf(url) {
  if (!images.has(url)) {
    const { data, info } = await sharp(path.join(ROOT, 'public', url)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    images.set(url, { data, w: info.width, h: info.height });
  }
  return images.get(url);
}

// Per texture column: world x, the first opaque world y and the last.
function columns(img, x0, y0, s) {
  const cols = [];
  for (let tx = 0; tx < img.w; tx++) {
    let top = 0; while (top < img.h && img.data[(top * img.w + tx) * 4 + 3] < 128) top++;
    if (top >= img.h) { cols.push(null); continue; }
    let bot = img.h - 1; while (img.data[(bot * img.w + tx) * 4 + 3] < 128) bot--;
    cols.push({ left: x0 + tx * s, right: x0 + (tx + 1) * s, top: y0 + top * s, bottom: y0 + (bot + 1) * s });
  }
  return cols;
}

// The grass surface a collider was meant for: columns near it whose top is
// close to its old floor; the level is their most common top (grass bumps are
// a few columns only), the edges the outermost columns at that level.
function surface(cols, old) {
  const near = cols.filter(c => c && c.right > old.left - 60 && c.left < old.right + 60 && Math.abs(c.top - (old.top - 8)) < 25);
  const count = new Map();
  for (const c of near) { const k = Math.round(c.top); count.set(k, (count.get(k) || 0) + 1); }
  const level = Number([...count].sort((a, b) => b[1] - a[1])[0][0]);
  const at = near.filter(c => c.top >= level - 7 && c.top <= level + 5);
  return { level, left: Math.min(...at.map(c => c.left)), right: Math.max(...at.map(c => c.right)) };
}

const underside = (cols, left, right) => Math.min(...cols.filter(c => c && c.left >= left && c.right <= right).map(c => c.bottom));

// Writes a world-space rectangle back as the platform's body.
function setBody(doc, id, rect) {
  const p = doc.layout.platforms.find(q => q.id === id);
  const size = doc.textureSizes[p.textureKey], sx = Math.abs(p.scaleX || 1), sy = Math.abs(p.scaleY || 1);
  const round = v => Math.round(v * 1000) / 1000;
  p.body = { ...p.body,
    width: round(rect.right - rect.left), height: round(rect.bottom - rect.top),
    offsetX: round((rect.left - p.x + size.width * sx / 2) / sx), offsetY: round((rect.top - p.y + size.height * sy / 2) / sy) };
}

async function fit(doc) {
  const geo = geometryFromMap(doc), old = id => geo.colliders.find(c => c.id === id) || geo.anchors[id];
  const { camera } = mapArena(doc);
  const base = doc.scenery.layers.find(l => l.id === 'island-base');
  const img = await alphaOf(base.url);
  const s = base.scale || 1;
  const x0 = camera.x + camera.width / 2 + (base.x || 0) - img.w * s / 2;
  const y0 = camera.y + camera.height / 2 + (base.y || 0) - img.h * s / 2;
  const cols = columns(img, x0, y0, s);
  const rects = {};
  const mid = surface(cols, old('p0')), pillar = surface(cols, old('p1')), left = surface(cols, old('p2')), right = surface(cols, old('p3'));
  rects.p0 = { left: mid.left, right: mid.right, top: mid.level + SINK, bottom: underside(cols, mid.left, mid.right) - 4 };
  rects.p1 = { left: pillar.left, right: pillar.right, top: pillar.level + SINK, bottom: rects.p0.top + PILLAR_DEPTH };
  rects.p2 = { left: left.left, right: mid.left + OVERLAP, top: left.level + SINK, bottom: underside(cols, left.left, mid.left) - 4 };
  rects.p3 = { left: mid.right - OVERLAP, right: right.right, top: right.level + SINK, bottom: underside(cols, mid.right, right.right) - 4 };
  // Floating platforms: grass extents and surface from their own texture.
  for (const p of doc.layout.platforms) {
    if (rects[p.id] || !/^p\d+$/.test(p.id)) continue;
    const timg = await alphaOf(doc.assets[p.textureKey].url), sx = Math.abs(p.scaleX || 1), sy = Math.abs(p.scaleY || 1);
    const tcols = columns(timg, p.x - timg.w * sx / 2, p.y - timg.h * sy / 2, sx);
    const count = new Map();
    for (const c of tcols) if (c) { const k = Math.round(c.top * 10) / 10; count.set(k, (count.get(k) || 0) + 1); }
    const level = Number([...count].sort((a, b) => b[1] - a[1])[0][0]);
    const at = tcols.filter(c => c && c.top <= level + 5); // grass, its rounded ends and bumps
    const was = old(p.id);
    rects[p.id] = { left: Math.min(...at.map(c => c.left)), right: Math.max(...at.map(c => c.right)), top: level + SINK, bottom: level + SINK + (was.bottom - was.top) };
  }
  // Shift the island art (and the main rows with it) so the middle floor stays on MAIN_FLOOR.
  const shift = MAIN_FLOOR - rects.p0.top;
  for (const id of ['p0', 'p1', 'p2', 'p3']) { rects[id].top += shift; rects[id].bottom += shift; }
  const report = [`island art y ${base.y || 0} -> ${(base.y || 0) + shift}`];
  for (const [id, r] of Object.entries(rects)) {
    const o = old(id);
    report.push(`${id}: x ${o.left.toFixed(1)}-${o.right.toFixed(1)} -> ${r.left.toFixed(1)}-${r.right.toFixed(1)}, top ${o.top.toFixed(1)} -> ${r.top.toFixed(1)}, bottom ${o.bottom.toFixed(1)} -> ${r.bottom.toFixed(1)}`);
  }
  return { rects, report, artY: (base.y || 0) + shift };
}

(async () => {
  const shipped = require('../../../src/shared/maps/2.json');
  const effective = mapRepository.get(2).document;
  const fits = { shipped: await fit(shipped), effective: await fit(effective) };
  for (const [name, f] of Object.entries(fits)) console.log(`\n${name} map:\n  ` + f.report.join('\n  '));
  if (!INSTALL) return;
  updateSkySoil((doc, { shipped: isShipped }) => {
    const f = fits[isShipped ? 'shipped' : 'effective'];
    for (const [id, rect] of Object.entries(f.rects)) setBody(doc, id, rect);
    for (const layer of doc.scenery.layers) if (layer.id === 'island-base' || layer.id === 'island-front') layer.y = f.artY;
  });
  console.log('installed');
})().catch(e => { console.error(e); process.exit(1); });
