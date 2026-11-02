#!/usr/bin/env node
// Audits the built Iron Junction against the shared movement physics.
//
//   node scripts/maps/check-iron-junction.cjs
//
// The previous version of this checker passed a level you could not get out
// of, because it only asked whether a character FITS under a ledge. Standing
// room is not enough: a jump needs about 110px of clear air, so a surface with
// a deck 60px above it is a place you can walk into and never leave. Every
// check here works on "clear spans" instead -- the parts of a walkable top
// that have HEADROOM of free air above them -- and ignores the rest.
//
// It also checks reachability in BOTH directions. A one-way drop into a pit is
// just as broken as a sealed room, and only the reverse search finds it.

const movement = require("../../src/shared/physics/movementPhysics.json");
const { document, BOUNDS, HIGH, MID, FLOOR, TUNNEL_FLOOR, PERCH, PERCH_TOP } = require("./build-iron-junction.cjs");

const S = movement.maxSpeed;
const V = movement.jumpSpeed;
const G = movement.gravity;

// How high a jump actually gets, and how far it reaches at a given rise.
const PEAK_RISE = (V * V) / (2 * G);
const reach = (rise) => (rise >= PEAK_RISE ? 0 : (S * (V + Math.sqrt(V * V - 2 * G * rise))) / G);

// A jump needs clear air to happen in, not just room to stand.
const HEADROOM = 110;
// The tallest character body, used for the places that only need standing room.
const BODY_H = 80;
const BODY_W = 56;
// The biggest rise allowed in the level. A jump goes higher, but a climb that
// needs a perfect jump is a climb most players miss.
const MAX_STEP = 100;
// Jumps land short of the ideal arc, because falling is faster than rising.
const REACH_MARGIN = 0.85;

const problems = [];
const fail = (msg) => problems.push(msg);

const rects = document.layout.hitboxes.map((h) => ({
  id: h.id,
  left: h.x - h.width / 2,
  right: h.x + h.width / 2,
  top: h.y - h.height / 2,
  bottom: h.y + h.height / 2,
  // Decks and ledges are one-way: you jump up through them, so they neither
  // block a jump from below nor seal the ground underneath.
  oneWay: h.collision?.down === false,
}));
const solids = rects.filter((r) => !BOUNDS.has(r.id));

/**
 * The parts of `rect`'s top with at least `clearance` of free air above.
 * Anything overhead that comes lower than that cuts the top into pieces.
 */
function clearSpans(rect, clearance) {
  let spans = [[rect.left, rect.right]];
  for (const other of rects) {
    if (other === rect || other.oneWay || other.bottom <= rect.top - clearance || other.bottom > rect.top + 1) continue;
    const next = [];
    for (const [a, b] of spans) {
      if (other.right <= a || other.left >= b) { next.push([a, b]); continue; }
      if (other.left > a) next.push([a, other.left]);
      if (other.right < b) next.push([other.right, b]);
    }
    spans = next;
  }
  return spans.filter(([a, b]) => b - a >= BODY_W);
}

// Every piece of walkable ground a character can both stand on and jump from.
const nodes = [];
for (const rect of solids) {
  for (const [left, right] of clearSpans(rect, HEADROOM)) {
    nodes.push({ id: `${rect.id}[${Math.round(left)}..${Math.round(right)}]`, rect, left, right, top: rect.top });
  }
}

// Ground a character can stand on, jumping aside: used for spawns and objects,
// which only have to be legal places to be.
const standing = [];
for (const rect of solids) {
  for (const [left, right] of clearSpans(rect, BODY_H)) standing.push({ rect, left, right, top: rect.top });
}

/** Can you get from node `a` to node `b` in one move? */
function connects(a, b) {
  if (a === b) return false;
  const rise = a.top - b.top; // positive means b is higher
  if (rise > MAX_STEP) return false;
  const gap = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
  if (rise <= 0) {
    // Falling or level: the fall itself carries you, so the only limit is how
    // far you travel before you drop past the target.
    const fall = -rise;
    const airtime = (V + Math.sqrt(V * V + 2 * G * fall)) / G;
    return gap <= S * airtime * REACH_MARGIN;
  }
  return gap <= reach(rise) * REACH_MARGIN;
}

const edges = new Map(nodes.map((n) => [n, []]));
const back = new Map(nodes.map((n) => [n, []]));
for (const a of nodes) for (const b of nodes) if (connects(a, b)) { edges.get(a).push(b); back.get(b).push(a); }

function search(from, adjacency) {
  const seen = new Set(from);
  const queue = [...from];
  while (queue.length) for (const next of adjacency.get(queue.shift())) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  return seen;
}

/** The node under a point, if that point is a legal place to stand. */
function groundAt(x, y, list = nodes) {
  const under = list.filter((n) => x >= n.left - 1 && x <= n.right + 1 && n.top >= y - 4);
  under.sort((a, b) => a.top - b.top);
  return under[0] || null;
}

// ---------------------------------------------------------------------------
// Spawns
// ---------------------------------------------------------------------------
const anchors = new Map(rects.map((r) => [r.id, r]));
const spawnPoints = [];
for (const [team, list] of Object.entries(document.spawns.players)) {
  list.forEach((p, i) => {
    const anchor = p.anchorId ? anchors.get(p.anchorId) : null;
    if (p.anchorId && !anchor) return fail(`spawn ${team}[${i}] anchors to missing ${p.anchorId}`);
    const x = anchor ? (anchor.left + anchor.right) / 2 + (p.dx || 0) : p.x;
    const y = anchor ? anchor.top - 60 : p.y;
    const node = groundAt(x, y);
    if (!node) fail(`spawn ${team}[${i}] at x=${Math.round(x)} has no ground with ${HEADROOM}px of clear air above it`);
    else spawnPoints.push({ team, node, x });
  });
}

// ---------------------------------------------------------------------------
// Reachability, both ways
// ---------------------------------------------------------------------------
const starts = [...new Set(spawnPoints.map((s) => s.node))];
const forward = search(starts, edges);
const backward = search(starts, back);

for (const node of nodes) {
  if (!forward.has(node)) fail(`${node.id} cannot be reached from any spawn`);
  else if (!backward.has(node)) fail(`${node.id} is a one-way trap: you can get in but not back to a spawn`);
}

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------
const bb = document.objectiveLayout.bankBust;
const checkPoint = (label, x, y) => {
  if (!groundAt(x, y, standing)) fail(`${label} at (${Math.round(x)}, ${Math.round(y)}) has nothing under it`);
};
for (const [team, v] of Object.entries(bb.vaults)) checkPoint(`${team} vault`, v.x, v.y + v.height / 2);
for (const o of bb.objects) checkPoint(o.id, o.x, o.y);
checkPoint("centre gold", bb.centerGold.x, bb.centerGold.y);
for (const p of bb.randomGoldSpawnPoints) checkPoint(p.id, p.x, p.y);
for (const p of document.spawns.powerups) checkPoint(p.id, p.x, p.y);

// ---------------------------------------------------------------------------
// The firing perch
// ---------------------------------------------------------------------------
// Standing or jumping on the perch you must be able to hit the vault through the
// hatch, past every deck. With the hatch wall built, you must not.
const crosses = (a, b, r) => {
  let lo = 0, hi = 1;
  for (const [o, d, min, max] of [[a.x, b.x - a.x, r.left, r.right], [a.y, b.y - a.y, r.top, r.bottom]]) {
    if (Math.abs(d) < 1e-9) { if (o < min || o > max) return false; continue; }
    const u = (min - o) / d, v = (max - o) / d;
    lo = Math.max(lo, Math.min(u, v));
    hi = Math.min(hi, Math.max(u, v));
  }
  return lo <= hi;
};
const SHOT_HEIGHT = 44;
const vault = bb.vaults.team1;
const vaultPoints = [-80, -40, 0, 40, 80].map((dx) => ({ x: vault.x + dx, y: vault.y - vault.height / 2 + 10 }));
const hatchWall = bb.objects.find((o) => o.id === "wall-team1-hatch");
const hatchRect = { left: hatchWall.x - hatchWall.width / 2, right: hatchWall.x + hatchWall.width / 2,
  top: hatchWall.y - hatchWall.height / 2, bottom: hatchWall.y + hatchWall.height / 2 };
const terrain = rects.filter((r) => !BOUNDS.has(r.id));
// The perch blocks its own far end's shots, so the line is from the hatch end.
const FIRING_END = 56;
for (let x = PERCH[0] + 8; x <= PERCH[1] - 8; x += 12) {
  for (const lift of [0, PEAK_RISE]) {
    const from = { x, y: PERCH_TOP - SHOT_HEIGHT - lift };
    const open = vaultPoints.filter((p) => !terrain.some((r) => crosses(from, p, r)));
    if (!open.length && x <= PERCH[0] + FIRING_END) fail(`perch x=${x} lift=${Math.round(lift)} has no line of fire on the vault`);
    if (open.some((p) => !crosses(from, p, hatchRect))) fail(`hatch wall misses a shot from perch x=${x} lift=${Math.round(lift)}`);
  }
}

// ---------------------------------------------------------------------------
// Symmetry and containment
// ---------------------------------------------------------------------------
const W = 5000;
const key = (r) => `${Math.round(r.left)}|${Math.round(r.top)}|${Math.round(r.right - r.left)}|${Math.round(r.bottom - r.top)}`;
const present = new Set(solids.map(key));
for (const r of solids) {
  const mirrored = { left: W - r.right, right: W - r.left, top: r.top, bottom: r.bottom };
  if (!present.has(key(mirrored))) fail(`${r.id} has no mirror image on the other side`);
}

const arena = require("../../src/shared/maps/arenas.json")[document.modeVariantId]?.world;
if (arena) {
  for (const r of solids) {
    if (r.left < arena.x - 1 || r.right > arena.x + arena.width + 1 || r.top < arena.y - 1 || r.bottom > arena.y + arena.height + 1) {
      fail(`${r.id} sticks out of the world box`);
    }
  }
} else fail(`arenas.json has no world for ${document.modeVariantId}`);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const hops = (() => {
  const dist = new Map(starts.filter((n) => spawnPoints.find((s) => s.node === n && s.team === "team1")).map((n) => [n, 0]));
  const queue = [...dist.keys()];
  while (queue.length) {
    const n = queue.shift();
    for (const next of edges.get(n)) if (!dist.has(next)) { dist.set(next, dist.get(n) + 1); queue.push(next); }
  }
  return dist;
})();

const band = (top, label) => {
  const list = nodes.filter((n) => Math.abs(n.top - top) < 4);
  const near = list.map((n) => hops.get(n)).filter((v) => v !== undefined);
  return `  ${label.padEnd(16)}${String(list.length).padStart(2)} spans  x ${Math.round(Math.min(...list.map((n) => n.left)))}..${Math.round(Math.max(...list.map((n) => n.right)))}  ${near.length ? `${Math.min(...near)}-${Math.max(...near)} hops from spawn` : "UNREACHABLE"}`;
};

const vaultGap = Math.abs(bb.vaults.team2.x - bb.vaults.team1.x);
console.log(`world            ${W} x ${arena?.height} at (${arena?.x}, ${arena?.y})`);
console.log(`walkable spans   ${nodes.length} (from ${solids.length} colliders)`);
console.log(`jump arc         ${Math.round(PEAK_RISE)}px up, ${Math.round(reach(0))}px flat, ${Math.round(reach(90))}px while climbing 90`);
console.log(`headroom rule    ${HEADROOM}px of clear air over every walkable span`);
console.log(`vault to vault   ${Math.round(vaultGap)}px, ${(vaultGap / S).toFixed(1)}s at full run`);
console.log(`vault to centre  ${Math.round(vaultGap / 2)}px, ${(vaultGap / 2 / S).toFixed(1)}s at full run`);
console.log("Routes");
console.log(band(HIGH, "catwalks"));
console.log(band(MID, "main lane"));
console.log(band(FLOOR, "floor"));
console.log(band(TUNNEL_FLOOR, "tunnel"));

if (problems.length) {
  console.log(`\n${problems.length} problem${problems.length > 1 ? "s" : ""}:`);
  for (const p of problems) console.log("  -", p);
  process.exit(1);
}
console.log("\nNo problems found.");
