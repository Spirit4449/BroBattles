const { GameRoom } = require('../../src/server/core/gameRoom');

const { broadcast, broadcastTeam, sendTo } = GameRoom.prototype;
module.exports = { broadcast, broadcastTeam, sendTo };
