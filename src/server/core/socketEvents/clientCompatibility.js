const { NETWORK_WIRE_VERSION } = require("../../../shared/networkWire");

function isCompatibleClient(room, client) {
  return !room || (
    client?.networkWireVersion === NETWORK_WIRE_VERSION &&
    (!room.ninjaCombatVersion || client.ninjaCombatVersion === room.ninjaCombatVersion) &&
    (!room.sparrowCombatVersion || client.sparrowCombatVersion === room.sparrowCombatVersion)
  );
}

module.exports = { isCompatibleClient };
