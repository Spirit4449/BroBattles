const { participantId } = require('../participants');

// Fields every live attack instance carries: which descriptor and runtime it
// came from, who fired it and its replication id.
function attackIdentity(playerData, actionData, descriptor, now, runtimeKind = descriptor?.runtime?.kind) {
  return {
    descriptorKey: String(actionData?.type || "").toLowerCase(),
    runtimeKind: String(runtimeKind || "").toLowerCase(),
    createdAt: now,
    attackerParticipantId: participantId(playerData),
    attackerName: playerData.name,
    attackType: String(descriptor?.attackType || "basic").toLowerCase(),
    instanceId: String(actionData?.id || `${playerData.name}:${now}`),
  };
}

module.exports = { attackIdentity };
