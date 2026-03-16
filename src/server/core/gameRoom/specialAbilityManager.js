const {
  POWERUP_AMBIENT_TICK_MS,
  THORG_RAGE_DURATION_MS,
  DRAVEN_INFERNO_DURATION_MS,
} = require("../gameRoomConfig");

function handleSpecialRequest(room, socketId) {
  const p = room.players.get(socketId);
  if (!p || !p.isAlive) return;

  if (p.superCharge < p.maxSuperCharge) return;

  p.superCharge = 0;
  const now = Date.now();
  p.lastCombatAt = now;

  if (p.char_class === "thorg") {
    p.effects = p.effects || {};
    p.effects.thorgRageUntil = Math.max(
      p.effects.thorgRageUntil || 0,
      now + THORG_RAGE_DURATION_MS,
    );
    p.effects.thorgRageNextTickAt = now + POWERUP_AMBIENT_TICK_MS;
  } else if (p.char_class === "draven") {
    p.effects = p.effects || {};
    p.effects.dravenInfernoUntil = now + DRAVEN_INFERNO_DURATION_MS;
    p.effects.dravenInfernoStartedAt = now;
    p.effects.dravenInfernoAnchorX = Number.isFinite(p.x) ? p.x : 0;
    p.effects.dravenInfernoAnchorY = Number.isFinite(p.y) ? p.y : 0;
    p.effects.dravenInfernoNextDamageAt = now + 80;
  }

  room.io.to(`game:${room.matchId}`).emit("super-update", {
    username: p.name,
    charge: 0,
    maxCharge: p.maxSuperCharge,
  });

  room.io.to(`game:${room.matchId}`).emit("player:special", {
    username: p.name,
    character: p.char_class,
    origin: { x: p.x, y: p.y },
    flip: !!p.flip,
  });
}

module.exports = {
  handleSpecialRequest,
};
