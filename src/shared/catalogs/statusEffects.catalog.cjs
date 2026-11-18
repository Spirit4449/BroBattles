const { deepFreeze } = require('../deepFreeze');

module.exports = deepFreeze({
  slow: { durationMs: 3000, modifiers: { speedMult: 0.45, jumpMult: 0.7 } },
  stun: { durationMs: 1200, modifiers: { speedMult: 0, jumpMult: 0 } },
  damageBoost: { durationMs: 5000, modifiers: { damageMult: 1.5 } },
});
