// serenity.js
// To add / tweak this map, edit the constants below — no need to touch build() or
// positionSpawn().  To add an entirely new map, follow the same pattern and
// register it in src/maps/manifest.js.

import {
  appendLayoutObjectsFromConfig,
  getSceneWorldCenterX,
  getSpawnPointForTeam,
  placeSpriteAtConfiguredSpawn,
} from "./mapUtils";

// ── Single tuning object (edit only this) ───────────────────────────────────
const SERENITY_CONFIG = {
  scale: {
    main: 0.45,
    tiny: 0.86,
    log: 0.6,
  },
  layout: {
    platformY: 700,
    leftSideDx: 450,
    rightSideDx: 150,
    sideY: 270,
    rightSideExtraY: 100,
    logX: 350,
    logY: 260,
    rockX: 350,
    rockY: 490,
  },
  bodies: {
    large: { h: 480, offsetY: 70 },
    left: { h: 95, offsetY: 25 },
    right: { h: 120, offsetY: 25 },
    rock: { h: 90, offsetY: 25 },
  },
  sideWalls: {
    w: 16,
    inset: 7,
    left: { h: 70, dy: 62 },
    right: { h: 160, dy: 110 },
  },
  log: {
    bars: [
      { x: -150, y: 90, w: 175 },
      { x: 0, y: 10, w: 330 },
      { x: 155, y: 90, w: 177 },
    ],
    barH: 16,
  },

  spawns: {
    players: {
      team1: {
        1: [{ dx: 0, anchorId: "log-mid" }],
        2: [
          { dx: -100, anchorId: "log-mid" },
          { dx: 100, anchorId: "log-mid" },
        ],
        3: [
          { anchorId: "log-mid", x: 1350.8948745203786 },
          { dx: 0, anchorId: "log-mid" },
          { dx: 145, anchorId: "log-mid" },
        ],
      },
      team2: {
        1: [{ dx: 0, anchorId: "large" }],
        2: [
          { dx: -130, anchorId: "large" },
          { dx: 130, anchorId: "large" },
        ],
        3: [
          { dx: -200, anchorId: "large" },
          { dx: 0, anchorId: "large" },
          { dx: 200, anchorId: "large" },
        ],
      },
    },
    powerups: [
      { x: 950, y: 500 },
      { x: 1063.1971715232796, y: 490.1564423216863 },
      { x: 1133.170852941433, y: 356.82097922452846 },
      { x: 646.3509359119226, y: 91.76465058882098 },
      { x: 1463.1537643886436, y: 453.6483477405304 },
      { x: 1000, y: 230 },
      { x: 1187.4152701441005, y: 164.6745717711911 },
      { x: 1441.8331561753937, y: 195.10011368597884 },
      { x: 800.938281655015, y: 374.89988631402116 },
    ],
  },
  boundaries: {
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
  },
  editorTextureKeys: [
    "serenity-large-platform",
    "serenity-side-platform",
    "serenity-log-platform",
    "serenity-small-rock",
  ],
};

// Optional editor-driven layout config. Set `USE_LAYOUT_CONFIG_ONLY=true`
// and paste exported platforms/hitboxes below to build this map from config.
const USE_LAYOUT_CONFIG_ONLY = true;
const MAP_LAYOUT_CONFIG = {
  platforms: [
    {
      textureKey: "serenity-large-platform",
      x: 1150,
      y: 700,
      scaleX: 0.45,
      scaleY: 0.45,
      flipX: false,
      body: {
        width: 582.3,
        height: 216,
        offsetX: 0,
        offsetY: 70,
      },
    },
    {
      textureKey: "serenity-side-platform",
      x: 648.27,
      y: 270,
      scaleX: 0.86,
      scaleY: 0.86,
      flipX: true,
      body: {
        width: 228.76,
        height: 81.7,
        offsetX: 0,
        offsetY: 25,
      },
    },
    {
      textureKey: "serenity-side-platform",
      x: 1000,
      y: 370,
      scaleX: 0.76,
      scaleY: 0.76,
      flipX: false,
      body: {
        width: 202.16,
        height: 91.2,
        offsetX: 0,
        offsetY: 25,
      },
    },
    {
      textureKey: "serenity-small-rock",
      x: 800,
      y: 490,
      scaleX: 0.45,
      scaleY: 0.45,
      flipX: false,
      body: {
        width: 103.05,
        height: 40.5,
        offsetX: 0,
        offsetY: 25,
      },
    },
    {
      textureKey: "serenity-log-platform",
      x: 1500,
      y: 260,
      scaleX: 0.6,
      scaleY: 0.6,
      flipX: false,
      body: {
        width: 0,
        height: 0,
        offsetX: 0,
        offsetY: 0,
      },
    },
  ],
  hitboxes: [
    {
      x: 543.93,
      y: 236.04,
      width: 16,
      height: 160,
      collision: {
        up: false,
        down: false,
        left: true,
        right: true,
      },
    },
    {
      x: 754.56,
      y: 199.55,
      width: 16,
      height: 70,
      collision: {
        up: false,
        down: false,
        left: true,
        right: true,
      },
    },
    {
      x: 905.92,
      y: 309.26,
      width: 16,
      height: 70,
      collision: {
        up: false,
        down: false,
        left: true,
        right: true,
      },
    },
    {
      x: 1094.08,
      y: 357.26,
      width: 16,
      height: 160,
      collision: {
        up: false,
        down: false,
        left: true,
        right: true,
      },
    },
    {
      x: 1350,
      y: 350,
      width: 175,
      height: 16,
      collision: {
        up: true,
        down: false,
        left: false,
        right: false,
      },
    },
    {
      x: 1500,
      y: 270,
      width: 330,
      height: 16,
      collision: {
        up: true,
        down: false,
        left: false,
        right: false,
      },
    },
    {
      x: 1655,
      y: 350,
      width: 177,
      height: 16,
      collision: {
        up: true,
        down: false,
        left: false,
        right: false,
      },
    },
  ],
};

// ── Runtime platform references (set during build) ───────────────────────────
let _largePlatform = null;
let _leftPlatform = null;
let _rightPlatform = null;
let _logPlatform = null;
let _smallRock = null;
let _logBars = [];
let _sideWalls = [];
const _objects = [];
const _spawnAnchors = Object.create(null);

// ── Map definition ───────────────────────────────────────────────────────────
export const definition = {
  id: 3,
  name: "serenity",
  bgAsset: "/assets/serenity/gameBg.webp",
  mapSelectPreviewAsset: "/assets/serenity/preview.webp",
  lobbyBgAsset: "/assets/serenity/lobbyBg.webp",
  lobbyPlatformAsset: "/assets/serenity/lobbyPlatform.webp",
  lobbyCharacterOffsetY: 25,
  // Optional per-mode override (1v1/2v2/3v3). Omit to use scaled base offset.
  // lobbyCharacterOffsetYByMode: { 1: 16, 2: 11, 3: 9 },

  build(scene) {
    _objects.length = 0;
    _logBars.length = 0;
    _sideWalls.length = 0;
    for (const k of Object.keys(_spawnAnchors)) delete _spawnAnchors[k];

    if (USE_LAYOUT_CONFIG_ONLY) {
      appendLayoutObjectsFromConfig(scene, _objects, MAP_LAYOUT_CONFIG);
      for (const obj of _objects) {
        if (obj?.texture?.key === "serenity-large-platform") {
          _spawnAnchors.large = obj;
          continue;
        }

        // Log platform is visual-only; one-way bar hitboxes handle collision.
        if (obj?.texture?.key === "serenity-log-platform" && obj?.body) {
          obj.body.enable = false;
        }

        // Match the middle one-way log bar exported from editor hitboxes.
        if (
          obj?.type === "Zone" &&
          Math.abs(Number(obj?.x) - 1500) < 1 &&
          Math.abs(Number(obj?.y) - 270) < 1 &&
          Math.abs(Number(obj?.width) - 330) < 1 &&
          Math.abs(Number(obj?.height) - 16) < 1
        ) {
          _spawnAnchors["log-mid"] = obj;
        }
      }
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

    _largePlatform = plat(
      "serenity-large-platform",
      cx,
      SERENITY_CONFIG.layout.platformY,
      SERENITY_CONFIG.scale.main,
    );
    _largePlatform.body.setSize(
      _largePlatform.body.width,
      SERENITY_CONFIG.bodies.large.h,
    );
    _largePlatform.body.setOffset(
      _largePlatform.body.offset.x,
      SERENITY_CONFIG.bodies.large.offsetY,
    );
    _spawnAnchors.large = _largePlatform;

    _leftPlatform = plat(
      "serenity-side-platform",
      cx - SERENITY_CONFIG.layout.leftSideDx,
      SERENITY_CONFIG.layout.sideY,
      SERENITY_CONFIG.scale.tiny,
    );
    _leftPlatform.setFlipX(true);
    _leftPlatform.body.setSize(
      _leftPlatform.body.width,
      SERENITY_CONFIG.bodies.left.h,
    );
    _leftPlatform.body.setOffset(
      _leftPlatform.body.offset.x,
      SERENITY_CONFIG.bodies.left.offsetY,
    );

    _rightPlatform = plat(
      "serenity-side-platform",
      cx - SERENITY_CONFIG.layout.rightSideDx,
      SERENITY_CONFIG.layout.sideY + SERENITY_CONFIG.layout.rightSideExtraY,
      SERENITY_CONFIG.scale.tiny - 0.1,
    );
    _rightPlatform.body.setSize(
      _rightPlatform.body.width,
      SERENITY_CONFIG.bodies.right.h,
    );
    _rightPlatform.body.setOffset(
      _rightPlatform.body.offset.x,
      SERENITY_CONFIG.bodies.right.offsetY,
    );

    _smallRock = plat(
      "serenity-small-rock",
      cx - SERENITY_CONFIG.layout.rockX,
      SERENITY_CONFIG.layout.rockY,
      SERENITY_CONFIG.scale.main,
    );
    _smallRock.body.setSize(
      _smallRock.body.width,
      SERENITY_CONFIG.bodies.rock.h,
    );
    _smallRock.body.setOffset(
      _smallRock.body.offset.x,
      SERENITY_CONFIG.bodies.rock.offsetY,
    );

    function addWallJumpSides(platform) {
      const b = platform.getBounds();
      const leftCfg = platform.flipX
        ? SERENITY_CONFIG.sideWalls.right
        : SERENITY_CONFIG.sideWalls.left;
      const rightCfg = platform.flipX
        ? SERENITY_CONFIG.sideWalls.left
        : SERENITY_CONFIG.sideWalls.right;
      const left = scene.add.zone(
        b.left + SERENITY_CONFIG.sideWalls.inset,
        b.top + leftCfg.dy,
        SERENITY_CONFIG.sideWalls.w,
        leftCfg.h,
      );
      const right = scene.add.zone(
        b.right - SERENITY_CONFIG.sideWalls.inset,
        b.top + rightCfg.dy,
        SERENITY_CONFIG.sideWalls.w,
        rightCfg.h,
      );

      for (const wall of [left, right]) {
        scene.physics.add.existing(wall, true);
        wall.body.checkCollision.up = false;
        wall.body.checkCollision.down = false;
        _sideWalls.push(wall);
        _objects.push(wall);
      }
    }

    addWallJumpSides(_leftPlatform);
    addWallJumpSides(_rightPlatform);

    // Log platform: visual sprite only — collision handled by the 3 bars below
    const logCx = cx + SERENITY_CONFIG.layout.logX;
    _logPlatform = scene.physics.add.sprite(
      logCx,
      SERENITY_CONFIG.layout.logY,
      "serenity-log-platform",
    );
    _logPlatform.body.allowGravity = false;
    _logPlatform.setImmovable(true);
    _logPlatform.setScale(SERENITY_CONFIG.scale.log);
    _logPlatform.body.enable = false; // visual only
    _objects.push(_logPlatform);

    // 3 one-way bars: players can jump up through, but land on top
    for (const cfg of SERENITY_CONFIG.log.bars) {
      const bar = scene.add.zone(
        logCx + cfg.x,
        SERENITY_CONFIG.layout.logY + cfg.y,
        cfg.w,
        SERENITY_CONFIG.log.barH,
      );
      scene.physics.add.existing(bar, true);
      bar.body.checkCollision.down = false;
      bar.body.checkCollision.left = false;
      bar.body.checkCollision.right = false;
      _logBars.push(bar);
      _objects.push(bar);
    }
    _spawnAnchors["log-mid"] = _logBars[1] || _logPlatform;
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
    const point = getSpawnPointForTeam(
      SERENITY_CONFIG.spawns,
      team,
      index,
      teamSize,
    );
    if (!point) return;
    placeSpriteAtConfiguredSpawn(scene, sprite, point, _spawnAnchors, 2);
  },

  getSpawnConfig() {
    return SERENITY_CONFIG.spawns;
  },

  getBoundaryConfig() {
    return SERENITY_CONFIG.boundaries;
  },

  getEditorTextureKeys() {
    return SERENITY_CONFIG.editorTextureKeys;
  },

  getSpawnAnchors() {
    return _spawnAnchors;
  },
};

// ── Legacy named exports (game.js backward-compat; use manifest.js for new code) ──
export const serenityObjects = _objects;

export function serenity(scene) {
  definition.build(scene);
}

export function positionserenitySpawn(scene, sprite, team, index, teamSize) {
  definition.positionSpawn(scene, sprite, team, index, teamSize);
}
