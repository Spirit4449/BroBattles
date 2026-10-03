import {
  getSceneWorldCenterX,
  getSpawnPointForTeam,
  placeSpriteAtConfiguredSpawn,
  appendLayoutObjectsFromConfig,
} from "./mapUtils";

import bankGeometry from '../shared/bankSpawnGeometry.json';
const SPAWN_CONFIG = bankGeometry.spawns;

const MAP_LAYOUT_CONFIG = bankGeometry.layout;

const IRON_JUNCTION_CONFIG = {
  spawns: SPAWN_CONFIG,
  boundaries: {
    world: { x: 0, y: -320, width: 3600, height: 860 },
    camera: {
      x: 0,
      y: -340,
      width: 3600,
      height: 900,
      zoom: 1.28,
      deadzoneWidth: 80,
      deadzoneHeight: 60,
      followOffsetY: 70,
    },
  },
  editorTextureKeys: [
    "bank-bust-base",
    "bank-bust-topcase",
    "bank-bust-staircase",
    "bank-bust-middle",
    "bank-bust-middlebottom",
    "bank-bust-middledetail",
    "bank-bust-longplatform",
    "bank-bust-tallplatform",
    "bank-bust-bigblock",
    "bank-bust-2x2",
    "bank-bust-3x3",
    "bank-bust-abyss",
  ],
};

const USE_LAYOUT_CONFIG_ONLY = true;
const EFFECTIVE_MAP_LAYOUT_CONFIG = MAP_LAYOUT_CONFIG;

let _objects = [];
const _spawnAnchors = Object.create(null);

export const definition = {
  id: 4,
  name: "Iron Junction",
  bgAsset: "/assets/bank-bust/gameBg.webp",
  mapSelectPreviewAsset: "/assets/bank-bust/preview.webp",
  lobbyBgAsset: "/assets/bank-bust/lobbyBg.webp",
  lobbyPlatformAsset: "/assets/bank-bust/lobbyPlatform.webp",
  lobbyCharacterOffsetY: 12,

  build(scene) {
    _objects = [];
    for (const key of Object.keys(_spawnAnchors)) delete _spawnAnchors[key];

    if (USE_LAYOUT_CONFIG_ONLY) {
      appendLayoutObjectsFromConfig(
        scene,
        _objects,
        EFFECTIVE_MAP_LAYOUT_CONFIG,
      );
    }

    const platforms = _objects.filter(
      (entry) =>
        entry &&
        typeof entry.texture?.key === "string" &&
        entry.texture.key === "bank-bust-base",
    );
    let leftBase = null;
    let rightBase = null;
    for (const sprite of platforms) {
      if (!leftBase || Number(sprite.x) < Number(leftBase.x)) leftBase = sprite;
      if (!rightBase || Number(sprite.x) > Number(rightBase.x))
        rightBase = sprite;
    }

    _spawnAnchors["team1-spawn"] = leftBase || null;
    _spawnAnchors["team2-spawn"] = rightBase || null;
    _spawnAnchors["team1-vault"] = leftBase || null;
    _spawnAnchors["team2-vault"] = rightBase || null;

    // Keep the base sprites as visuals/spawn anchors only; custom hitboxes drive base collision.
    for (const base of [leftBase, rightBase]) {
      if (!base?.body) continue;
      base.body.checkCollision.up = false;
      base.body.checkCollision.down = false;
      base.body.checkCollision.left = false;
      base.body.checkCollision.right = false;
    }
  },

  getObjects() {
    return _objects;
  },

  positionSpawn(scene, sprite, team, index, teamSize) {
    const point = getSpawnPointForTeam(
      IRON_JUNCTION_CONFIG.spawns,
      team,
      index,
      teamSize,
    );
    if (!point) return;
    placeSpriteAtConfiguredSpawn(scene, sprite, point, _spawnAnchors, 2);
  },

  getSpawnConfig() {
    return IRON_JUNCTION_CONFIG.spawns;
  },

  getBoundaryConfig() {
    return IRON_JUNCTION_CONFIG.boundaries;
  },

  getEditorTextureKeys() {
    return IRON_JUNCTION_CONFIG.editorTextureKeys;
  },

  getSpawnAnchors() {
    return _spawnAnchors;
  },
};

export { definition as ironJunction };
