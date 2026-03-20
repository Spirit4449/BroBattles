// serenity.js
// To add / tweak this map, edit the constants below — no need to touch build() or
// positionSpawn().  To add an entirely new map, follow the same pattern and
// register it in src/maps/manifest.js.

import { snapSpriteToPlatform } from "./mapUtils";

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
    const cx = scene.scale.width / 2;

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
    const target =
      team === "team2" ? _largePlatform : (_logBars[1] ?? _logPlatform);
    if (!sprite || !target) return;
    const bounds = target.getBounds();
    const slots = Math.max(1, Number(teamSize) || 1);
    const i = Math.min(slots - 1, Math.max(0, Number(index) || 0));
    const cx = bounds.left + bounds.width * ((i + 0.5) / slots);
    snapSpriteToPlatform(sprite, target, cx, 2);
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
