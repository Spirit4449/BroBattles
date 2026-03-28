// mangroveMeadow.js

import {
  appendLayoutObjectsFromConfig,
  getSpawnPointForTeam,
  placeSpriteAtConfiguredSpawn,
} from "./mapUtils";

const SPAWN_CONFIG = {
  players: {
    team1: {
      1: [{ x: 1633, anchorId: "tiny-3" }],
      2: [
        { x: 1456, anchorId: "tiny-1" },
        { x: 1004, anchorId: "tiny-4" },
      ],
      3: [
        { anchorId: "tiny-3", x: 1631 },
        { x: 1004, anchorId: "tiny-4" },
        { x: 1298, anchorId: "tiny-5" },
      ],
    },
    team2: {
      1: [{ x: 837, anchorId: "tiny-0" }],
      2: [
        { x: 840, anchorId: "tiny-0" },
        { x: 1300, anchorId: "tiny-5" },
      ],
      3: [
        { anchorId: "tiny-0", x: 843 },
        { anchorId: "tiny-1", x: 1457 },
        { anchorId: "tiny-2", x: 671 },
      ],
    },
  },
  powerups: [
    { x: 1007, y: 496 },
    { x: 1147, y: 364 },
    { x: 1292, y: 512 },
    { x: 725, y: 619.3499999999999 },
    { x: 1664, y: 456 },
    { x: 870, y: 306.34999999999997 },
    { x: 611, y: 444 },
    { x: 720, y: 181.34999999999997 },
    { x: 1580, y: 181.34999999999997 },
    { x: 1008, y: 55 },
    { x: 1295, y: 61 },
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
  "mangrove-base-middle",
  "mangrove-base-top",
  "mangrove-base-left",
  "mangrove-base-right",
  "mangrove-tiny-platform",
];

const USE_LAYOUT_CONFIG_ONLY = true;
const MAP_LAYOUT_CONFIG = {
"platforms": [
    {
      "textureKey": "mangrove-base-middle",
      "x": 1150,
      "y": 750,
      "scaleX": 0.6,
      "scaleY": 0.6,
      "flipX": false,
      "body": {
        "width": 613,
        "height": 230,
        "offsetX": 0,
        "offsetY": 0
      }
    },
    {
      "textureKey": "mangrove-base-top",
      "x": 1150,
      "y": 559,
      "scaleX": 0.6,
      "scaleY": 0.6,
      "flipX": false,
      "body": {
        "width": 210,
        "height": 210,
        "offsetX": 0,
        "offsetY": 0
      }
    },
    {
      "textureKey": "mangrove-base-left",
      "x": 730,
      "y": 786,
      "scaleX": 0.6,
      "scaleY": 0.6,
      "flipX": false,
      "body": {
        "width": 230,
        "height": 150,
        "offsetX": 0,
        "offsetY": 0
      }
    },
    {
      "textureKey": "mangrove-base-right",
      "x": 1572,
      "y": 787,
      "scaleX": 0.6,
      "scaleY": 0.6,
      "flipX": false,
      "body": {
        "width": 230,
        "height": 150,
        "offsetX": 0,
        "offsetY": 0
      }
    },
    {
      "textureKey": "mangrove-tiny-platform",
      "x": 843,
      "y": 467,
      "scaleX": 0.4,
      "scaleY": 0.4,
      "flipX": false,
      "body": {
        "width": 210,
        "height": 40,
        "offsetX": 60,
        "offsetY": 90
      }
    },
    {
      "textureKey": "mangrove-tiny-platform",
      "x": 1457,
      "y": 463,
      "scaleX": 0.4,
      "scaleY": 0.4,
      "flipX": false,
      "body": {
        "width": 210,
        "height": 40,
        "offsetX": 60,
        "offsetY": 90
      }
    },
    {
      "textureKey": "mangrove-tiny-platform",
      "x": 615,
      "y": 289,
      "scaleX": 0.4,
      "scaleY": 0.4,
      "flipX": false,
      "body": {
        "width": 210,
        "height": 40,
        "offsetX": 60,
        "offsetY": 90
      }
    },
    {
      "textureKey": "mangrove-tiny-platform",
      "x": 1665,
      "y": 292,
      "scaleX": 0.4,
      "scaleY": 0.4,
      "flipX": false,
      "body": {
        "width": 210,
        "height": 40,
        "offsetX": 60,
        "offsetY": 90
      }
    },
    {
      "textureKey": "mangrove-tiny-platform",
      "x": 971,
      "y": 160,
      "scaleX": 0.4,
      "scaleY": 0.4,
      "flipX": false,
      "body": {
        "width": 210,
        "height": 40,
        "offsetX": 60,
        "offsetY": 90
      }
    },
    {
      "textureKey": "mangrove-tiny-platform",
      "x": 1329,
      "y": 160,
      "scaleX": 0.4,
      "scaleY": 0.4,
      "flipX": false,
      "body": {
        "width": 210,
        "height": 40,
        "offsetX": 60,
        "offsetY": 90
      }
    }
  ],
  "hitboxes": [],
};

const _objects = [];
const _spawnAnchors = Object.create(null);

function rebuildSpawnAnchorsFromLayout() {
  for (const key of Object.keys(_spawnAnchors)) delete _spawnAnchors[key];
  const tinyPlatforms = _objects.filter(
    (obj) => obj?.texture?.key === "mangrove-tiny-platform",
  );
  tinyPlatforms.forEach((platform, index) => {
    _spawnAnchors[`tiny-${index}`] = platform;
  });
}

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
    appendLayoutObjectsFromConfig(scene, _objects, MAP_LAYOUT_CONFIG);
    rebuildSpawnAnchorsFromLayout();
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

export const mangroveMeadowObjects = _objects;

export function mangroveMeadow(scene) {
  definition.build(scene);
}

export function positionMangroveSpawn(scene, sprite, team, index) {
  definition.positionSpawn(scene, sprite, team, index);
}
