// src/maps/manifest.js
//
// Central map registry.  To add a new map:
//   1. Create src/maps/yourMap.js following the same pattern as lushyPeaks.js.
//   2. Import its `definition` here and add it to the MAPS object.
//   3. That's it — buildMap / positionSpawn / getMapBgAsset / getMapObjects
//      all work automatically for the new map ID.

import { definition as lushyDef } from "./lushyPeaks";
import { definition as mangroveDef } from "./mangroveMeadow";
import { definition as serenityDef } from "./serenity";
import { definition as bankBustTestDef } from "./bankBustTest";
import mapsCatalog from "../shared/maps.catalog.json";
import mapCollisionConfig from "../shared/mapCollisionConfig.json";

// Registry: numeric mapId -> definition
const MAPS = {};
for (const d of [lushyDef, mangroveDef, serenityDef, bankBustTestDef]) {
  MAPS[d.id] = d;
}
const MAP_META = new Map(
  (Array.isArray(mapsCatalog?.maps) ? mapsCatalog.maps : []).map((entry) => [
    Number(entry?.id),
    entry,
  ]),
);

const LOBBY_OFFSET_MODE_SCALE = {
  1: 1,
  2: 0.72,
  3: 0.58,
};

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
 * Player + powerup spawn config for a map.
 * @param {number|string} mapId
 * @returns {object}
 */
export function getMapSpawnConfig(mapId) {
  return (
    MAPS[normalizeMapId(mapId)]?.getSpawnConfig?.() ?? {
      players: {},
      powerups: [],
    }
  );
}

/**
 * Runtime boundary/camera config for a map.
 * @param {number|string} mapId
 * @returns {object}
 */
export function getMapBoundaryConfig(mapId) {
  return MAPS[normalizeMapId(mapId)]?.getBoundaryConfig?.() ?? {};
}

export function getMapServerCollisionConfig(mapId) {
  return mapCollisionConfig?.maps?.[String(normalizeMapId(mapId))] ?? null;
}

/**
 * List of texture keys that can be used to add platforms in editor mode.
 * @param {number|string} mapId
 * @returns {string[]}
 */
export function getMapEditorTextureKeys(mapId) {
  return MAPS[normalizeMapId(mapId)]?.getEditorTextureKeys?.() ?? [];
}

/**
 * Runtime platform anchors for spawn snapping.
 * @param {number|string} mapId
 * @returns {object}
 */
export function getMapSpawnAnchors(mapId) {
  return MAPS[normalizeMapId(mapId)]?.getSpawnAnchors?.() ?? {};
}

/**
 * Background image URL for the given map (used in battle-start overlay).
 * @param {number|string} mapId
 * @returns {string}
 */
export function getMapBgAsset(mapId) {
  return MAPS[normalizeMapId(mapId)]?.bgAsset ?? "/assets/lushy/gameBg.webp";
}

/**
 * Map selection preview image URL for lobby map picker popup.
 * @param {number|string} mapId
 * @returns {string}
 */
export function getMapSelectPreviewAsset(mapId) {
  const normalized = normalizeMapId(mapId);
  const def = MAPS[normalized];
  const meta = MAP_META.get(normalized);
  return (
    meta?.mapSelectPreviewAsset ||
    def?.mapSelectPreviewAsset || def?.bgAsset || "/assets/lushy/gameBg.webp"
  );
}

/**
 * Lobby background image URL for the given map.
 * @param {number|string} mapId
 * @returns {string}
 */
export function getLobbyBgAsset(mapId) {
  const meta = MAP_META.get(normalizeMapId(mapId));
  return (
    meta?.lobbyBgAsset ||
    (MAPS[normalizeMapId(mapId)]?.lobbyBgAsset ?? "/assets/lushy/lobbyBg.webp")
  );
}

/**
 * Lobby platform image URL for the given map.
 * @param {number|string} mapId
 * @returns {string}
 */
export function getLobbyPlatformAsset(mapId) {
  const meta = MAP_META.get(normalizeMapId(mapId));
  return (
    meta?.lobbyPlatformAsset ||
    (MAPS[normalizeMapId(mapId)]?.lobbyPlatformAsset ??
      "/assets/lushy/lobbyPlatform.webp")
  );
}

/**
 * Lobby character Y offset in px for the given map + mode.
 * Positive values move characters down toward the platform image.
 * @param {number|string} mapId
 * @param {number|string} [mode]
 * @returns {number}
 */
export function getLobbyCharacterOffsetY(mapId, mode = 1) {
  const def = MAPS[normalizeMapId(mapId)] || {};
  const m = Math.max(1, Math.min(3, Number(mode) || 1));

  // Optional explicit per-mode override on map definitions.
  const byMode = def?.lobbyCharacterOffsetYByMode;
  if (byMode && typeof byMode === "object") {
    const explicit = Number(byMode[m] ?? byMode[String(m)]);
    if (Number.isFinite(explicit)) return explicit;
  }

  // Backward-compatible numeric base offset with mode scaling.
  const base = Number(def?.lobbyCharacterOffsetY);
  if (!Number.isFinite(base)) return 0;
  const scale = Number(LOBBY_OFFSET_MODE_SCALE[m]) || 1;
  return Math.round(base * scale * 100) / 100;
}

export default MAPS;
