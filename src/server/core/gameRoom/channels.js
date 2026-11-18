const roomChannel = matchId => `game:${matchId}`;
const teamChannel = (matchId, team) => `${roomChannel(matchId)}:team:${team}`;

module.exports = { roomChannel, teamChannel };
