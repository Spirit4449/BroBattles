const { participantId, getParticipant } = require("../../../shared/combat/runtime/participants");
function applyParticipantKnockback(room, player, impulse) {
  player._stompPendingUntil = 0;
  const speed = Math.hypot(Number(impulse.amountX) || 0, Number(impulse.amountY) || 0);
  if (speed > 0) player.knockbackSeq = (player.knockbackSeq || 0) + 1;
  player._movementImpulse = { speed, until: Date.now() + 1000 };
  if (player._movementBudget) {
    player._movementBudget.x += speed * 0.1;
    player._movementBudget.y += speed * 0.1;
  }
  if (player.isBot) require('../bots/physics').applyImpulse(player, impulse, room._botNow || Date.now());
  else if (player.socketId) room.io.to(player.socketId).emit('player:knockback', impulse);
}
module.exports = { participantId, getParticipant, applyParticipantKnockback };
