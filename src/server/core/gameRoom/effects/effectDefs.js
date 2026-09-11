const { EFFECT_RULES, getEffectModifiers } = require('../../../../shared/effectRules');

const { applyParticipantKnockback } = require('../participants');
// src/server/core/gameRoom/effects/effectDefs.js
//
// Every status effect is defined here. To add a new effect:
//   1. Add an entry to effectDefs below.
//   2. Add shared tuning in effectRules or the powerup/character definition.
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

const { POWERUP_HEALTH_REGEN_PER_SEC, POWERUP_POISON_DPS, POWERUP_EFFECT_TICK_MS, POWERUP_AMBIENT_TICK_MS, POWERUP_SHOCKWAVE_RADIUS, POWERUP_SHOCKWAVE_FORCE_X, POWERUP_SHOCKWAVE_FORCE_Y, GAME_DURATION_MS, SD_RISE_SPEED, SD_RISE_FAST_PHASE_MS, SD_RISE_FAST_MULT, WORLD_BOUNDS } = require("../../gameRoomConfig");
const { reduceDuckDamage } = require("../../../../shared/ducking");

function getPowerScale(params = {}) {
  const scale = Number(params?.powerScale);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

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
    durationMs: EFFECT_RULES.rage.durationMs,
    tickIntervalMs: POWERUP_AMBIENT_TICK_MS,
    getModifiers(params = {}) { return getEffectModifiers('rage', params); },
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
    durationMs: EFFECT_RULES.shield.durationMs,
    tickIntervalMs: 0,
    getModifiers(params = {}) { return getEffectModifiers('shield', params); },
    onApply: null,
    onTick: null,
    snapshotKey: "shield",
  },

  respawnShield: {
    durationMs: 3000,
    tickIntervalMs: 0,
    modifiers: { damageTakenMult: 0 },
    onApply: null,
    onTick: null,
    snapshotKey: "respawnShield",
  },

  health: {
    durationMs: EFFECT_RULES.health.durationMs,
    tickIntervalMs: POWERUP_EFFECT_TICK_MS,
    modifiers: {},
    onApply(player, room) {
      const prev = player.health;
      player.health = player.maxHealth;
      if (player.health !== prev) {
        room._broadcastHealthUpdate(player, { cause: "heal" });
      }
    },
    onTick(player, room, now, params = {}) {
      if (_isInSuddenDeathWater(room, player, now)) return;
      const prev = player.health;
      const powerScale = getPowerScale(params);
      const inc =
        (POWERUP_HEALTH_REGEN_PER_SEC * powerScale * POWERUP_EFFECT_TICK_MS) /
        1000;
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
    durationMs: EFFECT_RULES.poison.durationMs,
    tickIntervalMs: POWERUP_EFFECT_TICK_MS,
    modifiers: {},
    onApply: null,
    onTick(player, room, now, params = {}) {
      const prev = player.health;
      const dmg =
        (POWERUP_POISON_DPS * getPowerScale(params) * POWERUP_EFFECT_TICK_MS) /
        1000;
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
    durationMs: EFFECT_RULES.gravityBoots.durationMs,
    tickIntervalMs: POWERUP_AMBIENT_TICK_MS,
    getModifiers(params = {}) { return getEffectModifiers('gravityBoots', params); },
    onApply: null,
    onTick(player, room) {
      room.io.to(`game:${room.matchId}`).emit("powerup:tick", {
        type: "gravityBoots",
        username: player.name,
      });
    },
    snapshotKey: "gravityBoots",
  },

  invisibility: {
    durationMs: EFFECT_RULES.invisibility.durationMs,
    tickIntervalMs: 0,
    modifiers: {},
    onApply: null,
    onTick: null,
    snapshotKey: "invisibility",
  },

  shockwave: {
    durationMs: EFFECT_RULES.shockwave.durationMs,
    tickIntervalMs: 0,
    modifiers: {},
    onApply(player, room) {
      if (!player || !room?.players) return;
      const sourceX = Number(player.x) || 0;
      const sourceY = Number(player.y) || 0;
      let centeredTargetIndex = 0;

      for (const target of room.players.values()) {
        if (
          !target ||
          target === player ||
          !target.isAlive ||
          target.connected === false ||
          target.loaded !== true ||
          (!target.socketId && !target.isBot)
        ) {
          continue;
        }

        const dx = (Number(target.x) || 0) - sourceX;
        const dy = (Number(target.y) || 0) - sourceY;
        const distance = Math.hypot(dx, dy);
        if (distance > POWERUP_SHOCKWAVE_RADIUS) continue;

        const safeDistance = Math.max(1, distance);
        const centeredDirection = centeredTargetIndex % 2 === 0 ? 1 : -1;
        const nx = distance < 1 ? centeredDirection : dx / safeDistance;
        const ny = distance < 1 ? -0.35 : dy / safeDistance;
        const falloff = 0.8 + 0.8 * (1 - distance / POWERUP_SHOCKWAVE_RADIUS);
        centeredTargetIndex += 1;

        applyParticipantKnockback(room, target, {
          source: player.name,
          cause: "shockwave",
          radial: true,
          amountX: Math.round(nx * POWERUP_SHOCKWAVE_FORCE_X * falloff),
          amountY: Math.round((Math.abs(ny) < 0.45 ? -0.45 : ny) * POWERUP_SHOCKWAVE_FORCE_Y * falloff),
        });
      }
    },
    onTick: null,
    snapshotKey: "shockwave",
  },

  freeze: {
    durationMs: EFFECT_RULES.freeze.durationMs,
    tickIntervalMs: POWERUP_AMBIENT_TICK_MS,
    getModifiers(params = {}) { return getEffectModifiers('freeze', params); },
    onApply: null,
    onTick(player, room) {
      room.io.to(`game:${room.matchId}`).emit("powerup:tick", {
        type: "freeze",
        username: player.name,
      });
    },
    snapshotKey: "freeze",
  },

  // ── Character ability effects ────────────────────────────────────────────────

  thorgRage: {
    durationMs: EFFECT_RULES.thorgRage.durationMs,
    tickIntervalMs: Math.max(700, POWERUP_AMBIENT_TICK_MS - 250),
    getModifiers(params = {}) { return getEffectModifiers('thorgRage', params); },
    onApply: null,
    onTick(player, room) {
      room.io.to(`game:${room.matchId}`).emit("powerup:tick", {
        type: "thorgRage",
        username: player.name,
      });
    },
    snapshotKey: "thorgRage",
  },

  huntressBurn: {
    durationMs: EFFECT_RULES.huntressBurn.durationMs,
    tickIntervalMs: 1000,
    modifiers: {},
    onApply: null,
    onTick(player, room, now, params = {}) {
      const totalDamage = Math.max(0, Number(params.totalDamage ?? EFFECT_RULES.huntressBurn.totalDamage));
      const durationMs = Math.max(1, Number(params.durationMs ?? EFFECT_RULES.huntressBurn.durationMs));
      const prev = Number(player.health || 0);
      const rawDamage = Math.max(1, Math.round((totalDamage * 1000) / durationMs));
      const duckBlocked = player.ducking === true;
      const dmg = Math.max(1, Math.round(reduceDuckDamage(player, rawDamage)));
      player.health = Math.max(0, prev - dmg);
      player.lastCombatAt = now;

      const sourceName = String(params.sourceName || "");
      const source = sourceName
        ? Array.from(room.players.values()).find(
            (entry) => entry?.name === sourceName,
          )
        : null;
      const applied = Math.max(0, prev - player.health);
      if (source && source !== player && applied > 0) {
        source.lastCombatAt = now;
        room._recordCombatStat?.(source, { damage: applied, hits: 1 });
      }

      if (player.health !== prev) {
        room._broadcastHealthUpdate(player, { cause: "burn", duckBlocked });
        room.io.to(`game:${room.matchId}`).emit("powerup:tick", {
          type: "huntressBurn",
          username: player.name,
        });
        if (player.health <= 0 && prev > 0) {
          if (source && source !== player) {
            room._recordCombatStat?.(source, { kills: 1 });
          }
          room._handlePlayerDeath(player, {
            cause: "burn",
            killedBy: sourceName || undefined,
            at: now,
          });
        }
      }
    },
    snapshotKey: "huntressBurn",
  },

  // ── Available for future powerups / abilities ────────────────────────────────
  // Grant via: effectManager.apply(player, "slow", now)

  slow: {
    durationMs: EFFECT_RULES.slow.durationMs,
    tickIntervalMs: 0,
    getModifiers(params = {}) { return getEffectModifiers('slow', params); },
    onApply: null,
    onTick: null,
    snapshotKey: "slow",
  },

  gloopSlimeSlow: {
    durationMs: EFFECT_RULES.gloopSlimeSlow.durationMs,
    tickIntervalMs: 0,
    getModifiers(params = {}) { return getEffectModifiers('gloopSlimeSlow', params); },
    onApply: null,
    onTick: null,
    snapshotKey: "gloopSlimeSlow",
  },

  gloopHookSlow: {
    durationMs: EFFECT_RULES.gloopHookSlow.durationMs,
    tickIntervalMs: 0,
    getModifiers(params = {}) { return getEffectModifiers('gloopHookSlow', params); },
    onApply: null,
    onTick: null,
    snapshotKey: "gloopHookSlow",
  },

  stun: {
    durationMs: EFFECT_RULES.stun.durationMs,
    tickIntervalMs: 0,
    getModifiers(params = {}) { return getEffectModifiers('stun', params); },
    onApply: null,
    onTick: null,
    snapshotKey: "stun",
  },

  damageBoost: {
    durationMs: EFFECT_RULES.damageBoost.durationMs,
    tickIntervalMs: 0,
    getModifiers(params = {}) { return getEffectModifiers('damageBoost', params); },
    onApply: null,
    onTick: null,
    snapshotKey: "damageBoost",
  },
};

module.exports = { effectDefs };
