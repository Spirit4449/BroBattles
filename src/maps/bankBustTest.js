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
        { x: 500.6547353298537, y: 204.86727232283715 },
        { x: 155.49093429008073, y: 303.6807475859542 },
      ],
    },
    team2: {
      3: [
        { x: 3141.8884548958554, y: -120.60079619207923 },
        { x: 3463.6214068099866, y: 300.5508442223778 },
        { x: 3126.4267476291548, y: 201.81194288118928 },
      ],
    },
  },
  powerups: [
    { dx: -610, y: 620 },
    { x: 750.4065175104173, y: -25.709586325150482 },
    { x: 1935.619419087003, y: 81.72297749960276 },
    { x: 1802.1184548958554, y: 331.5928502813859 },
    { x: 2397.5801361834147, y: 206.02456988376133 },
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
      x: 3349.77,
      y: 173.55,
      scaleX: 1,
      scaleY: 1,
      flipX: true,
      body: { width: 517.52, height: 576.66, offsetX: 14, offsetY: 8 },
    },
    {
      textureKey: "bank-bust-topcase",
      x: 1844.39,
      y: -371.44,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 416, height: 32, offsetX: 0, offsetY: 0 },
    },
    {
      textureKey: "bank-bust-staircase",
      x: 1134.53,
      y: 349.37,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 155, height: 195, offsetX: 130, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-staircase",
      x: 2465.47,
      y: 349.37,
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
      y: 84,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 192, height: 64, offsetX: 0, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-longplatform",
      x: 2401.97,
      y: 84,
      scaleX: 1,
      scaleY: 1,
      flipX: true,
      body: { width: 192, height: 56, offsetX: 0, offsetY: 3 },
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
      x: 967.72,
      y: 271.23,
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
      x: 2656.48,
      y: 265.13,
      scaleX: 1,
      scaleY: 1,
      flipX: true,
      body: { width: 90, height: 90, offsetX: 4, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-2x2",
      x: 1413.03,
      y: 261.2,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 56, height: 60, offsetX: 4, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-2x2",
      x: 2186.97,
      y: 261.2,
      scaleX: 1,
      scaleY: 1,
      flipX: true,
      body: { width: 56, height: 60, offsetX: 4, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-tallplatform",
      x: 975.75,
      y: -42.54,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 60, height: 123, offsetX: 2, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-tallplatform",
      x: 2656.48,
      y: 11.85,
      scaleX: 1,
      scaleY: 1,
      flipX: true,
      body: { width: 60, height: 123, offsetX: 2, offsetY: 3 },
    },
    {
      textureKey: "bank-bust-abyss",
      x: 808.15,
      y: 536.02,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 1600, height: 113, offsetX: 0, offsetY: 16 },
    },
    {
      textureKey: "bank-bust-abyss",
      x: 2791.85,
      y: 485.07,
      scaleX: 1,
      scaleY: 1,
      flipX: true,
      body: { width: 1617, height: 113, offsetX: 18, offsetY: 16 },
    },
    {
      textureKey: "bank-bust-tallplatform",
      x: 1381.03,
      y: -67.3,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      body: { width: 64, height: 128, offsetX: 0, offsetY: 0 },
    },
    {
      textureKey: "bank-bust-tallplatform",
      x: 2214.97,
      y: -67.3,
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
      x: 495.02,
      y: 290.97,
      width: 88.9,
      height: 120.2,
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
      x: 1090.19,
      y: 393.5,
      width: 67.17,
      height: 26,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 1023.57,
      y: 428.34,
      width: 61.61,
      height: 27.19,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 3171.67,
      y: -2.83,
      width: 137.9,
      height: 178.32,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 3153.26,
      y: 262.07,
      width: 107.22,
      height: 140.93,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 3439.77,
      y: 191.4,
      width: 179.17,
      height: 65.17,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 3510.23,
      y: 369.97,
      width: 176.42,
      height: 142.39,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 3234.17,
      y: 247.39,
      width: 74.92,
      height: 11.11,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 3373.17,
      y: 352.94,
      width: 100.02,
      height: 6,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 3565.94,
      y: 190.44,
      width: 73.54,
      height: 476.36,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 3477.41,
      y: -19.99,
      width: 252.53,
      height: 67.1,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 2509.81,
      y: 399.55,
      width: 67.17,
      height: 29.79,
      collision: { up: true, down: true, left: true, right: true },
    },
    {
      x: 2576.43,
      y: 428.34,
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

const BANK_BUST_CONFIG = {
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
  name: "Bank Bust Test",
  bgAsset: "/assets/bank-bust/gameBg.webp",
  mapSelectPreviewAsset: "/assets/serenity/preview.webp",
  lobbyBgAsset: "/assets/serenity/lobbyBg.webp",
  lobbyPlatformAsset: "/assets/serenity/lobbyPlatform.webp",
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
      BANK_BUST_CONFIG.spawns,
      team,
      index,
      teamSize,
    );
    if (!point) return;
    placeSpriteAtConfiguredSpawn(scene, sprite, point, _spawnAnchors, 2);
  },

  getSpawnConfig() {
    return BANK_BUST_CONFIG.spawns;
  },

  getBoundaryConfig() {
    return BANK_BUST_CONFIG.boundaries;
  },

  getEditorTextureKeys() {
    return BANK_BUST_CONFIG.editorTextureKeys;
  },

  getSpawnAnchors() {
    return _spawnAnchors;
  },
};
