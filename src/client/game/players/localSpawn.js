import { positionSpawn } from "../maps/manifest";
import { finalizeLocalSpawnPresentation, applyAuthoritativeState } from "./localPlayer";
function stabilizeSpawnedSpriteOnMap(scene, sprite, objects) {
  if (!scene?.physics?.world || !sprite || !Array.isArray(objects)) return;
  try {
    sprite.body?.updateFromGameObject?.();
  } catch (_) {}
  try {
    sprite.setVelocity?.(0, 0);
    sprite.setAcceleration?.(0, 0);
  } catch (_) {}
  for (const mapObject of objects) {
    if (!mapObject) continue;
    try {
      scene.physics.world.collide(sprite, mapObject);
    } catch (_) {}
  }
}

export function placeLocalFighter(scene, player, { state, live, spawnIndex, mapId, team, mapObjects }) {
  // Before FIGHT the server's spawn is authoritative; in a live game only a
  // loaded (previously synced) position is.
  const hasAuthoritativeSpawn =
    state &&
    (!live || state.loaded === true) &&
    Number.isFinite(state.x) &&
    Number.isFinite(state.y) &&
    player?.body;

  // After sprite exists and body sized, fall back to the map's spawn slot
  // only when the server has not sent a position yet.
  try {
    if (hasAuthoritativeSpawn) {
      player.body.reset(
        state.x,
        state.y,
      );
    } else {
    
      const myIndex =
        typeof spawnIndex === "number" ? Math.max(0, spawnIndex) : 0;
      positionSpawn(
        scene,
        player,
        mapId,
        team,
        myIndex,
      );
    }
    stabilizeSpawnedSpriteOnMap(scene, player, mapObjects);
  } catch (_) {}

  // If server already has my live state (refresh/reconnect), apply it after spawn snap.
  try {
    if (state) {
      applyAuthoritativeState(state);
      const shouldRestorePosition =
        !hasAuthoritativeSpawn &&
        live &&
        state.connected !== false &&
        state.loaded === true;
      if (
        shouldRestorePosition &&
        state.isAlive !== false &&
        Number.isFinite(state.x) &&
        Number.isFinite(state.y) &&
        player?.body
      ) {
        player.body.reset(
          state.x,
          state.y,
        );
        stabilizeSpawnedSpriteOnMap(scene, player, mapObjects);
      }
    }
  } catch (_) {}

  try {
    finalizeLocalSpawnPresentation();
  } catch (_) {}
}
