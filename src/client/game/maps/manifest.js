// src/client/game/maps/manifest.js
//
// Client-side lookups over map documents. Built-in maps ship as documents in
// src/shared/maps; new maps are created in Map Studio and discovered through
// the backend catalog; see docs/development/maps.md.

import { mapDefaults as defaults, mapsCatalog } from '../../../shared/maps';
import { buildMapDocument, getDocumentRuntime, spawnOnMapDocument } from './documentRuntime';
import { DEFAULT_MAP_ID } from '../../../shared/gameSelection';

const MAP_META = new Map(
  (Array.isArray(mapsCatalog?.maps) ? mapsCatalog.maps : []).map((entry) => [
    Number(entry?.id),
    entry,
  ]),
);

export function registerMapMetadata(entries) {
  for (const entry of entries || []) MAP_META.set(Number(entry.id), entry);
}

export function normalizeMapId(mapId) {
  const n = Number(mapId);
  if (Number.isFinite(n) && (MAP_META.has(n) || getDocumentRuntime(n))) return n;
  return DEFAULT_MAP_ID;
}

/** Built-in 1v1 document for a map, used when the server sent no snapshot. */
export function getDefaultMapDocument(mapId) {
  return defaults.find((d) => d.id === Number(mapId))?.variants['1v1'] || null;
}

/**
 * Build the map platforms inside a Phaser scene.
 * @param {Phaser.Scene} scene
 * @param {number|string} mapId
 */
export function buildMap(scene, mapId, snapshot = null) {
  scene._terrainType = MAP_META.get(normalizeMapId(mapId))?.terrain || 'hard';
  const data = snapshot || getDefaultMapDocument(mapId);
  if (data) buildMapDocument(scene, mapId, data);
}

/**
 * Position a sprite at its team spawn point.
 *
 * @param {Phaser.Scene} scene
 * @param {object}       sprite    — Phaser sprite to place
 * @param {number|string} mapId
 * @param {string}       team      — "team1" | "team2"
 * @param {number}       index     — 0-based index within the team
 * @param {number}       teamSize  — total players on that team
 */
export function positionSpawn(scene, sprite, mapId, team, index, teamSize) {
  const runtime = getDocumentRuntime(mapId, scene);
  if (runtime) spawnOnMapDocument(scene, sprite, runtime, team, index, teamSize);
}

/**
 * Return the populated Phaser objects array (for physics/collision setup).
 * Must be called after buildMap().
 * @param {number|string} mapId
 * @returns {object[]}
 */
export function getMapObjects(mapId, scene = null) {
  return getDocumentRuntime(mapId, scene)?.objects || [];
}

function getMapDocument(mapId, scene) {
  return getDocumentRuntime(mapId, scene)?.data || getDefaultMapDocument(normalizeMapId(mapId));
}

/**
 * Player + powerup spawn config for a map.
 * @param {number|string} mapId
 * @returns {object}
 */
export function getMapSpawnConfig(mapId, scene = null) {
  return getMapDocument(mapId, scene)?.spawns ?? { players: {}, powerups: [] };
}

/**
 * Runtime boundary/camera config for a map.
 * @param {number|string} mapId
 * @returns {object}
 */
export function getMapBoundaryConfig(mapId, scene = null) {
  return getMapDocument(mapId, scene)?.bounds ?? {};
}

/**
 * List of texture keys that can be used to add platforms in editor mode.
 * @param {number|string} mapId
 * @returns {string[]}
 */
export function getMapEditorTextureKeys(mapId, scene = null) {
  return Object.keys(getMapDocument(mapId, scene)?.assets || {});
}

/**
 * Runtime platform anchors for spawn snapping.
 * @param {number|string} mapId
 * @returns {object}
 */
export function getMapSpawnAnchors(mapId, scene = null) {
  return getDocumentRuntime(mapId, scene)?.anchors ?? {};
}

/**
 * Background image URL for the given map (used in battle-start overlay).
 * @param {number|string} mapId
 * @returns {string}
 */
export function getMapBgAsset(mapId, scene = null) {
  return getDocumentRuntime(mapId, scene)?.data?.background || MAP_META.get(Number(mapId))?.mapSelectPreviewAsset || "/assets/lushy/gameBg.webp";
}

/**
 * Map selection preview image URL for lobby map picker popup.
 * @param {number|string} mapId
 * @returns {string}
 */
export function getMapSelectPreviewAsset(mapId) {
  return (
    MAP_META.get(normalizeMapId(mapId))?.mapSelectPreviewAsset ||
    "/assets/lushy/gameBg.webp"
  );
}

/**
 * Lobby background image URL for the given map.
 * @param {number|string} mapId
 * @returns {string}
 */
export function getLobbyBgAsset(mapId) {
  return (
    MAP_META.get(normalizeMapId(mapId))?.lobbyBgAsset ||
    "/assets/lushy/lobbyBg.webp"
  );
}

/**
 * Lobby platform image URL for the given map.
 * @param {number|string} mapId
 * @returns {string}
 */
export function getLobbyPlatformAsset(mapId) {
  return (
    MAP_META.get(normalizeMapId(mapId))?.lobbyPlatformAsset ||
    "/assets/lushy/lobbyPlatform.webp"
  );
}

/**
 * Battle music asset URL for the given map.
 * Only the active map track should be instantiated at runtime.
 * @param {number|string} mapId
 * @returns {string}
 */
export function getMapMusicAsset(mapId) {
  const meta = MAP_META.get(normalizeMapId(mapId));
  return meta?.musicAsset || "/assets/main.mp3";
}

/**
 * Battle music gain for the given map. Kept in the shared map catalog so
 * unusually quiet tracks can be balanced without special-casing game code.
 * @param {number|string} mapId
 * @returns {number}
 */
export function getMapMusicVolume(mapId) {
  const configured = Number(MAP_META.get(normalizeMapId(mapId))?.musicVolume);
  return Number.isFinite(configured)
    ? Math.max(0, Math.min(1, configured))
    : 0.11;
}

