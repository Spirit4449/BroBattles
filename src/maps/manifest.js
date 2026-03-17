// src/maps/manifest.js
//
// Central map registry.  To add a new map:
//   1. Create src/maps/yourMap.js following the same pattern as lushyPeaks.js.
//   2. Import its `definition` here and add it to the MAPS object.
//   3. That's it — buildMap / positionSpawn / getMapBgAsset / getMapObjects
//      all work automatically for the new map ID.

import { definition as lushyDef } from "./lushyPeaks";
import { definition as mangroveDef } from "./mangroveMeadow";
import { definition as undergroundDef } from "./underground";

// Registry: numeric mapId -> definition
const MAPS = {};
for (const d of [lushyDef, mangroveDef, undergroundDef]) {
  MAPS[d.id] = d;
}

export function normalizeMapId(mapId) {
  const n = Number(mapId);
  if (Number.isFinite(n) && MAPS[n]) return n;
  return lushyDef.id;
}

/**
 * Build the map platforms inside a Phaser scene.
 * @param {Phaser.Scene} scene
 * @param {number|string} mapId
 */
export function buildMap(scene, mapId) {
  MAPS[normalizeMapId(mapId)]?.build(scene);
}

/**
 * Position a sprite at its team spawn point.
 * Uniform signature across all maps — no more per-map if/else in game.js.
 *
 * @param {Phaser.Scene} scene
 * @param {object}       sprite    — Phaser sprite to place
 * @param {number|string} mapId
 * @param {string}       team      — "team1" | "team2"
 * @param {number}       index     — 0-based index within the team
 * @param {number}       teamSize  — total players on that team
 */
export function positionSpawn(scene, sprite, mapId, team, index, teamSize) {
  MAPS[normalizeMapId(mapId)]?.positionSpawn(
    scene,
    sprite,
    team,
    index,
    teamSize,
  );
}

/**
 * Return the populated Phaser objects array (for physics/collision setup).
 * Must be called after buildMap().
 * @param {number|string} mapId
 * @returns {object[]}
 */
export function getMapObjects(mapId) {
  return MAPS[normalizeMapId(mapId)]?.getObjects() ?? [];
}

/**
 * Background image URL for the given map (used in battle-start overlay).
 * @param {number|string} mapId
 * @returns {string}
 */
export function getMapBgAsset(mapId) {
  return MAPS[normalizeMapId(mapId)]?.bgAsset ?? "/assets/lushy/gameBg.webp";
}

export default MAPS;
