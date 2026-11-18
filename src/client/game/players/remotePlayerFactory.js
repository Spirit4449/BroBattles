import { getHealth, resolveCharacterKey } from "../../../shared/characters/characterStats.js";

export function createRemotePlayer(scene, { Player, roster, gameData, spawnVersion, getPlayerEffects }) {
  const rosterHealth = Number(roster.stats?.health);
  const maxHealth = Number.isFinite(rosterHealth) && rosterHealth > 0
    ? rosterHealth
    : getHealth(resolveCharacterKey(roster.char_class), roster.level || 1);
  const player = new Player({
    scene,
    getPlayerEffects,
    character: roster.char_class,
    skinId: roster.selected_skin_id,
    username: roster.name,
    team: roster.team === gameData.yourTeam ? "teammate" : roster.team,
    maxHealth,
  });
  player._spawnVersion = spawnVersion;
  player.isBot = roster.isBot === true;
  return player;
}

function isPosition(value) {
  return value != null && value !== "" && Number.isFinite(Number(value));
}

export function placeRemoteAtSpawn(scene, player, roster, { positionSpawn, mapId, spawnIndex }) {
  try {
    player.isBot = roster.isBot === true;
    positionSpawn(scene, player.opponent, mapId, roster.team, Math.max(0, spawnIndex || 0));
    if (isPosition(roster.x) && isPosition(roster.y)) {
      player.opponent.body?.reset?.(Number(roster.x), Number(roster.y));
    }
    player.finalizeSpawnPresentation?.();
    player.updateUIPosition?.();
  } catch (_) {}
}

export function applyRemoteRosterState(player, roster) {
  if (Number.isFinite(roster.stats?.health) && roster.stats.health > 0) {
    player.opMaxHealth = roster.stats.health;
    player.opCurrentHealth = roster.stats.health;
  }
  if (typeof roster.superCharge === "number") player.opSuperCharge = roster.superCharge;
  if (typeof roster.maxSuperCharge === "number") player.opMaxSuperCharge = roster.maxSuperCharge;
  player.updateHealthBar?.();
  player.setPresenceState?.(roster.connected !== false, roster.loaded === true);
}

export function destroyRemote(entry) {
  if (typeof entry?.destroy === "function") entry.destroy();
  else entry?.opponent?.destroy?.();
}
