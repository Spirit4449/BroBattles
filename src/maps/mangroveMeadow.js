// mangroveMeadow.js
// To add / tweak this map, edit the constants below — no need to touch build()
// or positionSpawn().  To add an entirely new map, follow the same pattern and
// register it in src/maps/manifest.js.

import { getSpawnPointForTeam, placeSpriteAtConfiguredSpawn } from "./mapUtils";

// ── Layout constants ─────────────────────────────────────────────────────────
const SCALE = 0.6;

const BASE_MID_Y = 600; // main floor
const BASE_TOP_Y = 408; // elevated centre base
const BASE_SIDE_DX = 422; // left/right base X offset from centre
const BASE_SIDE_Y = 638; // left/right base Y

// Tiny platform layout: each entry is [dx, y]
// Indices 0-2 → team2 spawn platforms; indices 3-5 → team1 spawn platforms
const TINY_LAYOUT = [
  [-280, 325], // 0 – team2
  [+280, 325], // 1 – team2
  [-430, 200], // 2 – team2
  [+430, 200], // 3 – team1
  [-130, 150], // 4 – team1
  [+130, 150], // 5 – team1
];

const SPAWN_CONFIG = {
  players: {
    team1: {
      1: [{ anchorId: "tiny-3", dx: 0 }],
      2: [
        { anchorId: "tiny-3", dx: 0 },
        { anchorId: "tiny-4", dx: 0 },
      ],
      3: [
        { anchorId: "tiny-3", dx: 0 },
        { anchorId: "tiny-4", dx: 0 },
        { anchorId: "tiny-5", dx: 0 },
      ],
    },
    team2: {
      1: [{ anchorId: "tiny-0", dx: 0 }],
      2: [
        { anchorId: "tiny-0", dx: 0 },
        { anchorId: "tiny-1", dx: 0 },
      ],
      3: [
        { anchorId: "tiny-0", dx: 0 },
        { anchorId: "tiny-1", dx: 0 },
        { anchorId: "tiny-2", dx: 0 },
      ],
    },
  },
  powerups: [
    { x: 1090, y: 308 },
    { x: 1210, y: 308 },
    { x: 1150, y: 498 },
    { x: 725, y: 538 },
    { x: 1575, y: 538 },
    { x: 870, y: 225 },
    { x: 1430, y: 225 },
    { x: 720, y: 100 },
    { x: 1580, y: 100 },
    { x: 1020, y: 50 },
    { x: 1280, y: 50 },
  ],
};

const BOUNDARY_CONFIG = {
  world: { x: 0, y: 0, width: 2300, height: 1000 },
  camera: {
    x: -200,
    y: -40,
    width: 2000,
    height: 1000,
    zoom: 1.7,
    deadzoneWidth: 50,
    deadzoneHeight: 50,
    followOffsetY: 120,
  },
};

const EDITOR_TEXTURE_KEYS = [
  "mangrove-base-middle",
  "mangrove-base-top",
  "mangrove-base-left",
  "mangrove-base-right",
  "mangrove-tiny-platform",
];

// ── Runtime references (set during build) ──────────────────────────────────
const _tinyPlatforms = []; // [0..5] matching TINY_LAYOUT
const _objects = [];
const _spawnAnchors = Object.create(null);

// ── Map definition ───────────────────────────────────────────────────────────
export const definition = {
  id: 2,
  name: "Mangrove Meadow",
  bgAsset: "/assets/mangrove/gameBg.webp",
  mapSelectPreviewAsset: "/assets/mangrove/gameBg.webp",
  lobbyBgAsset: "/assets/mangrove/lobbyBg.webp",
  lobbyPlatformAsset: "/assets/mangrove/lobbyPlatform.webp",
  lobbyCharacterOffsetY: 55,

  build(scene) {
    _objects.length = 0;
    _tinyPlatforms.length = 0;
    const cx = scene.scale.width / 2;

    function plat(key, x, y) {
      const s = scene.physics.add.sprite(x, y, key);
      s.body.allowGravity = false;
      s.setImmovable(true);
      s.setScale(SCALE);
      _objects.push(s);
      return s;
    }

    plat("mangrove-base-middle", cx, BASE_MID_Y);
    plat("mangrove-base-top", cx, BASE_TOP_Y);
    plat("mangrove-base-left", cx - BASE_SIDE_DX, BASE_SIDE_Y);
    plat("mangrove-base-right", cx + BASE_SIDE_DX, BASE_SIDE_Y);

    for (const [dx, y] of TINY_LAYOUT) {
      _tinyPlatforms.push(plat("mangrove-tiny-platform", cx + dx, y));
    }

    for (let i = 0; i < _tinyPlatforms.length; i++) {
      _spawnAnchors[`tiny-${i}`] = _tinyPlatforms[i];
    }
  },

  getObjects() {
    return _objects;
  },

  /**
   * @param {object}  scene
   * @param {object}  sprite    — Phaser sprite to position
   * @param {string}  team      — "team1" | "team2"
   * @param {number}  index     — 0-based index within the team
   * @param {number}  [teamSize] — unused (kept for uniform signature)
   */
  positionSpawn(scene, sprite, team, index, teamSize) {
    const point = getSpawnPointForTeam(SPAWN_CONFIG, team, index, teamSize);
    if (!point) return;
    placeSpriteAtConfiguredSpawn(scene, sprite, point, _spawnAnchors, 2);
  },

  getSpawnConfig() {
    return SPAWN_CONFIG;
  },

  getBoundaryConfig() {
    return BOUNDARY_CONFIG;
  },

  getEditorTextureKeys() {
    return EDITOR_TEXTURE_KEYS;
  },

  getSpawnAnchors() {
    return _spawnAnchors;
  },
};

// ── Legacy named exports (game.js backward-compat; use manifest.js for new code) ──
export const mangroveMeadowObjects = _objects;

export function mangroveMeadow(scene) {
  definition.build(scene);
}

export function positionMangroveSpawn(scene, sprite, team, index) {
  definition.positionSpawn(scene, sprite, team, index);
}
