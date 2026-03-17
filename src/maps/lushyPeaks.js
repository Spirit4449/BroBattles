// lushyPeaks.js
// To add / tweak this map, edit the constants below — no need to touch build() or
// positionSpawn().  To add an entirely new map, follow the same pattern and
// register it in src/maps/manifest.js.

import { snapSpriteToPlatform } from "./mapUtils";

// ── Layout constants ─────────────────────────────────────────────────────────
const SCALE_MAIN = 0.7; // base + centre platform + side platforms
const SCALE_TINY = 0.45; // small corner platforms

const BASE_Y = 630; // main floor Y
const PLATFORM_Y = 300; // elevated centre platform Y
const SIDE_DX = 490; // left/right side platform X offset from centre
const SIDE_Y = 325; // side platform Y
const SMALL_DX = 530; // small corner platform X offset from centre
const SMALL_Y = 580; // small corner platform Y

// team1 spawns on base (bottom), team2 spawns on the elevated platform (top)
const TEAM1_PLATFORM = "base";
const TEAM2_PLATFORM = "top";

// ── Runtime platform references (set during build) ───────────────────────────
let _base = null;
let _platform = null;
const _objects = [];

// ── Map definition ───────────────────────────────────────────────────────────
export const definition = {
  id: 1,
  name: "Lushy Peaks",
  bgAsset: "/assets/lushy/gameBg.webp",

  build(scene) {
    _objects.length = 0;
    _base = null;
    _platform = null;
    const cx = scene.scale.width / 2;

    function plat(key, x, y, scale) {
      const s = scene.physics.add.sprite(x, y, key);
      s.body.allowGravity = false;
      s.setImmovable(true);
      s.setScale(scale);
      _objects.push(s);
      return s;
    }

    _base = plat("lushy-base", cx, BASE_Y, SCALE_MAIN);
    _platform = plat("lushy-platform", cx, PLATFORM_Y, SCALE_MAIN);
    plat("lushy-side-platform", cx - SIDE_DX, SIDE_Y, SCALE_MAIN);
    plat("lushy-side-platform", cx + SIDE_DX, SIDE_Y, SCALE_MAIN);
    plat("mangrove-tiny-platform", cx - SMALL_DX, SMALL_Y, SCALE_TINY);
    plat("mangrove-tiny-platform", cx + SMALL_DX, SMALL_Y, SCALE_TINY);
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
    const target = team === "team2" ? _platform : _base;
    if (!sprite || !target) return;
    const bounds = target.getBounds();
    const slots = Math.max(1, Number(teamSize) || 1);
    const i = Math.min(slots - 1, Math.max(0, Number(index) || 0));
    const cx = bounds.left + bounds.width * ((i + 0.5) / slots);
    snapSpriteToPlatform(sprite, target, cx, 2);
  },
};

// ── Legacy named exports (game.js backward-compat; use manifest.js for new code) ──
export const lushyPeaksObjects = _objects;

export function lushyPeaks(scene) {
  definition.build(scene);
}

export function positionLushySpawn(scene, sprite, team, index, teamSize) {
  definition.positionSpawn(scene, sprite, team, index, teamSize);
}
