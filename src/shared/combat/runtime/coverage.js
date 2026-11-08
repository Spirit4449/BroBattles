const { characterDefinitions } = require('../../characters');
const { getResolvedAttackDescriptor } = require('./attackDescriptorResolver');
const { ATTACK_RUNTIMES } = require('./characterAttackRegistry');
const { hasProtocol } = require('./characterCombatRegistry');
const { hasAbility } = require('./abilityRuntimeManager');

// Fails content validation when a character has art/catalog data but no real
// combat implementation. A presentation fallback is not combat coverage.
function combatCoverageErrors(definitions = characterDefinitions) {
  const errors = [];
  for (const [key, definition] of Object.entries(definitions)) {
    if (hasProtocol(key)) continue;
    const descriptor = getResolvedAttackDescriptor(definition.basicAction);
    const release = getResolvedAttackDescriptor(descriptor?.actionFlow?.releaseActionType) || descriptor;
    if (!ATTACK_RUNTIMES[release?.runtime?.kind]) errors.push(`${key}: missing basic combat runtime`);
    if (!hasAbility(key)) errors.push(`${key}: missing special combat runtime`);
  }
  return errors;
}
module.exports = { combatCoverageErrors };
