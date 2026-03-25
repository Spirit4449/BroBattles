// src/server/core/gameRoom/effects/effectDefs.js
//
// Every status effect is defined here. To add a new effect:
//   1. Add an entry to effectDefs below.
//   2. (Optional) add a powerup type in gameRoomConfig.POWERUP_TYPES + POWERUP_DURATIONS_MS.
//   3. Call effectManager.apply(player, "yourEffect", now) wherever it should be granted.
//
// Effect shape:
// {
//   durationMs:      number   — default duration (can be overridden at apply time)
//   tickIntervalMs:  number   — ms between onTick calls (0 = no periodic tick)
//   modifiers: {               — multiplicative stat modifiers while active
//     damageMult?:      number — outgoing damage multiplier
//     damageTakenMult?: number — incoming damage multiplier (< 1 = less damage = shield)
//     speedMult?:       number — horizontal movement speed multiplier
//     jumpMult?:        number — jump power multiplier
//   }
//   onApply(player, room, now, params) — called once when effect is applied/refreshed
//   onTick(player, room, now)          — called every tickIntervalMs while active
//   snapshotKey: string               — key sent to the client in playerEffects snapshot
// }

const {
  POWERUP_RAGE_DAMAGE_MULT,
  POWERUP_SHIELD_DAMAGE_MULT,
  POWERUP_HEALTH_REGEN_PER_SEC,
  POWERUP_POISON_DPS,
  POWERUP_EFFECT_TICK_MS,
  POWERUP_AMBIENT_TICK_MS,
  POWERUP_DURATIONS_MS,
  GAME_DURATION_MS,
  SD_RISE_SPEED,
  SD_RISE_FAST_PHASE_MS,
  SD_RISE_FAST_MULT,
  WORLD_BOUNDS,
} = require("../../gameRoomConfig");

function _isInSuddenDeathWater(room, player, now) {
  if (!room._suddenDeathActive) return false;
  const elapsed = now - room._loopStartWallTime;
  const sdElapsed = Math.max(0, elapsed - GAME_DURATION_MS);
  const worldBottomY = Number(WORLD_BOUNDS.height) || 1000;
  const earlySec = Math.min(sdElapsed, SD_RISE_FAST_PHASE_MS) / 1000;
  const lateSec = Math.max(0, sdElapsed - SD_RISE_FAST_PHASE_MS) / 1000;
  const rise =
    earlySec * SD_RISE_SPEED * SD_RISE_FAST_MULT + lateSec * SD_RISE_SPEED;
  const poisonY = Math.max(0, worldBottomY - rise);
  return typeof player?.y === "number" && player.y >= poisonY;
}

const effectDefs = {
  // ── Powerup effects ─────────────────────────────────────────────────────────

  rage: {
    durationMs: POWERUP_DURATIONS_MS.rage || 10000,
    tickIntervalMs: POWERUP_AMBIENT_TICK_MS,
    modifiers: { damageMult: POWERUP_RAGE_DAMAGE_MULT },
    onApply: null,
    onTick(player, room) {
      room.io.to(`game:${room.matchId}`).emit("powerup:tick", {
        type: "rage",
        username: player.name,
      });
    },
    snapshotKey: "rage",
  },

  shield: {
    durationMs: POWERUP_DURATIONS_MS.shield || 10000,
    tickIntervalMs: 0,
    modifiers: { damageTakenMult: POWERUP_SHIELD_DAMAGE_MULT },
    onApply: null,
    onTick: null,
    snapshotKey: "shield",
  },

  health: {
    durationMs: POWERUP_DURATIONS_MS.health || 10000,
    tickIntervalMs: POWERUP_EFFECT_TICK_MS,
    modifiers: {},
    onApply(player, room) {
      const prev = player.health;
      player.health = player.maxHealth;
      if (player.health !== prev) {
        room._broadcastHealthUpdate(player, { cause: "heal" });
      }
    },
    onTick(player, room, now) {
      if (_isInSuddenDeathWater(room, player, now)) return;
      const prev = player.health;
      const inc =
        (POWERUP_HEALTH_REGEN_PER_SEC * POWERUP_EFFECT_TICK_MS) / 1000;
      player.health = Math.min(player.maxHealth, player.health + inc);
      if (player.health !== prev) {
        room._maybeBroadcastHealth(player, now, { cause: "heal" });
        room.io.to(`game:${room.matchId}`).emit("powerup:tick", {
          type: "health",
          username: player.name,
        });
      }
    },
    snapshotKey: "health",
  },

  poison: {
    durationMs: POWERUP_DURATIONS_MS.poison || 8000,
    tickIntervalMs: POWERUP_EFFECT_TICK_MS,
    modifiers: {},
    onApply: null,
    onTick(player, room, now) {
      const prev = player.health;
      const dmg = (POWERUP_POISON_DPS * POWERUP_EFFECT_TICK_MS) / 1000;
      player.health = Math.max(0, player.health - dmg);
      player.lastCombatAt = now;
      if (player.health !== prev) {
        room._broadcastHealthUpdate(player, { cause: "poison" });
        room.io.to(`game:${room.matchId}`).emit("powerup:tick", {
          type: "poison",
          username: player.name,
        });
        if (player.health <= 0) {
          room._handlePlayerDeath(player, { cause: "poison", at: now });
        }
      }
    },
    snapshotKey: "poison",
  },

  gravityBoots: {
    durationMs: POWERUP_DURATIONS_MS.gravityBoots || 7000,
    tickIntervalMs: POWERUP_AMBIENT_TICK_MS,
    modifiers: { jumpMult: 1.55, speedMult: 1.15 },
    onApply: null,
    onTick(player, room) {
      room.io.to(`game:${room.matchId}`).emit("powerup:tick", {
        type: "gravityBoots",
        username: player.name,
      });
    },
    snapshotKey: "gravityBoots",
  },

  // ── Character ability effects ────────────────────────────────────────────────

  thorgRage: {
    durationMs: 8000,
    tickIntervalMs: Math.max(700, POWERUP_AMBIENT_TICK_MS - 250),
    modifiers: { damageMult: 1.3 },
    onApply: null,
    onTick(player, room) {
      room.io.to(`game:${room.matchId}`).emit("powerup:tick", {
        type: "thorgRage",
        username: player.name,
      });
    },
    snapshotKey: "thorgRage",
  },

  // ── Available for future powerups / abilities ────────────────────────────────
  // Grant via: effectManager.apply(player, "slow", now)

  slow: {
    durationMs: 3000,
    tickIntervalMs: 0,
    modifiers: { speedMult: 0.45, jumpMult: 0.7 },
    onApply: null,
    onTick: null,
    snapshotKey: "slow",
  },

  stun: {
    durationMs: 1200,
    tickIntervalMs: 0,
    modifiers: { speedMult: 0, jumpMult: 0 },
    onApply: null,
    onTick: null,
    snapshotKey: "stun",
  },

  freeze: {
    durationMs: 2000,
    tickIntervalMs: 0,
    modifiers: { speedMult: 0, jumpMult: 0, damageMult: 0 },
    onApply: null,
    onTick: null,
    snapshotKey: "freeze",
  },

  damageBoost: {
    durationMs: 5000,
    tickIntervalMs: 0,
    modifiers: { damageMult: 1.5 },
    onApply: null,
    onTick: null,
    snapshotKey: "damageBoost",
  },
};

module.exports = { effectDefs };
