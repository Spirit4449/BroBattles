#!/usr/bin/env node
// Builds Sunset Bowl (map 6), the Bro Ball arena.
//
//   node scripts/art/install-bro-ball-art.cjs    <- art + measurements (sunset-bowl-art.json)
//   node scripts/maps/build-sunset-bowl.cjs      <- this: geometry + art placement -> src/shared/maps/6.json
//
// Like Iron Junction, the level is authored here so both ends stay exact
// mirrors and the colliders are fitted to the painted art: each goal's mouth,
// depth and step come from the end wall's measured opening, the pitch's walk
// line from the grass, and each platform's deck from its art. Every painted
// piece is a decorative map platform (no collision) or a scenery layer; the
// colliders are hitboxes. Edit this script and re-run it rather than editing
// the JSON.
//
// The arena, left to right: an end wall with its goal set into it, the pitch,
// and the mirror. Two one-way plank platforms flank the open midfield, with a
// short log higher up on each end wall.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const ART = JSON.parse(fs.readFileSync(path.join(__dirname, "sunset-bowl-art.json"), "utf8"));
const OUT = path.join(ROOT, "src", "shared", "maps", "6.json");
const ARENAS = path.join(ROOT, "src", "shared", "maps", "arenas.json");
const asset = file => `/assets/bro-ball/${file}`;

// ---------------------------------------------------------------------------
// World frame
// ---------------------------------------------------------------------------
const WIDTH = 2040;
const CX = WIDTH / 2;
const mx = x => WIDTH - x;
const FLOOR = 900;
const ROOF = 132;
const CEILING_TOP = 72;
// The camera frame scenery offsets are measured from.
const CAMERA = { x: -100, y: -8, width: WIDTH + 200, height: 1108 };
const CENTRE = { x: CAMERA.x + CAMERA.width / 2, y: CAMERA.y + CAMERA.height / 2 };

// The left goal face; everything else about the goal comes from the wall art.
const GOAL_FACE = 240;
const wall = ART.wall;
const WALL_SCALE = wall.grid;
const wallW = wall.team1.width * WALL_SCALE, wallH = wall.team1.height * WALL_SCALE;
const wallLeft = GOAL_FACE - wall.mouth.face;
const wallTop = FLOOR - wallH;
const MOUTH_TOP = wallTop + wall.mouth.top;
const MOUTH_BOTTOM = wallTop + wall.mouth.bottom;
const GOAL_BACK = wallLeft + wall.mouth.back;
const BACK_WALL = 50;

// Platforms: [id, deck left, deck top]; the art's deck is ART.platform.span wide.
const DECK = ART.platform.span[1] - ART.platform.span[0];
const SIDE_DECK_LEFT = 540;
const PLATFORM_TOP_SIDE = FLOOR - 125;
const PLATFORMS = [
  ["platform-left", SIDE_DECK_LEFT, PLATFORM_TOP_SIDE],
  ["platform-right", mx(SIDE_DECK_LEFT) - DECK, PLATFORM_TOP_SIDE],
];
const PLATFORM_THICKNESS = 20;
const LOG_TOP = 411;
const LOG = ART.wallLog;
const LOG_INSET = LOG.grid;
const LOG_LENGTH = LOG.width * LOG.grid - LOG_INSET;
const LOG_HEIGHT = LOG.height * LOG.grid;
const WALL_LOGS = [
  { id: "wall-log-left", left: GOAL_FACE, flipX: false },
  { id: "wall-log-right", left: mx(GOAL_FACE) - LOG_LENGTH, flipX: true },
];

const box = (id, left, top, right, bottom, extra = {}) =>
  ({ id, x: (left + right) / 2, y: (top + bottom) / 2, width: right - left, height: bottom - top, ...extra });
const oneWay = { collision: { up: true, down: false, left: false, right: false } };

function hitboxes() {
  return [
    box("pitch-floor", -100, FLOOR, WIDTH + 100, FLOOR + 100),
    box("ceiling", -100, CEILING_TOP, WIDTH + 100, ROOF),
    box("left-net-wall", GOAL_BACK - BACK_WALL, ROOF, GOAL_BACK, FLOOR),
    box("right-net-wall", mx(GOAL_BACK), ROOF, mx(GOAL_BACK) + BACK_WALL, FLOOR),
    box("left-crossbar", GOAL_BACK, ROOF, GOAL_FACE, MOUTH_TOP),
    box("right-crossbar", mx(GOAL_FACE), ROOF, mx(GOAL_BACK), MOUTH_TOP),
    box("left-goal-base", GOAL_BACK, MOUTH_BOTTOM, GOAL_FACE, FLOOR),
    box("right-goal-base", mx(GOAL_FACE), MOUTH_BOTTOM, mx(GOAL_BACK), FLOOR),
    ...PLATFORMS.map(([id, left, top]) => box(id, left, top, left + DECK, top + PLATFORM_THICKNESS, oneWay)),
  ];
}

// A painted piece: a decorative map platform with no collision.
function piece(id, textureKey, art, left, top, extra = {}) {
  const scale = art.grid;
  return {
    textureKey, id, x: left + (art.width * scale) / 2, y: top + (art.height * scale) / 2,
    scaleX: scale, scaleY: scale, flipX: false,
    body: { width: 1, height: 1, offsetX: 0, offsetY: 0 }, collisionEnabled: false, ...extra,
  };
}

function platforms() {
  const pitch = ART.pitch, roof = ART.roof, deck = ART.platform;
  return [
    piece("pitch-art", "bro-ball-pitch", pitch, CX - pitch.halfway, FLOOR - pitch.walk, { depth: 1 }),
    piece("wall-left-art", "bro-ball-wall-team1", { ...wall.team1, grid: WALL_SCALE }, wallLeft, wallTop, { depth: 2 }),
    piece("wall-right-art", "bro-ball-wall-team2", { ...wall.team2, grid: WALL_SCALE }, mx(wallLeft + wallW), wallTop, { depth: 2, flipX: true }),
    ...PLATFORMS.map(([id, left, top]) =>
      piece(`${id}-art`, "bro-ball-platform", deck, left - deck.span[0], ROOF, { depth: 1.5, scaleY: deck.grid * (top - ROOF) / deck.walk, y: ROOF + deck.height * deck.grid * (top - ROOF) / deck.walk / 2 })),
    piece("canopy-art", "bro-ball-roof", roof, CX - (roof.width * roof.grid) / 2, ROOF - roof.underside, { depth: 33.5 }),
  ];
}

const assetsFor = keys => Object.fromEntries(keys.map(([key, file]) => [key, { type: "image", url: asset(file) }]));
const sizesFor = keys => Object.fromEntries(keys.map(([key, , art]) => [key, { width: art.width, height: art.height }]));
const TEXTURES = [
  ["bro-ball-pitch", ART.pitch.file, ART.pitch],
  ["bro-ball-wall-team1", wall.team1.file, wall.team1],
  ["bro-ball-wall-team2", wall.team2.file, wall.team2],
  ["bro-ball-platform", ART.platform.file, ART.platform],
  ["bro-ball-roof", ART.roof.file, ART.roof],
];

// Also used to apply just the ledges to an existing Map Studio publication.
function addWallLogs(document) {
  const key = "bro-ball-wall-log";
  document.assets[key] = { type: "image", url: asset(LOG.file) };
  document.textureSizes[key] = { width: LOG.width, height: LOG.height };
  for (const { id, left, flipX } of WALL_LOGS) {
    const artId = `${id}-art`;
    const art = piece(artId, key, LOG, flipX ? left : left - LOG_INSET, LOG_TOP, { depth: 1.5, flipX });
    const hitbox = box(id, left, LOG_TOP, left + LOG_LENGTH, LOG_TOP + LOG_HEIGHT, oneWay);
    document.layout.platforms = document.layout.platforms.filter(platform => platform.id !== artId);
    document.layout.hitboxes = document.layout.hitboxes.filter(platform => platform.id !== id);
    document.layout.platforms.push(art);
    document.layout.hitboxes.push(hitbox);
  }
  return document;
}

// A scroll-1 layer with its top-left at (left, top) in the world.
function layerAt(art, left, top) {
  const scale = art.grid, w = art.width * scale, h = art.height * scale;
  return { x: left + w / 2 - CENTRE.x, y: Math.round(top + h / 2 - CENTRE.y), scale };
}

function scenery() {
  const { sky, peaks, stands } = ART;
  const torch = { x: wallLeft + wall.torch.x, y: wallTop + wall.torch.y - 14 };
  return {
    layers: [
      { id: "sky", url: asset(sky.file), fit: "cover", scroll: 0.1, filter: "linear" },
      { id: "peaks", url: asset(peaks.file), fit: "cover-x", scroll: 0.52, filter: "nearest", fog: 0.15,
        ...layerAt(peaks, CX - (peaks.width * peaks.grid) / 2, -120) },
      { id: "stands", url: asset(stands.file), fit: "none", scroll: 1, filter: "nearest", fog: 0.31,
        ...layerAt(stands, CX - (stands.width * stands.grid) / 2, 232) },
    ],
    clouds: {
      enabled: true,
      items: [
        { id: "west-cloud", type: "cloud-6", x: 95, y: 247, speed: 6, scale: 0.56, alpha: 0.52 },
        { id: "upper-west-cloud", type: "cloud-1", x: 525, y: 199, speed: 5, scale: 0.54, alpha: 0.46 },
        { id: "midfield-cloud", type: "cloud-12", x: 940, y: 318, speed: 8, scale: 0.62, alpha: 0.52 },
        { id: "upper-east-cloud", type: "cloud-10", x: 1435, y: 222, speed: 6, scale: 0.53, alpha: 0.48 },
        { id: "east-cloud", type: "cloud-6", x: 1880, y: 257, speed: 7, scale: 0.63, alpha: 0.50, flipX: true },
      ].map(cloud => ({ ...cloud, direction: "right", after: "sky" })),
    },
    atmosphere: {
      fogColor: "#f2b88f",
      glows: [
        { after: "sky", x: -260, y: -600, scroll: 0.1, radius: 900, color: "#ffd49a", alpha: [0.12, 0.22], periodMs: 9000 },
      ],
      rays: [
        { after: "peaks", x: -760, y: -780, scroll: 0.25, count: 5, angle: -24, spread: 20, length: 1900, width: [90, 220], color: "#ffe2b0", alpha: [0.03, 0.07], periodMs: [6000, 11000] },
      ],
      mist: [
        { after: "peaks", color: "#eeb3a9", alpha: 0.16, scroll: 0.52, y: 145, height: 300, speed: 5 },
      ],
      dust: [
        { after: "peaks", color: "#ffe7b0", count: 7, superHighCount: 10, scroll: 0.7, size: [2, 5], alpha: 0.32 },
      ],
      lamps: [torch, { x: mx(torch.x), y: torch.y }].map(({ x, y }) => ({
        x, y, length: 140, width: 180, color: "#ffb060", alpha: [0.16, 0.26], periodMs: 1800, flicker: 0.5,
      })),
      vignette: { color: "#2a1838", alpha: 0.16 },
    },
  };
}

function build() {
  const document = JSON.parse(fs.readFileSync(OUT, "utf8"));
  document.label = "Sunset Bowl";
  document.metadata = { ...document.metadata, key: "sunset-bowl" };
  document.assets = assetsFor(TEXTURES);
  document.textureSizes = sizesFor(TEXTURES);
  document.layout = { platforms: platforms(), hitboxes: hitboxes() };
  addWallLogs(document);
  document.spawns = {
    players: {
      team1: [{ anchorId: "pitch-floor", dx: -170 }, { anchorId: "pitch-floor", dx: -550 }],
      team2: [{ anchorId: "pitch-floor", dx: 170 }, { anchorId: "pitch-floor", dx: 550 }],
    },
    powerups: [],
  };
  document.objectiveLayout = {
    broBall: {
      kickoff: { x: CX, y: 330 },
      goals: {
        team1: { x: GOAL_FACE, top: MOUTH_TOP, bottom: MOUTH_BOTTOM, backX: GOAL_BACK },
        team2: { x: mx(GOAL_FACE), top: MOUTH_TOP, bottom: MOUTH_BOTTOM, backX: mx(GOAL_BACK) },
      },
    },
  };
  document.scenery = scenery();
  const arenas = JSON.parse(fs.readFileSync(ARENAS, "utf8"));
  arenas["soccer-2v2"] = {
    world: { x: -100, y: 0, width: WIDTH + 200, height: 1100 },
    camera: { ...CAMERA, minZoom: 1.25, maxZoom: 1.35, sceneryZoom: 0.8, climbY: [300, 880], deadzoneWidth: 80, deadzoneHeight: 80 },
  };
  fs.writeFileSync(ARENAS, `${JSON.stringify(arenas, null, 2)}\n`);
  // Validation loads the arena bounds just written above.
  const { validateDocument } = require("../../src/shared/maps/mapDocument");
  const errors = validateDocument(document);
  if (errors.length) throw new Error(`Sunset Bowl is invalid:\n${errors.join("\n")}`);
  fs.writeFileSync(OUT, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUT)}: goals ${GOAL_BACK}-${GOAL_FACE}, mouth ${MOUTH_TOP}-${MOUTH_BOTTOM}`);
}

if (require.main === module) build();
module.exports = { addWallLogs };
