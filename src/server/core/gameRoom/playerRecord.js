const { DEFAULT_CHARACTER, resolveCharacterKey, computeMatchStats } = require('../../../shared/characters/characterStats');
const { participantId } = require('./participants');

function createParticipantRecord(room, matchPlayer, { socketId = null, userId, level, name, connected = true }) {
  const isBot = !!matchPlayer.isBot;
  const character = isBot ? matchPlayer.char_class || DEFAULT_CHARACTER : matchPlayer.char_class;
  const { maxHealth: normalHealth, baseDamage, specialDamage, specialChargeHits,
    ammoCapacity, ammoCooldownMs, ammoReloadMs } = computeMatchStats(character, level);
  const override = Number(matchPlayer.botHealthOverride);
  const maxHealth = isBot && Number.isFinite(override) && override > 0 ? Math.round(override) : normalHealth;
  const spawn = room.spawnStateFor(matchPlayer);
  const now = Date.now();
  const playerData = {
    socketId,
    participantId: isBot ? matchPlayer.participantId : participantId(matchPlayer),
    user_id: userId,
    name,
    team: matchPlayer.team,
    char_class: character,
    selected_skin_id: String(matchPlayer.selected_skin_id || "") || null,
    selected_skin_asset_url: String(matchPlayer.selected_skin_asset_url || "") || null,
    selected_skin_game_assets: matchPlayer.selected_skin_game_assets || null,
    ...(isBot ? { seed: matchPlayer.seed, difficulty: matchPlayer.difficulty, _botActionSeq: 0, _botActionUntil: 0 }
      : { selected_title_id: matchPlayer.selected_title_id || null }),
    profile_icon_id: String(matchPlayer.profile_icon_id || (isBot ? resolveCharacterKey(character) : character || DEFAULT_CHARACTER)),
    isBot,
    trophies: isBot ? matchPlayer.trophies : Number(matchPlayer.trophies) || 0,
    connected,
    loaded: isBot,
    ...spawn,
    vx: 0,
    vy: 0,
    grounded: isBot,
    maxHealth,
    health: maxHealth,
    superCharge: 0,
    maxSuperCharge: specialChargeHits,
    isAlive: true,
    lastInput: now,
    _lastPositionPacketAt: 0,
    level,
    baseDamage,
    specialDamage,
    lastCombatAt: now,
    lastAttackAt: 0,
    lastDamagedAt: 0,
    _regenCarry: 0,
    _lastHealthBroadcastAt: 0,
    effects: {},
    activeEffects: {},
    ammoState: {
      capacity: ammoCapacity,
      charges: ammoCapacity,
      cooldownMs: ammoCooldownMs,
      reloadMs: ammoReloadMs,
      reloadTimerMs: 0,
      nextFireInMs: 0,
    },
  };
  if (!isBot) playerData.flip = false;
  return playerData;
}

module.exports = { createParticipantRecord };
