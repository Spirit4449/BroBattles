// mangroveMeadow.js
// To add / tweak this map, edit the constants below — no need to touch build()
// or positionSpawn().  To add an entirely new map, follow the same pattern and
// register it in src/maps/manifest.js.

import { snapSpriteToPlatform } from "./mapUtils";

// ── Layout constants ─────────────────────────────────────────────────────────
const SCALE = 0.6;

const BASE_MID_Y = 600; // main floor
const BASE_TOP_Y = 408; // elevated centre base
const BASE_SIDE_DX = 422; // left/right base X offset from centre
const BASE_SIDE_Y = 638; // left/right base Y

// Tiny platform layout: each entry is [dx, y]
// Indices 0-2 → team2 spawn platforms; indices 3-5 → team1 spawn platforms
const TINY_LAYOUT = [
  [-280, 325], // 0 – team2
  [+280, 325], // 1 – team2
  [-430, 200], // 2 – team2
  [+430, 200], // 3 – team1
  [-130, 150], // 4 – team1
  [+130, 150], // 5 – team1
];

const TEAM2_SPAWN_INDICES = [0, 1, 2];
const TEAM1_SPAWN_INDICES = [3, 4, 5];

// ── Runtime references (set during build) ──────────────────────────────────
const _tinyPlatforms = []; // [0..5] matching TINY_LAYOUT
const _objects = [];

// ── Map definition ───────────────────────────────────────────────────────────
export const definition = {
  id: 2,
  name: "Mangrove Meadow",
  bgAsset: "/assets/mangrove/gameBg.webp",

  build(scene) {
    _objects.length = 0;
    _tinyPlatforms.length = 0;
    const cx = scene.scale.width / 2;

    function plat(key, x, y) {
      const s = scene.physics.add.sprite(x, y, key);
      s.body.allowGravity = false;
      s.setImmovable(true);
      s.setScale(SCALE);
      _objects.push(s);
      return s;
    }

    plat("mangrove-base-middle", cx, BASE_MID_Y);
    plat("mangrove-base-top", cx, BASE_TOP_Y);
    plat("mangrove-base-left", cx - BASE_SIDE_DX, BASE_SIDE_Y);
    plat("mangrove-base-right", cx + BASE_SIDE_DX, BASE_SIDE_Y);

    for (const [dx, y] of TINY_LAYOUT) {
      _tinyPlatforms.push(plat("mangrove-tiny-platform", cx + dx, y));
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
   * @param {number}  [teamSize] — unused (kept for uniform signature)
   */
  positionSpawn(scene, sprite, team, index /*, teamSize */) {
    if (!sprite) return;
    const indices =
      team === "team2" ? TEAM2_SPAWN_INDICES : TEAM1_SPAWN_INDICES;
    const i = Math.max(0, Number(index) || 0) % indices.length;
    const plat = _tinyPlatforms[indices[i]];
    if (!plat) return;
    snapSpriteToPlatform(sprite, plat, plat.getCenter().x, 2);
  },
};

// ── Legacy named exports (game.js backward-compat; use manifest.js for new code) ──
export const mangroveMeadowObjects = _objects;

export function mangroveMeadow(scene) {
  definition.build(scene);
}

export function positionMangroveSpawn(scene, sprite, team, index) {
  definition.positionSpawn(scene, sprite, team, index);
}
