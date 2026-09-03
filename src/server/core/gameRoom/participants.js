function participantId(player) { return player?.participantId || (player?.user_id ? `user:${player.user_id}` : player?.socketId); }
function getParticipant(room, id) {
  if (!id) return null;
  return room.players.get(id) || Array.from(room.players.values()).find((p) => participantId(p) === id) || null;
}
function applyParticipantKnockback(room, player, impulse) {
  if (player.isBot) require('../bots/physics').applyImpulse(player, impulse, room._botNow || Date.now());
  else if (player.socketId) room.io.to(player.socketId).emit('player:knockback', impulse);
}
module.exports = { participantId, getParticipant, applyParticipantKnockback };
