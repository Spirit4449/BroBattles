import duelMaps from "../shared/duelMaps.json";
// mangroveMeadow.js

import {
  appendLayoutObjectsFromConfig,
  getSpawnPointForTeam,
  placeSpriteAtConfiguredSpawn,
} from "./mapUtils";

const SPAWN_CONFIG = duelMaps[2].spawns;

const BOUNDARY_CONFIG = duelMaps[2].bounds;

const EDITOR_TEXTURE_KEYS = [
  "mangrove-base-middle",
  "mangrove-base-top",
  "mangrove-base-left",
  "mangrove-base-right",
  "mangrove-tiny-platform",
];

const USE_LAYOUT_CONFIG_ONLY = true;
const MAP_LAYOUT_CONFIG = duelMaps[2].layout;

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
