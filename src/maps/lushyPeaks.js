import {
  appendLayoutObjectsFromConfig,
  getSpawnPointForTeam,
  placeSpriteAtConfiguredSpawn,
} from "./mapUtils";

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
    { x: 935, y: 487.15 },
    { x: 1150, y: 487.15 },
    { x: 1365, y: 487.15 },
    { x: 1005, y: 147.14999999999998 },
    { x: 1150, y: 147.14999999999998 },
    { x: 1295, y: 147.14999999999998 },
    { x: 645, y: 169.14999999999998 },
    { x: 814, y: 249 },
    { x: 1489, y: 255 },
    { x: 1646, y: 137 },
    { x: 574, y: 500 },
    { x: 1727, y: 498 },
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
];

const USE_LAYOUT_CONFIG_ONLY = true;
const MAP_LAYOUT_CONFIG = {
  platforms: [
    {
      textureKey: "lushy-base",
      x: 1150,
      y: 670,
      scaleX: 0.8,
      scaleY: 0.8,
      flipX: false,
      body: {
        width: 800,
        height: 100,
        offsetX: 0,
        offsetY: 50,
      },
    },
    {
      textureKey: "lushy-platform",
      x: 1150,
      y: 250,
      scaleX: 0.7,
      scaleY: 0.7,
      flipX: false,
      body: {
        width: 490,
        height: 50,
        offsetX: 0,
        offsetY: 40,
      },
    },
    {
      textureKey: "lushy-side-platform",
      x: 670,
      y: 321,
      scaleX: 0.3,
      scaleY: 0.3,
      flipX: false,
      body: {
        width: 156.9,
        height: 185,
        offsetX: 0,
        offsetY: 140,
      },
    },
    {
      textureKey: "lushy-side-platform",
      x: 1619,
      y: 321,
      scaleX: 0.3,
      scaleY: 0.3,
      flipX: false,
      body: {
        width: 156.9,
        height: 185,
        offsetX: 0,
        offsetY: 140,
      },
    },
    {
      textureKey: "lushy-base",
      x: 575,
      y: 575,
      scaleX: 0.18,
      scaleY: 0.18,
      flipX: false,
      body: {
        width: 180,
        height: 40,
        offsetX: 0,
        offsetY: 30,
      },
    },
    {
      textureKey: "lushy-base",
      x: 1725,
      y: 575,
      scaleX: 0.18,
      scaleY: 0.18,
      flipX: false,
      body: {
        width: 180,
        height: 40,
        offsetX: 0,
        offsetY: 30,
      },
    },
  ],
  hitboxes: [],
};

let _base = null;
let _platform = null;
const _objects = [];
const _spawnAnchors = Object.create(null);

function rebuildSpawnAnchorsFromLayout() {
  for (const key of Object.keys(_spawnAnchors)) delete _spawnAnchors[key];
  _base =
    _objects.find(
      (obj) =>
        obj?.texture?.key === "lushy-base" &&
        Math.abs((Number(obj.x) || 0) - 1150) < 5 &&
        Math.abs((Number(obj.y) || 0) - 670) < 5,
    ) || null;
  _platform =
    _objects.find(
      (obj) =>
        obj?.texture?.key === "lushy-platform" &&
        Math.abs((Number(obj.x) || 0) - 1150) < 5,
    ) || null;
  if (_base) _spawnAnchors.base = _base;
  if (_platform) _spawnAnchors.top = _platform;
}

export const definition = {
  id: 1,
  name: "Lushy Peaks",
  bgAsset: "/assets/lushy/gameBg.webp",
  mapSelectPreviewAsset: "/assets/lushy/preview.webp",
  lobbyBgAsset: "/assets/lushy/lobbyBg.webp",
  lobbyPlatformAsset: "/assets/lushy/lobbyPlatform.webp",
  lobbyCharacterOffsetY: 15,

  build(scene) {
    _objects.length = 0;
    _base = null;
    _platform = null;
    for (const key of Object.keys(_spawnAnchors)) delete _spawnAnchors[key];

    if (USE_LAYOUT_CONFIG_ONLY) {
      appendLayoutObjectsFromConfig(scene, _objects, MAP_LAYOUT_CONFIG);
      rebuildSpawnAnchorsFromLayout();
    }
  },

  getObjects() {
    return _objects;
  },

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

export const lushyPeaksObjects = _objects;

export function lushyPeaks(scene) {
  definition.build(scene);
}

export function positionLushySpawn(scene, sprite, team, index, teamSize) {
  definition.positionSpawn(scene, sprite, team, index, teamSize);
}
