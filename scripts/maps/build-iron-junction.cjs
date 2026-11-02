#!/usr/bin/env node
// Builds the Iron Junction (map 4) document for Bank Bust.
//
//   node scripts/maps/build-iron-junction.cjs     <- geometry + shape list
//   node scripts/art/bake-iron-junction.cjs       <- one image per shape
//   node scripts/maps/build-iron-junction.cjs     <- picks the art back up
//   node scripts/maps/check-iron-junction.cjs     <- always run this after
//
// The level is authored here so the two halves stay exact mirrors and every
// climb can be checked against the shared movement physics. It writes
// src/shared/maps/4.json (the shipped default), data/maps/4.json (the runtime
// override that wins at match time) and the shape list the art bake reads.
//
// ---------------------------------------------------------------------------
// The shape of the level
// ---------------------------------------------------------------------------
//   HIGH   jump-through catwalks over the whole level: balconies with the mine
//          and turret, split by a hatch over the vault, then decks to the middle.
//   MID    the base's top, where the vault stands, a jump-through lane out of
//          it, and the top of the hill in the centre.
//   FLOOR  one flat floor between the bases' stairs, broken only by the hill.
//   TUNNEL under all of it, joining the two low points. It is an S-bend at each
//          end: the shaft drops onto a shelf, a low passage leads back under the
//          stairs, and round the end of the shelf is the run under the hill.
//
// Three rules decide every number below, all enforced by the checker:
//
//   CLIMB     every storey is three big hops. Solid steps rise 96px, which keeps
//             their faces short enough not to catch a wall slide, and ledges rise
//             100px. A jump peaks near 120, so none of them needs a perfect jump.
//   ROUTES    each side has two climbs to HIGH, one beside the base and one
//             beside the hill. Ledges and decks are one-way, so you jump up
//             through them and they never seal the ground beneath them.
//   CLEARANCE nothing drawn touches anything else it isn't meant to. Solid ground
//             never runs under a deck, and a ledge sits in the gap between decks
//             rather than under one.
//
// All x positions and heights are multiples of 4, the art's pixel size.

const fs = require("fs");
const path = require("path");
const { validateDocument } = require("../../src/shared/maps/mapDocument");

const ROOT = path.resolve(__dirname, "..", "..");
const ASSET_DIR = path.join(ROOT, "public", "assets", "bank-bust");
const SHAPE_MANIFEST = path.join(__dirname, "iron-junction-shapes.json");

// ---------------------------------------------------------------------------
// World frame
// ---------------------------------------------------------------------------
const WIDTH = 5000;
const CX = WIDTH / 2;
const mx = (x) => WIDTH - x;

const TOP = -420;
const BOTTOM = 1000;
// Art runs past the world into the camera's margins, so the level has no edge:
// there is solid wall out to the side of the screen and solid ground below it.
const ART_TOP = -540;
const ART_BOTTOM = 1140;
const ART_SIDE = 240;

const STEP = 96;
const LEDGE_STEP = 100;
const FLOOR = 540;
const MID = FLOOR - STEP * 3;
const HIGH = MID - LEDGE_STEP * 3;
// Both tunnel levels have 136px of air. Their steps are a little taller than the
// rest of the level, which keeps the climb out to two hops per storey.
const TUNNEL_STEP = 88;
const TUNNEL_AIR = 136;
const SHELF = FLOOR + TUNNEL_STEP * 2;
const PASSAGE_ROOF = SHELF - TUNNEL_AIR;
const TUNNEL_FLOOR = SHELF + TUNNEL_STEP * 2;
const TUNNEL_CEILING = TUNNEL_FLOOR - TUNNEL_AIR;

// One-way colliders only need enough depth to catch a falling player.
const WALKWAY_COLLIDER = 24;
const DECK_ART_HEIGHT = 76;
const LEDGE_ART_HEIGHT = 44;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------
// Every platform registers the image it needs here. The bake reads this list,
// writes shape-<id>.webp at exactly that size, and the next run measures the
// file off disk to confirm.
const shapes = new Map();
const platforms = [];
const hitboxes = [];
const solidRects = [];

const round = (n) => Math.round(n * 100) / 100;

/** Real frame size of an installed WebP, or null when it is not there yet. */
function measure(file) {
  const full = path.join(ASSET_DIR, file);
  if (!fs.existsSync(full)) return null;
  const buf = fs.readFileSync(full);
  const vp8 = buf.indexOf("VP8 ", 12, "ascii");
  if (vp8 >= 0) {
    const o = vp8 + 8 + 6;
    return { width: buf.readUInt16LE(o) & 0x3fff, height: buf.readUInt16LE(o + 2) & 0x3fff };
  }
  const vp8l = buf.indexOf("VP8L", 12, "ascii");
  if (vp8l >= 0) {
    const bits = buf.readUInt32LE(vp8l + 9);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  const vp8x = buf.indexOf("VP8X", 12, "ascii");
  if (vp8x >= 0) {
    const o = vp8x + 8 + 4;
    return {
      width: (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16)) + 1,
      height: (buf[o + 3] | (buf[o + 4] << 8) | (buf[o + 5] << 16)) + 1,
    };
  }
  return null;
}

const missing = [];

/**
 * Register one image and place it. `id` is the shape, not the instance: the
 * mirrored half passes the same id with flipX, so both sides are literally the
 * same pixels reflected. `left`/`top` of the first use are the world position
 * the bake samples, so the first use must be the left-hand one.
 */
function shape(id, kind, instance, left, right, top, height, flipX = false) {
  const width = Math.round(right - left);
  if (!shapes.has(id)) {
    const size = measure(`shape-${id}.webp`);
    const fits = size && size.width === width && size.height === Math.round(height);
    if (!fits) missing.push(id);
    shapes.set(id, { id, kind, left, top, width, height: Math.round(height), baked: !!fits });
  } else {
    const existing = shapes.get(id);
    if (existing.width !== width || existing.height !== Math.round(height)) {
      throw new Error(`shape ${id} is used at two different sizes`);
    }
  }
  if (!shapes.get(id).baked) return;
  platforms.push({
    textureKey: `bank-bust-shape-${id}`,
    x: round(left + width / 2),
    y: round(top + height / 2),
    scaleX: 1, scaleY: 1,
    flipX,
    body: { width: 1, height: 1, offsetX: 0, offsetY: 0 },
    collisionEnabled: false,
    id: instance,
  });
}

function box(id, left, right, top, bottom, oneWay = false) {
  hitboxes.push({
    x: round((left + right) / 2),
    y: round((top + bottom) / 2),
    width: round(right - left),
    height: round(bottom - top),
    collision: { up: true, down: !oneWay, left: !oneWay, right: !oneWay },
    id,
  });
}

/**
 * Solid ground down to the bottom of the world.
 *
 * Bot navigation samples a fixed number of take-off points per collider, so a
 * long run is cut into segments. It is only collision: the image is drawn from
 * the union of all of these, so nothing shows at the joins.
 */
function solid(id, left, right, top, segments = 1, bottom = BOTTOM) {
  solidRects.push({ left, right, top, bottom: bottom === BOTTOM ? ART_BOTTOM : bottom });
  for (let i = 0; i < segments; i++) {
    const a = left + ((right - left) * i) / segments;
    const b = left + ((right - left) * (i + 1)) / segments;
    box(segments > 1 ? `${id}-${i + 1}-body` : `${id}-body`, a, b, top, bottom);
  }
}

/** A catwalk or ledge, placed on both sides of the level. */
function walkway(kind, id, a, b, top) {
  const height = kind === "deck" ? DECK_ART_HEIGHT : LEDGE_ART_HEIGHT;
  for (const [side, flip] of [["l", false], ["r", true]]) {
    const left = flip ? mx(b) : a;
    const right = flip ? mx(a) : b;
    shape(id, kind, `${id}-${side}`, left, right, top, height, flip);
    box(`${id}-${side}-body`, left, right, top, top + WALKWAY_COLLIDER, true);
  }
}

// ---------------------------------------------------------------------------
// Containment
// ---------------------------------------------------------------------------
// The strips just outside the world box. The visible sides of the level are the
// side walls below.
const BOUNDS = new Set(["wall-l-body", "wall-r-body", "ceiling-body"]);
box("wall-l-body", -160, 0, TOP - 200, BOTTOM);
box("wall-r-body", WIDTH, WIDTH + 160, TOP - 200, BOTTOM);
box("ceiling-body", 0, WIDTH, TOP - 200, TOP);

// ---------------------------------------------------------------------------
// The side walls
// ---------------------------------------------------------------------------
// Solid from the playable edge all the way off the side of the screen, with a
// finished column on the face you can touch.
const SIDE_WALL = 96;
for (const [side, flip] of [["l", false], ["r", true]]) {
  const left = flip ? WIDTH - SIDE_WALL : 0;
  const artLeft = flip ? left : -ART_SIDE;
  shape("side-wall", "wall", `side-wall-${side}`, artLeft, artLeft + ART_SIDE + SIDE_WALL, ART_TOP, ART_BOTTOM - ART_TOP, flip);
  solidRects.push({ left, right: left + SIDE_WALL, top: ART_TOP, bottom: ART_BOTTOM });
  box(`side-wall-${side}-body`, left, left + SIDE_WALL, TOP, BOTTOM);
}

// ---------------------------------------------------------------------------
// The base
// ---------------------------------------------------------------------------
// A block from the side wall to the top of the stairs, whose top is the vault's
// floor, then two wide treads down to the level's floor. Drawn as one image.
const BASE_END = 1440;
const TREAD = 180;
const STAIR_END = BASE_END + TREAD * 2;
for (const [side, flip] of [["l", false], ["r", true]]) {
  const span = (a, b) => (flip ? [mx(b), mx(a)] : [a, b]);
  solid(`chamber-${side}`, ...span(SIDE_WALL, BASE_END), MID, 3);
  for (let i = 0; i < 2; i++) {
    // The lower tread is the roof of the tunnel's side passage.
    solid(`gate-${side}-${i + 1}`, ...span(BASE_END + TREAD * i, BASE_END + TREAD * (i + 1)), MID + STEP * (i + 1),
      1, i >= 1 ? PASSAGE_ROOF : BOTTOM);
  }
  const [left, right] = span(SIDE_WALL, STAIR_END);
  shape("base", "solid", `base-${side}`, left, right, MID, ART_BOTTOM - MID, flip);
}

// ---------------------------------------------------------------------------
// The floor and the hill
// ---------------------------------------------------------------------------
// One flat run between the two stairs with a single wide hill in the middle,
// which is the floor's way up to the centre gold, and the tunnel underneath.
// One image, its own mirror.
//
// A shaft opens in the floor on each side of the hill, short enough to jump
// across. Falling in lands you on a shelf, not in the tunnel: you still have to
// choose to walk back under the stairs and drop off the end of the shelf. Back up
// is a solid step at the end of the run, then a one-way ledge in the shaft.
const HILL_START = 2140;
const HILL_TREAD = 120;
const HILL_TOP = [HILL_START + HILL_TREAD * 2, mx(HILL_START + HILL_TREAD * 2)];
const SHAFT = [1860, 2052];
const PASSAGE_END = BASE_END + TREAD;
const BEND_STEP = PASSAGE_END + 72;
const SHELF_START = BEND_STEP + 112;
solid("bend-step-l", PASSAGE_END, BEND_STEP, TUNNEL_FLOOR - TUNNEL_STEP);
solid("bend-step-r", mx(BEND_STEP), mx(PASSAGE_END), TUNNEL_FLOOR - TUNNEL_STEP);
solid("floor-lip-l", STAIR_END, SHAFT[0], FLOOR, 1, PASSAGE_ROOF);
solid("floor-lip-r", mx(SHAFT[0]), mx(STAIR_END), FLOOR, 1, PASSAGE_ROOF);
solid("shelf-l", SHELF_START, SHAFT[1], SHELF, 1, TUNNEL_CEILING);
solid("shelf-r", mx(SHAFT[1]), mx(SHELF_START), SHELF, 1, TUNNEL_CEILING);
solid("floor-l", SHAFT[1], HILL_START, FLOOR, 1, TUNNEL_CEILING);
solid("floor-r", mx(HILL_START), mx(SHAFT[1]), FLOOR, 1, TUNNEL_CEILING);
for (let i = 0; i < 2; i++) {
  const a = HILL_START + HILL_TREAD * i;
  const top = FLOOR - STEP * (i + 1);
  solid(`hill-l-${i + 1}`, a, a + HILL_TREAD, top, 1, TUNNEL_CEILING);
  solid(`hill-r-${i + 1}`, mx(a + HILL_TREAD), mx(a), top, 1, TUNNEL_CEILING);
}
solid("hill-top", HILL_TOP[0], HILL_TOP[1], MID, 1, TUNNEL_CEILING);
solid("tunnel", BEND_STEP, mx(BEND_STEP), TUNNEL_FLOOR, 6);
shape("floor", "solid", "floor", STAIR_END, mx(STAIR_END), MID, ART_BOTTOM - MID);

// The tunnel's back wall, behind the ground so the only part you see is the
// opening. Without it the hall backdrop would show straight through.
shape("tunnel-back", "tunnel", "tunnel-back", PASSAGE_END, mx(PASSAGE_END), FLOOR, TUNNEL_FLOOR - FLOOR + 8);
const tunnelBack = platforms.find((p) => p.id === "tunnel-back");
if (tunnelBack) tunnelBack.depth = -3;

// ---------------------------------------------------------------------------
// MID: the lane
// ---------------------------------------------------------------------------
// One bridge from the stairs towards the hill, a flat jump from each end.
walkway("deck", "lane", 1620, 2200, MID);

// ---------------------------------------------------------------------------
// HIGH: the catwalks
// ---------------------------------------------------------------------------
// The gap between the balconies is directly over the vault. It is a short enough
// jump to cross, and a straight drop onto the vault for anyone coming over the top.
const VAULT_X = 700;
const HATCH = [VAULT_X - 88, VAULT_X + 88];
walkway("deck", "balcony-back", SIDE_WALL, HATCH[0], HIGH);
walkway("deck", "balcony-front", HATCH[1], 1180, HIGH);
// The firing perch. Decks stop shots, so from the deck you can barely see the
// vault, but one step up you can fire down through the hatch at it. HATCH_WALL is
// the answer: an upright wall on the lip, between the perch and the gap.
const PERCH = [844, 964];
const PERCH_TOP = HIGH - 76;
const HATCH_WALL_X = HATCH[1] + 24;
walkway("ledge", "perch", PERCH[0], PERCH[1], PERCH_TOP);
walkway("deck", "gantry", 1480, 2140, HIGH);
// The centre deck is its own mirror.
shape("gantry-centre", "deck", "gantry-centre", 2340, mx(2340), HIGH, DECK_ART_HEIGHT);
box("gantry-centre-body", 2340, mx(2340), HIGH, HIGH + WALKWAY_COLLIDER, true);

// ---------------------------------------------------------------------------
// The climbs
// ---------------------------------------------------------------------------
// Two ledges, each in a gap between catwalks and nearly above one another, so
// MID to HIGH is three jumps with barely any steering between them.
walkway("ledge", "climb-base-1", 1212, 1332, MID - LEDGE_STEP);
walkway("ledge", "climb-base-2", 1268, 1388, MID - LEDGE_STEP * 2);
walkway("ledge", "climb-hill-1", 2260, 2380, MID - LEDGE_STEP);
walkway("ledge", "climb-hill-2", 2200, 2320, MID - LEDGE_STEP * 2);
walkway("ledge", "shaft-ledge", SHAFT[1] - 72, SHAFT[1], SHELF - TUNNEL_STEP);

// ---------------------------------------------------------------------------
// Scenery pinned to the level
// ---------------------------------------------------------------------------
const BACK = -3;

// The bank fittings each vault stands among, with a gap in the middle for it.
const BACKDROP = { key: "bank-bust-base-backdrop", file: "base-backdrop.webp" };
const backdropSize = measure(BACKDROP.file);
if (backdropSize) {
  for (const [side, flip] of [["l", false], ["r", true]]) {
    platforms.push({
      textureKey: BACKDROP.key,
      x: round(flip ? mx(VAULT_X) : VAULT_X),
      y: round(MID - backdropSize.height / 2),
      scaleX: 1, scaleY: 1, flipX: flip,
      body: { width: 1, height: 1, offsetX: 0, offsetY: 0 },
      collisionEnabled: false,
      id: `base-backdrop-${side}`,
      depth: BACK,
    });
  }
}

// ---------------------------------------------------------------------------
// Machinery set into the brick
// ---------------------------------------------------------------------------
// A few animated pieces, each different and used once, so the walls have things to
// notice rather than a pattern. They are slow and spend most of their loop still:
// `sequence` holds on a frame by repeating it. Painted by Codex and installed by
// scripts/art/install-iron-junction-deco.cjs.
//
// They do not mirror. The level's geometry has to be fair; its decoration does not.
const DECO = {
  clock: { rate: 3, sequence: [0, 1, 2, 3] },
  coinchute: { rate: 3, sequence: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 0, 1, 2, 3] },
  furnace: { rate: 2, sequence: [0, 1, 2, 3, 1, 0, 3, 2] },
  fusebox: { rate: 1, sequence: [0, 1, 2, 3] },
  rat: { rate: 3, sequence: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 1, 2, 2, 1, 0, 3, 0] },
  valve: { rate: 3, sequence: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 3] },
};
// `air` pieces hang on the tunnel's back wall rather than in the brick.
const DECO_PLACES = [
  { type: "furnace", x: 300, y: 470 },
  { type: "clock", x: 1060, y: 480 },
  { type: "rat", x: 2230, floor: TUNNEL_FLOOR, air: true },
  { type: "valve", x: 3510, y: 480 },
  { type: "fusebox", x: 3940, y: 480 },
  { type: "coinchute", x: 4440, y: 480 },
];
const decoSize = (type) => {
  const size = measure(`deco-${type}.webp`);
  return size && { width: size.width / 4, height: size.height };
};
function placeDeco() {
  const covered = (l, r, t, b) => {
    for (let x = l; x <= r; x += 8) for (let y = t; y <= b; y += 8) {
      if (!solidRects.some((s) => x >= s.left && x <= s.right && y >= s.top && y <= s.bottom)) return false;
    }
    return true;
  };
  for (const { type, x, y: at, floor, air } of DECO_PLACES) {
    const size = decoSize(type);
    if (!size) continue;
    const y = floor !== undefined ? floor - size.height / 2 : at;
    if (!air && !covered(x - size.width / 2, x + size.width / 2, y - size.height / 2 - 40, y + size.height / 2)) {
      throw new Error(`${type} at ${x},${y} is not inside solid ground`);
    }
    platforms.push({
      textureKey: `bank-bust-deco-${type}`,
      x: round(x), y: round(y),
      scaleX: 1, scaleY: 1, flipX: false,
      body: { width: 1, height: 1, offsetX: 0, offsetY: 0 },
      collisionEnabled: false,
      id: `deco-${type}`,
      depth: 1,
    });
  }
}
placeDeco();

// ---------------------------------------------------------------------------
// Objective layout
// ---------------------------------------------------------------------------
// Exactly the installed frame size, so the vault draws 1:1. It tops out just
// under the catwalks either side of the hatch.
const VAULT = { width: 216, height: 224, radius: 150 };
const vaultY = MID - VAULT.height / 2;

// Upright and about a jump high: a built wall stops a run and blocks shots, but
// it has no health, so it must never be able to lock the enemy out of a base.
// The hatch wall can be taller because the hatch is never the only way in, and it
// has to stop a shot from someone jumping on the perch.
const wallSlot = (id, x, surface, height = 96) => ({
  id, type: "wallSlot", x: round(x), y: round(surface - height / 2),
  buildRadius: 110, cost: 5500, width: 48, height,
});

const PROP_FRAMES = require("../../src/client/game/modes/bankBust/propFrames.json");
const goldMine = (id, x) => ({
  id, type: "goldMine", x: round(x), y: round(HIGH - PROP_FRAMES.mine.frameHeight / 2), radius: 86,
  collectionRadius: 110, yieldAmount: 500, yieldIntervalMs: 5000, maxStoredGold: 2000,
});

const turret = (id, x) => ({
  id, type: "claimableTurret", x: round(x), y: round(HIGH - PROP_FRAMES["turret-mount"].frameHeight / 2),
  claimRadius: 110, claimCost: 8750, range: 560, fireRateMs: 950,
  damage: 700, projectileSpeed: 540, turnSpeed: 0.08,
});

const mirrorPoints = (rows) => rows.flatMap(([id, x, surface]) => [
  { id: `${id}-l`, x: round(x), y: round(surface - 40) },
  { id: `${id}-r`, x: round(mx(x)), y: round(surface - 40) },
]);

const objectiveLayout = {
  bankBust: {
    respawnPoints: { team1: { x: 1100, y: MID - 60 }, team2: { x: mx(1100), y: MID - 60 } },
    vaults: {
      team1: { x: VAULT_X, y: vaultY, ...VAULT, label: "Blue Vault" },
      team2: { x: mx(VAULT_X), y: vaultY, ...VAULT, label: "Red Vault" },
    },
    // One contested pile on top of the hill, in the open with a deck overhead.
    centerGold: { x: CX, y: MID - 58, width: 124, height: 116, radius: 60, reward: 7500, health: 15000 },
    objects: [
      goldMine("mine-team1", 340),
      goldMine("mine-team2", mx(340)),
      turret("turret-team1", 1080),
      turret("turret-team2", mx(1080)),
      // One slot per way in: the top of the stairs, the catwalk, the floor.
      wallSlot("wall-team1-main", 1416, MID),
      wallSlot("wall-team1-upper", 1520, HIGH),
      wallSlot("wall-team1-low", 1830, FLOOR),
      wallSlot("wall-team2-main", mx(1416), MID),
      wallSlot("wall-team2-upper", mx(1520), HIGH),
      wallSlot("wall-team2-low", mx(1830), FLOOR),
      // And one against the shot from the perch.
      wallSlot("wall-team1-hatch", HATCH_WALL_X, HIGH, 168),
      wallSlot("wall-team2-hatch", mx(HATCH_WALL_X), HIGH, 168),
    ],
    randomGoldSpawnPoints: mirrorPoints([
      ["gold-chamber", 1320, MID], ["gold-lane", 1800, MID],
      ["gold-balcony", 480, HIGH], ["gold-gantry", 1700, HIGH], ["gold-out", 2050, HIGH],
      ["gold-floor", 2096, FLOOR], ["gold-tunnel", 2380, TUNNEL_FLOOR], ["gold-shelf", 1880, SHELF], ["gold-hill", 2340, FLOOR - STEP * 2],
    ]),
  },
};

// ---------------------------------------------------------------------------
// Spawns
// ---------------------------------------------------------------------------
// Between the vault and the stairs, on the base's top.
const spawns = {
  players: {
    team1: [-210, -150, -90].map((dx) => ({ anchorId: "chamber-l-3-body", dx })),
    team2: [210, 150, 90].map((dx) => ({ anchorId: "chamber-r-1-body", dx })),
  },
  powerups: mirrorPoints([
    ["powerup-lane", 2080, MID], ["powerup-gantry", 2050, HIGH],
    ["powerup-tunnel", 2200, TUNNEL_FLOOR], ["powerup-centre", 2440, MID],
    ["powerup-balcony", 1000, HIGH],
  ]),
};

// ---------------------------------------------------------------------------
// Scenery layers and atmosphere
// ---------------------------------------------------------------------------
const installed = (file) => fs.existsSync(path.join(ASSET_DIR, file));
const ARENA_CAMERA = require("../../src/shared/maps/arenas.json")["bank-bust-3v3"].camera;
const CAMERA_CENTER = { x: ARENA_CAMERA.x + ARENA_CAMERA.width / 2, y: ARENA_CAMERA.y + ARENA_CAMERA.height / 2 };
const FRAMED_SHIFT = CAMERA_CENTER.y - 140;
const hasFarBg = installed("bg-far.webp");

// Three depths that move at different rates, instead of one backdrop pinned
// behind everything. A layer at scroll s slides (1 - s) of the level's width
// against the camera, so each strip is placed several times.
const layers = [{
  id: "hall",
  url: hasFarBg ? "/assets/bank-bust/bg-far.webp" : "/assets/bank-bust/gameBg.webp",
  scroll: 0.06,
  fit: "cover",
  filter: "nearest",
  ...(hasFarBg ? {} : { tint: "#5a6a93", alpha: 0.75 }),
}];
// The moving parts cut out of each backdrop by install-iron-junction-backdrop.cjs.
const PART_FILE = path.join(__dirname, "iron-junction-parts.json");
const LAYER_PARTS = fs.existsSync(PART_FILE) ? JSON.parse(fs.readFileSync(PART_FILE, "utf8")) : {};
const strip = (id, file, { scroll, y, scale = 1, alpha = 1, fog, spread }) => {
  if (!installed(file)) return;
  for (const [i, x] of spread.entries()) {
    layers.push({
      id: `${id}-${i}`, url: `/assets/bank-bust/${file}`, scroll,
      fit: "none", filter: "nearest", scale, x, y, alpha,
      ...(fog ? { fog } : {}),
      ...(LAYER_PARTS[file]?.length ? { parts: LAYER_PARTS[file] } : {}),
    });
  }
};
// The machinery hall: tanks, gantry crane and the clock, well behind the level.
strip("machinery", "machinery.webp", { scroll: 0.28, y: 300, scale: 1, alpha: 0.85, fog: 0.4, spread: [-2050, 0, 2050] });
// Pipe runs close behind the platforms, barely slower than they are. Held
// back: at full strength the same run repeating across the level reads as
// clutter rather than depth.
strip("pipes", "bg-pipes.webp", { scroll: 0.66, y: 150, scale: 1, alpha: 0.55, fog: 0.3, spread: [-1640, 0, 1640] });

// Atmosphere hangs off a named layer, and a layer only exists once its art is
// installed, so every reference falls back to the one behind it.
const ids = new Set(layers.map((l) => l.id));
const at = (...names) => names.find((n) => ids.has(n)) || "hall";

// Darkness over the tunnel and whoever is in it, baked to the opening's shape with
// soft holes under each lamp. It is a front layer so it covers fighters, which is
// what lets a lamp light them: step out of the light and they go dark.
const TUNNEL_SHADE = { file: "tunnel-shade.webp", left: PASSAGE_END, right: mx(PASSAGE_END), top: FLOOR, bottom: TUNNEL_FLOOR + 8 };
if (installed(TUNNEL_SHADE.file)) {
  layers.push({
    id: "tunnel-shade", url: `/assets/bank-bust/${TUNNEL_SHADE.file}`, scroll: 1, fit: "none", filter: "nearest", stack: "front", scale: 2,
    x: (TUNNEL_SHADE.left + TUNNEL_SHADE.right) / 2 - CAMERA_CENTER.x,
    y: (TUNNEL_SHADE.top + TUNNEL_SHADE.bottom) / 2 - CAMERA_CENTER.y,
  });
}

const TUNNEL_LAMPS = [
  ...[1900, 2140, 2380].flatMap((x) => [x, mx(x)]).map((x) => ({ x, y: TUNNEL_CEILING, length: TUNNEL_AIR, width: 300 })),
  // One over the shelf, and one that falls the whole way down the bend.
  ...[1800].flatMap((x) => [x, mx(x)]).map((x) => ({ x, y: PASSAGE_ROOF, length: TUNNEL_AIR, width: 260 })),
  ...[BEND_STEP + 56].flatMap((x) => [x, mx(x)]).map((x) => ({ x, y: PASSAGE_ROOF, length: TUNNEL_FLOOR - PASSAGE_ROOF, width: 340 })),
].sort((a, b) => a.x - b.x);

const scenery = {
  layers,
  atmosphere: {
    fogColor: "#131a33",
    // Soft light out of the tunnel's roof lamps. Every third one has a bad contact.
    lamps: TUNNEL_LAMPS.map(({ x, y, length, width }, i) => ({
      x: x - CAMERA_CENTER.x, y: y + 12 - CAMERA_CENTER.y, length: length - 12, width,
      color: "#ffc27a", alpha: [0.26, 0.36], periodMs: 2600 + (i % 4) * 700,
      flicker: i % 3 === 0 ? 0.6 : 0.12,
    })),
    glows: [
      // The lit face of the centre vault door, breathing behind the level.
      { after: "hall", x: 0, y: -40, scroll: 0.06, radius: 1400, color: "#ffb347", alpha: [0.12, 0.22], periodMs: 9000 },
      // Warm light out of each vault chamber, which is what makes the two
      // bases findable from the middle of a dark level.
      { after: "hall", x: -1500, y: 120, scroll: 0.06, radius: 820, color: "#ffc247", alpha: [0.1, 0.18], periodMs: 7000 },
      { after: "hall", x: 1500, y: 120, scroll: 0.06, radius: 820, color: "#ffc247", alpha: [0.1, 0.18], periodMs: 7000 },
      // Cold lamps over each rampart.
      { after: "hall", x: -2250, y: -120, scroll: 0.06, radius: 560, color: "#4fd6ff", alpha: [0.07, 0.13], periodMs: 7600 },
      { after: "hall", x: 2250, y: -120, scroll: 0.06, radius: 560, color: "#4fd6ff", alpha: [0.07, 0.13], periodMs: 7600 },
      // Warm spill off the gold in the middle, under the platforms.
      { after: "arena", x: 0, y: 150, scroll: 1, radius: 420, color: "#ffc247", alpha: [0.06, 0.13], periodMs: 5200 },
    ],
    mist: [
      // Haze between each depth is what makes them read as separate depths.
      { after: "hall", color: "#1b2446", alpha: 0.6, scroll: 0.06, y: 260, height: 620, speed: 5 },
      { after: at("machinery-1"), color: "#18214a", alpha: 0.42, scroll: 0.28, y: 380, height: 560, speed: 9 },
      { after: at("pipes-1", "machinery-1"), color: "#141d44", alpha: 0.26, scroll: 0.72, y: 470, height: 460, speed: 14 },
      { after: "arena", color: "#101a40", alpha: 0.3, scroll: 1, y: 560, height: 380, speed: 20 },
    ],
    rays: [
      // Shafts from the lamps above the gantry deck, angled across the hall.
      { after: at("machinery-1"), x: 0, y: -520, scroll: 0.28, count: 6, angle: 22, spread: 26,
        length: 1900, width: [110, 260], color: "#ffd9a0", alpha: [0.05, 0.13], periodMs: [4200, 8600] },
    ],
    dust: [
      { after: "hall", color: "#6f87c4", count: 14, superHighCount: 24, scroll: 0.1, size: [18, 40], alpha: 0.16 },
      { after: at("pipes-1", "machinery-1"), color: "#8aa0d8", count: 22, superHighCount: 36, scroll: 0.72, size: [8, 18], alpha: 0.22 },
      { color: "#ffd9a0", count: 60, superHighCount: 110, scroll: 1, size: [3, 8], alpha: 0.45 },
    ],
    // A light touch only: the artwork already carries its own lit top edge and
    // shadowed base, so this just tips each storey a little warmer at the top
    // and colder at the bottom. Anything stronger bleaches the steel.
    platforms: { top: "#d8b183", bottom: "#111a38", strength: 0.12, shadow: { color: "#060a1a", alpha: 0.4, y: 7 } },
    vignette: { color: "#050a1e", alpha: 0.34 },
  },
};

// The scenery above is authored against the camera centre the level was first
// framed on; deepening the world only moved the centre, not the machinery.
for (const layer of layers) if (layer.stack !== "front" && layer.y !== undefined) layer.y -= FRAMED_SHIFT;
for (const group of ["glows", "mist", "rays"]) {
  for (const item of scenery.atmosphere[group]) if (item.y !== undefined) item.y -= FRAMED_SHIFT;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------
const usedTextures = [...new Set(platforms.map((p) => p.textureKey))];
const decoOf = (key) => (key.startsWith("bank-bust-deco-") ? key.slice("bank-bust-deco-".length) : null);
const textureUrl = (key) => (key === BACKDROP.key
  ? `/assets/bank-bust/${BACKDROP.file}`
  : `/assets/bank-bust/shape-${key.replace("bank-bust-shape-", "")}.webp`);
const textureSize = (key) => (key === BACKDROP.key
  ? backdropSize
  : shapes.get(key.replace("bank-bust-shape-", "")));

const document = {
  schemaVersion: 2,
  id: 4,
  label: "Iron Junction",
  modeVariantId: "bank-bust-3v3",
  metadata: {
    key: "iron-junction",
    terrain: "hard",
    musicAsset: "/assets/bank-bust/bankbust-main.mp3",
    musicVolume: 0.22,
    mapSelectPreviewAsset: "/assets/bank-bust/preview.webp",
    lobbyBgAsset: "/assets/bank-bust/lobbyBg.webp",
    lobbyPlatformAsset: "/assets/bank-bust/lobbyPlatform.webp",
  },
  assets: Object.fromEntries(usedTextures.map((key) => {
    const deco = decoOf(key);
    if (!deco) return [key, { type: "image", url: textureUrl(key) }];
    const { rate, sequence } = DECO[deco];
    const { width, height } = decoSize(deco);
    return [key, {
      type: "spritesheet", url: `/assets/bank-bust/deco-${deco}.webp`,
      frameConfig: { frameWidth: width, frameHeight: height },
      animation: { frameRate: rate, frames: sequence, repeat: -1 },
    }];
  })),
  textureSizes: Object.fromEntries(usedTextures.map((key) => {
    const size = decoOf(key) ? decoSize(decoOf(key)) : textureSize(key);
    return [key, { width: size.width, height: size.height }];
  })),
  layout: { platforms, hitboxes },
  anchors: {},
  spawns,
  powerups: {
    spawnIntervalMs: 25000,
    maxActive: 3,
    despawnMs: 10000,
    pickupRadius: 34,
    omenMs: 2000,
    spawnLift: 22,
    types: ["rage", "health", "shield", "poison", "gravityBoots", "invisibility", "shockwave", "freeze"],
  },
  objectiveLayout,
  scenery,
};

module.exports = { document, BOUNDS, WIDTH, CX, TOP, BOTTOM, HIGH, MID, FLOOR, TUNNEL_FLOOR, STEP, PERCH, PERCH_TOP };

if (require.main === module) {
  // The shape list first, so a fresh checkout can bake before it validates.
  fs.writeFileSync(SHAPE_MANIFEST,
    JSON.stringify({
      world: { width: WIDTH, mid: MID, bottom: ART_BOTTOM, shadeBottom: BOTTOM },
      tunnelShade: TUNNEL_SHADE,
      tunnelLamps: TUNNEL_LAMPS,
      passageRoof: PASSAGE_ROOF,
      tunnelCeiling: TUNNEL_CEILING,
      shaft: SHAFT,
      shelf: SHELF,
      shapes: [...shapes.values()].map(({ baked, ...rest }) => rest),
      solids: solidRects,
    }, null, 2) + "\n");
  console.log("wrote", path.relative(ROOT, SHAPE_MANIFEST), `(${shapes.size} shapes)`);

  if (missing.length) {
    console.log(`\nNot baked yet: ${missing.join(", ")}.`);
    console.log("Run `node scripts/art/bake-iron-junction.cjs`, then run this again.");
    process.exit(0);
  }

  const errors = validateDocument(document);
  if (errors.length) {
    console.error("Iron Junction failed validation:");
    for (const e of errors) console.error("  -", e);
    process.exit(1);
  }
  const json = JSON.stringify(document, null, 2) + "\n";
  for (const rel of ["src/shared/maps/4.json", "data/maps/4.json"]) {
    fs.writeFileSync(path.join(ROOT, rel), json);
    console.log("wrote", rel);
  }
  console.log(`Iron Junction: ${platforms.length} platforms, ${hitboxes.length} hitboxes, ${WIDTH}x${BOTTOM - TOP}.`);
}
