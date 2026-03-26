// lushyPeaks.js
// To add / tweak this map, edit the constants below — no need to touch build() or
// positionSpawn().  To add an entirely new map, follow the same pattern and
// register it in src/maps/manifest.js.

import {
  appendLayoutObjectsFromConfig,
  getSceneWorldCenterX,
  getSpawnPointForTeam,
  placeSpriteAtConfiguredSpawn,
} from "./mapUtils";

// ── Layout constants ─────────────────────────────────────────────────────────
const SCALE_MAIN = 0.7; // base + centre platform + side platforms
const SCALE_TINY = 0.45; // small corner platforms

const BASE_Y = 630; // main floor Y
const PLATFORM_Y = 300; // elevated centre platform Y
const SIDE_DX = 490; // left/right side platform X offset from centre
const SIDE_Y = 325; // side platform Y
const SMALL_DX = 530; // small corner platform X offset from centre
const SMALL_Y = 580; // small corner platform Y

const SPAWN_CONFIG = {
  players: {
    team1: {
      1: [{ dx: 0, anchorId: "base" }],
      2: [
        { dx: -120, anchorId: "base" },
        { dx: 120, anchorId: "base" },
      ],
      3: [
        { dx: -180, anchorId: "base" },
        { dx: 0, anchorId: "base" },
        { dx: 180, anchorId: "base" },
      ],
    },
    team2: {
      1: [{ dx: 0, anchorId: "top" }],
      2: [
        { dx: -120, anchorId: "top" },
        { dx: 120, anchorId: "top" },
      ],
      3: [
        { dx: -180, anchorId: "top" },
        { dx: 0, anchorId: "top" },
        { dx: 180, anchorId: "top" },
      ],
    },
  },
  powerups: [
    { x: 935, y: 484 },
    { x: 1150, y: 484 },
    { x: 1365, y: 484 },
    { x: 1005, y: 144 },
    { x: 1150, y: 144 },
    { x: 1295, y: 144 },
    { x: 645, y: 166 },
    { x: 785, y: 166 },
    { x: 1515, y: 166 },
    { x: 1655, y: 166 },
    { x: 592, y: 446 },
    { x: 1708, y: 446 },
  ],
};

const BOUNDARY_CONFIG = {
  world: { x: 0, y: 0, width: 2300, height: 1000 },
  camera: {
    x: 0,
    y: -40,
    width: 2300,
    height: 1000,
    zoom: 1.7,
    deadzoneWidth: 50,
    deadzoneHeight: 50,
    followOffsetY: 120,
  },
};

const EDITOR_TEXTURE_KEYS = [
  "lushy-base",
  "lushy-platform",
  "lushy-side-platform",
  "mangrove-tiny-platform",
];

// Optional editor-driven layout config. Set `USE_LAYOUT_CONFIG_ONLY=true`
// and paste exported platforms/hitboxes below to build this map from config.
const USE_LAYOUT_CONFIG_ONLY = false;
const MAP_LAYOUT_CONFIG = {
  platforms: [],
  hitboxes: [],
};

// ── Runtime platform references (set during build) ───────────────────────────
let _base = null;
let _platform = null;
const _objects = [];
const _spawnAnchors = Object.create(null);

// ── Map definition ───────────────────────────────────────────────────────────
export const definition = {
  id: 1,
  name: "Lushy Peaks",
  bgAsset: "/assets/lushy/gameBg.webp",
  mapSelectPreviewAsset: "/assets/lushy/gameBg.webp",
  lobbyBgAsset: "/assets/lushy/lobbyBg.webp",
  lobbyPlatformAsset: "/assets/lushy/lobbyPlatform.webp",
  lobbyCharacterOffsetY: 0,

  build(scene) {
    _objects.length = 0;
    _base = null;
    _platform = null;
    for (const k of Object.keys(_spawnAnchors)) delete _spawnAnchors[k];

    if (USE_LAYOUT_CONFIG_ONLY) {
      appendLayoutObjectsFromConfig(scene, _objects, MAP_LAYOUT_CONFIG);
      return;
    }

    const cx = getSceneWorldCenterX(scene);

    function plat(key, x, y, scale) {
      const s = scene.physics.add.sprite(x, y, key);
      s.body.allowGravity = false;
      s.setImmovable(true);
      s.setScale(scale);
      _objects.push(s);
      return s;
    }

    _base = plat("lushy-base", cx, BASE_Y, SCALE_MAIN);
    _platform = plat("lushy-platform", cx, PLATFORM_Y, SCALE_MAIN);
    _spawnAnchors.base = _base;
    _spawnAnchors.top = _platform;
    plat("lushy-side-platform", cx - SIDE_DX, SIDE_Y, SCALE_MAIN);
    plat("lushy-side-platform", cx + SIDE_DX, SIDE_Y, SCALE_MAIN);
    plat("mangrove-tiny-platform", cx - SMALL_DX, SMALL_Y, SCALE_TINY);
    plat("mangrove-tiny-platform", cx + SMALL_DX, SMALL_Y, SCALE_TINY);
  },

  getObjects() {
    return _objects;
  },

  /**
   * @param {object}  scene
   * @param {object}  sprite    — Phaser sprite to position
   * @param {string}  team      — "team1" | "team2"
   * @param {number}  index     — 0-based index within the team
   * @param {number}  teamSize  — total players on that team
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
export const lushyPeaksObjects = _objects;

export function lushyPeaks(scene) {
  definition.build(scene);
}

export function positionLushySpawn(scene, sprite, team, index, teamSize) {
  definition.positionSpawn(scene, sprite, team, index, teamSize);
}
