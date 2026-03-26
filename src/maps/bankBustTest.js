import {
  getSceneWorldCenterX,
  getSpawnPointForTeam,
  placeSpriteAtConfiguredSpawn,
} from "./mapUtils";

const BANK_BUST_CONFIG = {
  scale: {
    base: 0.95,
    bridge: 0.62,
    side: 0.78,
    log: 0.52,
    rock: 0.42,
  },
  layout: {
    floorY: 720,
    centerBridgeY: 470,
    upperBridgeY: 300,
    baseOffsetX: 690,
    sideLaneOffsetX: 430,
    sideLaneY: 560,
    rockOffsetX: 250,
    rockY: 610,
    centerLogOffsetX: 0,
    centerLogY: 365,
  },
  spawns: {
    players: {
      team1: {
        3: [
          { dx: -130, anchorId: "team1-spawn" },
          { dx: 0, anchorId: "team1-spawn" },
          { dx: 130, anchorId: "team1-spawn" },
        ],
      },
      team2: {
        3: [
          { dx: -130, anchorId: "team2-spawn" },
          { dx: 0, anchorId: "team2-spawn" },
          { dx: 130, anchorId: "team2-spawn" },
        ],
      },
    },
    powerups: [
      { x: 895, y: 520 },
      { x: 1150, y: 520 },
      { x: 1405, y: 520 },
      { x: 985, y: 320 },
      { x: 1315, y: 320 },
      { x: 1150, y: 260 },
    ],
    vaults: {
      team1: { anchorId: "team1-vault", dx: 0, dy: -65 },
      team2: { anchorId: "team2-vault", dx: 0, dy: -65 },
    },
  },
  boundaries: {
    world: { x: 0, y: 0, width: 3000, height: 1200 },
    camera: {
      x: 0,
      y: -60,
      width: 3000,
      height: 1200,
      zoom: 1.3,
      deadzoneWidth: 80,
      deadzoneHeight: 60,
      followOffsetY: 100,
    },
  },
  editorTextureKeys: [
    "lushy-base",
    "serenity-large-platform",
    "serenity-side-platform",
    "serenity-log-platform",
    "serenity-small-rock",
  ],
};

let _objects = [];
const _spawnAnchors = Object.create(null);

function addPlatform(scene, key, x, y, scale, bodyConfig = {}) {
  const sprite = scene.physics.add.sprite(x, y, key);
  sprite.body.allowGravity = false;
  sprite.setImmovable(true);
  sprite.setScale(scale);
  if (Number.isFinite(bodyConfig.width) && Number.isFinite(bodyConfig.height)) {
    sprite.body.setSize(bodyConfig.width, bodyConfig.height);
  }
  if (Number.isFinite(bodyConfig.offsetX) || Number.isFinite(bodyConfig.offsetY)) {
    sprite.body.setOffset(
      Number(bodyConfig.offsetX) || sprite.body.offset.x,
      Number(bodyConfig.offsetY) || sprite.body.offset.y,
    );
  }
  _objects.push(sprite);
  return sprite;
}

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

    const cx = getSceneWorldCenterX(scene);
    const leftBaseX = cx - BANK_BUST_CONFIG.layout.baseOffsetX;
    const rightBaseX = cx + BANK_BUST_CONFIG.layout.baseOffsetX;

    const leftBase = addPlatform(
      scene,
      "lushy-base",
      leftBaseX,
      BANK_BUST_CONFIG.layout.floorY,
      BANK_BUST_CONFIG.scale.base,
      { height: 520, offsetY: 70 },
    );
    const rightBase = addPlatform(
      scene,
      "lushy-base",
      rightBaseX,
      BANK_BUST_CONFIG.layout.floorY,
      BANK_BUST_CONFIG.scale.base,
      { height: 520, offsetY: 70 },
    );
    const centerBridge = addPlatform(
      scene,
      "serenity-large-platform",
      cx,
      BANK_BUST_CONFIG.layout.centerBridgeY,
      BANK_BUST_CONFIG.scale.bridge,
      { height: 220, offsetY: 45 },
    );
    const topBridge = addPlatform(
      scene,
      "serenity-log-platform",
      cx + BANK_BUST_CONFIG.layout.centerLogOffsetX,
      BANK_BUST_CONFIG.layout.centerLogY,
      BANK_BUST_CONFIG.scale.log,
      { height: 120, offsetY: 25 },
    );
    addPlatform(
      scene,
      "serenity-side-platform",
      cx - BANK_BUST_CONFIG.layout.sideLaneOffsetX,
      BANK_BUST_CONFIG.layout.sideLaneY,
      BANK_BUST_CONFIG.scale.side,
      { height: 120, offsetY: 22 },
    ).setFlipX(true);
    addPlatform(
      scene,
      "serenity-side-platform",
      cx + BANK_BUST_CONFIG.layout.sideLaneOffsetX,
      BANK_BUST_CONFIG.layout.sideLaneY,
      BANK_BUST_CONFIG.scale.side,
      { height: 120, offsetY: 22 },
    );
    addPlatform(
      scene,
      "serenity-small-rock",
      cx - BANK_BUST_CONFIG.layout.rockOffsetX,
      BANK_BUST_CONFIG.layout.rockY,
      BANK_BUST_CONFIG.scale.rock,
      { height: 90, offsetY: 20 },
    );
    addPlatform(
      scene,
      "serenity-small-rock",
      cx + BANK_BUST_CONFIG.layout.rockOffsetX,
      BANK_BUST_CONFIG.layout.rockY,
      BANK_BUST_CONFIG.scale.rock,
      { height: 90, offsetY: 20 },
    );

    _spawnAnchors["team1-spawn"] = leftBase;
    _spawnAnchors["team2-spawn"] = rightBase;
    _spawnAnchors["team1-vault"] = leftBase;
    _spawnAnchors["team2-vault"] = rightBase;
    _spawnAnchors["center-bridge"] = centerBridge;
    _spawnAnchors["top-bridge"] = topBridge;
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
