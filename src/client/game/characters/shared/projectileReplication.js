import { TEAM_GREEN, TEAM_RED } from '../../../../shared/projectilePresentation';

// Pieces shared by the client halves of the predicted-projectile protocols
// (ninja, sparrow). Each character keeps its own flight model, prediction and
// art; these are the parts that must behave the same for all of them.

// Bootstrap colliders carry their motion. Advancing the moving ones to a shot's
// server time stops predicted flights where the server will.
export function movingColliderMotion(colliders = []) {
  return { movingColliders: colliders.filter(c => c.motion && c.base) };
}

// Player snapshots carry the server clock under their own field names.
export function observeSnapshotClock(clock, snapshot, now = performance.now()) {
  clock.observe({ epoch: snapshot.snapshotEpoch, sentMono: snapshot.sentMono, simMono: snapshot.tMono }, now);
}

// The sprite drawn for a player name: the local player, an opponent or a teammate.
export function displayedPlayer(context, name) {
  return name === context.localUsername ? context.localPlayer
    : context.opponentPlayersRef?.[name]?.opponent || context.teamPlayersRef?.[name]?.opponent;
}

// What a projectile takes its team colour from: the owner's sprite, or just
// the owner's team when no sprite is drawn for them.
export function ownerTeamLook(context, name, sprite = displayedPlayer(context, name)) {
  return sprite || { _bbTeamColor: context.opponentPlayersRef?.[name] ? TEAM_RED : TEAM_GREEN };
}

// Ammo as the server reported it, advanced by the time since it was true:
// cooldown counts down and reloads finish in between.
export function catchUpAmmo(ammoState, elapsedMs) {
  const ammo = { ...ammoState };
  ammo.nextFireInMs = Math.max(0, ammo.nextFireInMs - elapsedMs);
  if (ammo.charges < ammo.capacity) {
    const reload = ammo.reloadTimerMs + elapsedMs;
    ammo.charges = Math.min(ammo.capacity, ammo.charges + Math.floor(reload / ammo.reloadMs));
    ammo.reloadTimerMs = ammo.charges === ammo.capacity ? 0 : reload % ammo.reloadMs;
  }
  return ammo;
}

// Runs `update` every frame of `scene` and `shutdown` once when it ends.
// The returned function removes both, so a runtime moved to another scene
// stops drawing into the old one and is not reset when that one shuts down.
export function bindSceneUpdates(scene, update, shutdown) {
  scene.events.on('update', update);
  scene.events.once('shutdown', shutdown);
  return () => {
    scene.events.off('update', update);
    scene.events.off('shutdown', shutdown);
  };
}

// Publishes a protocol's live diagnostics for the browser console and net rigs.
export function exposeDiagnostics(name, read) {
  if (typeof window !== 'undefined') window[name] = read;
}
