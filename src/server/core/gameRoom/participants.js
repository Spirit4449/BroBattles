const { participantId, getParticipant } = require("../../../shared/combat/runtime/participants");
const { isGhost } = require("../../../shared/combat/targetable.js");
function applyParticipantKnockback(room, player, impulse) {
  player._stompPendingUntil = 0;
  const speed = Math.hypot(Number(impulse.amountX) || 0, Number(impulse.amountY) || 0);
  if (speed > 0) player.knockbackSeq = (player.knockbackSeq || 0) + 1;
  player._movementImpulse = { speed, until: Date.now() + 1000 };
  if (player._movementBudget) {
    player._movementBudget.x += speed * 0.1;
    player._movementBudget.y += speed * 0.1;
  }
  // The server moves bots, ghosts and silent humans (inputManager.stepIdleHumans);
  // a human client applies its own knockback.
  if (player.isBot || isGhost(player) || player._idleFallback) {
    require('../bots/physics').applyImpulse(player, impulse, room._botNow || Date.now());
  }
  if (!player.isBot && player.socketId) room.io.to(player.socketId).emit('player:knockback', impulse);
}
module.exports = { participantId, getParticipant, applyParticipantKnockback };
