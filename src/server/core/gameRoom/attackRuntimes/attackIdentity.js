const { participantId } = require('../participants');
const { clampViewRewind } = require('../lagCompensation');

// Shots fly apart from their shooter, so they test lag-compensated targets.
// Attached melee keeps testing live positions.
const SHOT_RUNTIMES = new Set(['projectile-linear', 'projectile-bounce', 'returning-projectile', 'hook-projectile']);

// Fields every live attack instance carries: which descriptor and runtime it
// came from, who fired it, its replication id and its view rewind.
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
    viewRewindMs: SHOT_RUNTIMES.has(kind) ? clampViewRewind(actionData?.viewRewindMs) : 0,
  };
}

module.exports = { attackIdentity };
