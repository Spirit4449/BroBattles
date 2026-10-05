function isUsableNumber(value) {
  return value !== null && value !== "" && Number.isFinite(Number(value));
}

/**
 * Merge the live room entry into the roster returned by /gamedata.
 *
 * A player who has not joined the socket room yet is represented in game:init
 * with null stats. Those nulls describe unavailable live state; they must not
 * replace the character stats already computed by /gamedata.
 */
export function mergeInitialRosterPlayer(rosterPlayer, livePlayer) {
  if (!livePlayer) return rosterPlayer;

  const stats = {
    ...(rosterPlayer?.stats && typeof rosterPlayer.stats === "object"
      ? rosterPlayer.stats
      : {}),
  };
  const liveStats =
    livePlayer?.stats && typeof livePlayer.stats === "object"
      ? livePlayer.stats
      : {};
  const hasLiveStats = ["health", "damage", "specialDamage"].some((key) =>
    isUsableNumber(liveStats[key]),
  );

  for (const key of ["health", "damage", "specialDamage"]) {
    if (isUsableNumber(liveStats[key])) stats[key] = Number(liveStats[key]);
  }
  if (!isUsableNumber(stats.health) && isUsableNumber(livePlayer.maxHealth)) {
    stats.health = Number(livePlayer.maxHealth);
  }
  if (!isUsableNumber(stats.damage) && isUsableNumber(livePlayer.baseDamage)) {
    stats.damage = Number(livePlayer.baseDamage);
  }
  if (
    !isUsableNumber(stats.specialDamage) &&
    isUsableNumber(livePlayer.specialDamage)
  ) {
    stats.specialDamage = Number(livePlayer.specialDamage);
  }

  // Older room payloads used level 1 as a placeholder for an unjoined player,
  // so only trust the live level when that same entry has usable live stats.
  const liveLevel = hasLiveStats && isUsableNumber(livePlayer.level)
    ? Math.max(1, Number(livePlayer.level))
    : null;

  return {
    ...rosterPlayer,
    ...livePlayer,
    stats,
    level: liveLevel ?? rosterPlayer?.level ?? 1,
    name: rosterPlayer.name,
    team: rosterPlayer.team,
    char_class: rosterPlayer.char_class,
    // The HTTP roster is the asset manifest used during Phaser preload.
    // Keep these fields stable if the room snapshot has an older selection.
    selected_skin_id:
      rosterPlayer.selected_skin_id ?? livePlayer.selected_skin_id ?? null,
    selected_skin_asset_url:
      rosterPlayer.selected_skin_asset_url ??
      livePlayer.selected_skin_asset_url ??
      null,
    selected_skin_game_assets:
      rosterPlayer.selected_skin_game_assets ??
      livePlayer.selected_skin_game_assets ??
      null,
  };
}
