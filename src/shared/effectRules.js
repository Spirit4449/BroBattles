const { POWERUP_CATALOG } = require('./powerups');
const { getResolvedCharacterAttackConfig, getResolvedCharacterSpecialConfig } = require('./characterTuning');

const slime = getResolvedCharacterAttackConfig('gloop', 'slimeball');
const hook = getResolvedCharacterSpecialConfig('gloop', 'hook');
const thorg = getResolvedCharacterSpecialConfig('thorg');
const volley = getResolvedCharacterSpecialConfig('huntress', 'burningVolley');

// Pure rules shared by authoritative effects and client movement. Ability-owned
// values stay in the character definition; generic status effects live here.
const EFFECT_RULES = {
  ...POWERUP_CATALOG,
  thorgRage: { durationMs: thorg.rageDurationMs, modifiers: thorg.rageModifiers },
  huntressBurn: { durationMs: volley.burnDurationMs, totalDamage: volley.burnTotalDamage },
  gloopSlimeSlow: { durationMs: slime.slowDurationMs, modifiers: { speedMult: slime.slowSpeedMult, jumpMult: slime.slowJumpMult } },
  gloopHookSlow: { durationMs: hook.slowDurationMs, modifiers: { speedMult: hook.slowSpeedMult, jumpMult: hook.slowJumpMult } },
  slow: { durationMs: 3000, modifiers: { speedMult: 0.45, jumpMult: 0.7 } },
  stun: { durationMs: 1200, modifiers: { speedMult: 0, jumpMult: 0 } },
  damageBoost: { durationMs: 5000, modifiers: { damageMult: 1.5 } },
};
const PARAMETERIZED_SLOWS = new Set(['slow', 'gloopSlimeSlow', 'gloopHookSlow']);
const SCALED_POWERUPS = new Set(['rage', 'shield', 'gravityBoots']);

function getEffectModifiers(key, params = {}) {
  const modifiers = { ...EFFECT_RULES[key]?.modifiers };
  if (PARAMETERIZED_SLOWS.has(key)) {
    for (const field of ['speedMult', 'jumpMult']) {
      if (params[field] != null && Number.isFinite(Number(params[field]))) {
        modifiers[field] = Math.max(0, Number(params[field]));
      }
    }
  }
  if (SCALED_POWERUPS.has(key)) {
    const powerScale = Number(params.powerScale) > 0 && Number.isFinite(Number(params.powerScale)) ? Number(params.powerScale) : 1;
    for (const field of Object.keys(modifiers)) {
      modifiers[field] = Math.max(0, 1 + (modifiers[field] - 1) * powerScale);
    }
  }
  return modifiers;
}

function combineModifiers(modifiers) {
  const combined = { damageMult: 1, damageTakenMult: 1, speedMult: 1, jumpMult: 1 };
  for (const entry of modifiers) {
    for (const key of Object.keys(combined)) {
      if (Number.isFinite(entry?.[key])) combined[key] *= Math.max(0, entry[key]);
    }
  }
  return combined;
}

function resolveLocalEffectMovement(effects = {}, authoritative = null) {
  // Server-computed values include application-specific overrides (e.g. a
  // stronger slow or Wizard's scaled powerups). Older snapshots use base rules.
  const fallback = combineModifiers(Object.keys(effects).filter(key => effects[key] > 0).map(key => getEffectModifiers(key)));
  const result = {};
  for (const key of ['speedMult', 'jumpMult']) {
    result[key] = Number.isFinite(authoritative?.[key]) ? Math.max(0, authoritative[key]) : fallback[key];
  }
  return result;
}
module.exports = { EFFECT_RULES, getEffectModifiers, combineModifiers, resolveLocalEffectMovement };
