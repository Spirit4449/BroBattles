function participantId(player) { return player?.participantId || (player?.user_id ? `user:${player.user_id}` : player?.socketId); }
function getParticipant(room, id) {
  if (!id) return null;
  return room.players.get(id) || Array.from(room.players.values()).find((p) => participantId(p) === id) || null;
}
module.exports = { participantId, getParticipant };
