const { participantId } = require('../participants');
const { deliveryOf, clampDeliveryRewind } = require('../../attackDelivery');

// Fields every live attack instance carries: which descriptor and runtime it
// came from, who fired it, its replication id and its view rewind, bounded by
// the runtime's delivery (src/shared/combat/attackDelivery.js).
function attackIdentity(playerData, actionData, descriptor, now, runtimeKind = descriptor?.runtime?.kind) {
  const kind = String(runtimeKind || "").toLowerCase();
  return {
    descriptorKey: String(actionData?.type || "").toLowerCase(),
    runtimeKind: kind,
    createdAt: now,
    attackerParticipantId: participantId(playerData),
    attackerName: playerData.name,
    attackType: String(descriptor?.attackType || "basic").toLowerCase(),
    instanceId: String(actionData?.id || `${playerData.name}:${now}`),
    viewRewindMs: clampDeliveryRewind(deliveryOf(kind), actionData?.viewRewindMs),
  };
}

module.exports = { attackIdentity };
