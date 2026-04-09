import {
  getSceneWorldCenterX,
  getSpawnPointForTeam,
  placeSpriteAtConfiguredSpawn,
  appendLayoutObjectsFromConfig,
} from "./mapUtils";

const SPAWN_CONFIG = {
  players: {
    team1: {
      3: [
        { x: 483.74890506832725, y: -116.42424692347214 },
        { x: 498.31914994449824, y: 204.86727232283715 },
        { x: 155.49093429008073, y: 303.6807475859542 },
      ],
    },
    team2: {
      3: [
        { x: 3123.982300274797, y: -112.03701984432772 },
        { x: 3451.943479883209, y: 306.00052008003786 },
        { x: 3108.520593008096, y: 209.59719410641793 },
      ],
    },
  },
  powerups: [
    { dx: -610, y: 620 },
    { x: 975.4012429663217, y: -133.92457835582888 },
    { x: 1935.619419087003, y: 81.72297749960276 },
    { x: 1799.7828695105002, y: 341.71367687418314 },
    { x: 2656.0515854960804, y: -75.80152446951615 },
    { dx: 610, y: 620 },
    { x: 1198.1636623370937, y: 200.9170620943563 },
    { x: 2889.4830712561197, y: -46.93773106821885 },
    { x: 1659.9526942779821, y: 84.5249919949502 },
  ],
  vaults: {
    team1: { dx: -1050, y: 640 },
    team2: { dx: 1050, y: 640 },
  },
};

const MAP_LAYOUT_CONFIG = {
  platforms: [
    {
      textureKey: "bank-bust-base",
      x: 271.38,
      y: 176.37,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 1, height: 1, offsetX: 0, offsetY: 0 },
    },
    {
      textureKey: "bank-bust-base",
      x: 3332.63,
      y: 176.66,
      scaleX: 1,
      scaleY: 1,
      flipX: true,
      body: { width: 1, height: 1, offsetX: 0, offsetY: 0 },
    },
    {
      textureKey: "bank-bust-topcase",
      x: 1844.39,
      y: -371.44,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 3680, height: 224, offsetX: 0, offsetY: 0 },
    },
    {
      textureKey: "bank-bust-staircase",
      x: 1254.03,
      y: 350.69,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 155, height: 195, offsetX: 130, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-staircase",
      x: 2345.97,
      y: 350.69,
      scaleX: 1,
      scaleY: 1,
      flipX: true,
      body: { width: 155, height: 195, offsetX: 0, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-middle",
      x: 1796.54,
      y: -163.3,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 512, height: 192, offsetX: 0, offsetY: 0 },
    },
    {
      textureKey: "bank-bust-middlebottom",
      x: 1796.54,
      y: 150,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 510, height: 60, offsetX: 20, offsetY: 23 },
    },
    {
      textureKey: "bank-bust-middledetail",
      x: 1802.01,
      y: -281.08,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 116, height: 102, offsetX: 7, offsetY: 8 },
    },
    {
      textureKey: "bank-bust-longplatform",
      x: 1198.03,
      y: 107.51,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 192, height: 64, offsetX: 0, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-longplatform",
      x: 2401.97,
      y: 107.51,
      scaleX: 1,
      scaleY: 1,
      flipX: true,
      body: { width: 192, height: 64, offsetX: 0, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-bigblock",
      x: 749.48,
      y: 131.5,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 160, height: 258, offsetX: 0, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-bigblock",
      x: 2884.77,
      y: 139.85,
      scaleX: 1,
      scaleY: 1,
      flipX: true,
      body: { width: 160, height: 255, offsetX: 0, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-3x3",
      x: 1017.06,
      y: 272.01,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 88, height: 88, offsetX: 4, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-3x3",
      x: 1800,
      y: 439.95,
      scaleX: 1,
      scaleY: 1,
      flipX: true,
      body: { width: 88, height: 90, offsetX: 4, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-3x3",
      x: 2582.94,
      y: 272.01,
      scaleX: 1,
      scaleY: 1,
      flipX: true,
      body: { width: 88, height: 88, offsetX: 4, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-2x2",
      x: 749.48,
      y: -126.69,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 56, height: 60, offsetX: 4, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-2x2",
      x: 2850.52,
      y: -126.69,
      scaleX: 1,
      scaleY: 1,
      flipX: true,
      body: { width: 56, height: 60, offsetX: 4, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-tallplatform",
      x: 1009,
      y: -44.56,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 60, height: 123, offsetX: 2, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-tallplatform",
      x: 2591,
      y: -44.56,
      scaleX: 1,
      scaleY: 1,
      flipX: true,
      body: { width: 60, height: 123, offsetX: 2, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-abyss",
      x: 808.15,
      y: 533,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 1600, height: 113, offsetX: 0, offsetY: 16 },
    },
    {
      textureKey: "bank-bust-abyss",
      x: 2794.3,
      y: 533,
      scaleX: 1,
      scaleY: 1,
      flipX: true,
      body: { width: 1617, height: 113, offsetX: 18, offsetY: 16 },
    },
    {
      textureKey: "bank-bust-tallplatform",
      x: 1364.23,
      y: -94.98,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 64, height: 128, offsetX: 0, offsetY: 0 },
    },
    {
      textureKey: "bank-bust-tallplatform",
      x: 2214.97,
      y: -95.63,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 64, height: 128, offsetX: 0, offsetY: 0 },
    },
  ],
  hitboxes: [
    {
      x: 479.24,
      y: -15.18,
      width: 125.8,
      height: 153.11,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 496,
      y: 288.83,
      width: 95.54,
      height: 123.72,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 204.76,
      y: 190.4,
      width: 227.01,
      height: 58.69,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 153.82,
      y: 394.05,
      width: 134.35,
      height: 142.39,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 33.87,
      y: 186.13,
      width: 110,
      height: 551.44,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 161.42,
      y: -48.23,
      width: 311.61,
      height: 92.47,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 1208.87,
      y: 397.55,
      width: 67.17,
      height: 26,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 1142.91,
      y: 429.51,
      width: 61.61,
      height: 27.19,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 3124.31,
      y: -15.1,
      width: 124.27,
      height: 158.45,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 3110,
      y: 289.56,
      width: 97.11,
      height: 127.3,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 3413.46,
      y: 193.74,
      width: 257.55,
      height: 65.17,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 3449.61,
      y: 393.36,
      width: 136.28,
      height: 142.39,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 3559.9,
      y: 179.73,
      width: 98.9,
      height: 532.91,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 3440.18,
      y: -47.08,
      width: 309.08,
      height: 90.9,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 2391.13,
      y: 397.55,
      width: 67.17,
      height: 29.79,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 2457.09,
      y: 429.51,
      width: 61.61,
      height: 27.19,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 1844.39,
      y: -373,
      width: 440,
      height: 40,
      collision: { up: true, down: true, left: true, right: true },
    },
  ],
};

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
