function processRegen(room) {
  const now = Date.now();
  for (const p of room.players.values()) {
    if (!p.isAlive || p.connected === false || p.loaded !== true) continue;
    if (typeof p.maxHealth !== "number" || typeof p.health !== "number") {
      continue;
    }

    const idleFor = now - (p.lastCombatAt || 0);
    if (idleFor < room.REGEN_DELAY_MS) continue;
    if (p.health >= p.maxHealth) continue;

    const nextAt = p._regenNextAt || 0;
    if (now < nextAt) continue;

    const missing = Math.max(0, p.maxHealth - p.health);
    const baseDesired = Math.max(
      room.REGEN_MIN_ABS,
      Math.ceil(missing * room.REGEN_MISSING_RATIO),
    );
    let inc = Math.ceil(baseDesired / 100) * 100;
    inc = Math.min(inc, missing);
    const old = p.health;
    p.health = Math.min(p.maxHealth, p.health + inc);
    p._regenNextAt = now + room.REGEN_TICK_MS;
    if (p.health !== old) {
      maybeBroadcastHealth(room, p, now, { cause: "heal" });
    }
  }
}

function broadcastHealthUpdate(room, playerData, meta = {}) {
  room.io.to(`game:${room.matchId}`).emit("health-update", {
    username: playerData.name,
    health: Math.max(0, Math.round(playerData.health)),
    maxHealth: Math.max(
      1,
      Math.round(playerData.maxHealth || playerData.health || 1),
    ),
    cause: meta.cause || null,
    gameId: room.matchId,
  });
  playerData._lastHealthBroadcastAt = Date.now();
}

function maybeBroadcastHealth(room, playerData, nowTs, meta = {}) {
  const last = Number(playerData._lastHealthBroadcastAt || 0);
  if (
    nowTs - last >= room.REGEN_BROADCAST_MIN_MS ||
    playerData.health === playerData.maxHealth
  ) {
    broadcastHealthUpdate(room, playerData, meta);
  }
}

function handleHeal(room, payload) {
  try {
    if (!payload || typeof payload !== "object") return;
    const sourceName = String(payload.source || payload.attacker || "").trim();
    const targetName = String(payload.target || "").trim();
    if (!targetName) return;

    const source = sourceName
      ? Array.from(room.players.values()).find((p) => p.name === sourceName)
      : null;
    const target = Array.from(room.players.values()).find(
      (p) => p.name === targetName,
    );
    if (!target || !target.isAlive) return;
    if (target.connected === false || target.loaded !== true) return;

    if (source && source.team && target.team && source.team !== target.team) {
      return;
    }

    let amount = 0;
    if (source) {
      const ref = Math.max(0, Number(source.baseDamage || 0));
      amount = Math.round(ref * 0.5);
    } else {
      amount = 200;
    }
    if (amount <= 0) return;

    const now = Date.now();
    const old = target.health;
    target.health = Math.min(target.maxHealth, target.health + amount);
    if (target.health !== old) {
      target.lastCombatAt = now;
      broadcastHealthUpdate(room, target, { cause: "heal" });
    }
  } catch (e) {
    console.warn(`[GameRoom ${room.matchId}] handleHeal error:`, e?.message);
  }
}

module.exports = {
  processRegen,
  broadcastHealthUpdate,
  maybeBroadcastHealth,
  handleHeal,
};
