import duelMaps from "../shared/duelMaps.json";
import {
  appendLayoutObjectsFromConfig,
  getSpawnPointForTeam,
  placeSpriteAtConfiguredSpawn,
} from "./mapUtils";

const SPAWN_CONFIG = duelMaps[1].spawns;

const BOUNDARY_CONFIG = duelMaps[1].bounds;

const EDITOR_TEXTURE_KEYS = [
  "lushy-base",
  "lushy-platform",
  "lushy-side-platform",
];

const USE_LAYOUT_CONFIG_ONLY = true;
const MAP_LAYOUT_CONFIG = duelMaps[1].layout;

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
