import { advanceAmmoClock } from "../../../../shared/combat/ammoClock.js";
import { TEAM_GREEN, TEAM_RED } from '../../../../shared/projectilePresentation';
import { advanceShownLead } from '../../../../shared/characters/sparrowReplication';

// Pieces shared by the client halves of the predicted-projectile protocols
// (ninja, sparrow). Each character keeps its own flight model, prediction and
// art; these are the parts that must behave the same for all of them.

// Bootstrap colliders carry their motion. Advancing the moving ones to a shot's
// server time stops predicted flights where the server will.
export function movingColliderMotion(colliders = []) {
  return { movingColliders: colliders.filter(c => c.motion && c.base) };
}

// The room's static terrain from the match bootstrap, which is exactly the
// server's collider list. Released shots that bounce on terrain (Gloop's
// slimeball) use it instead of having every release carry the whole map.
let roomStaticTerrain = null;
export function setRoomTerrain(colliders) {
  roomStaticTerrain = Array.isArray(colliders) && colliders.length
    ? colliders.filter(c => !c?.motion).map(({ left, right, top, bottom }) => ({ left, right, top, bottom })) : null;
}
export function roomTerrain() { return roomStaticTerrain; }

// The age to draw a released projectile at, from the server launch time in its
// release packet (`launchMono`, server simulation clock), so every client
// draws it where the server flies it rather than from when its packet
// arrived. It starts in the hand at age 0 and reaches server age at a bounded
// speed (advanceShownLead); an enemy's (`enemy`: it can damage this player) also gains the
// victim lead (CombatClock.enemyLeadMs). `state` is kept per projectile.
// Null when the packet or clock cannot place it (an older server, no clock
// yet): the caller then flies it from arrival as before.
export function releasedFlightAge(clock, state, launch, localNow, enemy = false) {
  const launchMono = Number(launch?.launchMono);
  if (!clock || !Number.isFinite(launchMono) || !clock.lastPacket || !Number.isFinite(clock.offset)) return null;
  const base = clock.now(localNow) - launchMono;
  const lead = enemy ? clock.enemyLeadMs(launch.viewRewindMs) : 0;
  return Math.max(0, base + advanceShownLead(state, lead, localNow, -Math.max(0, base)));
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
  advanceAmmoClock(ammo, elapsedMs);
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
