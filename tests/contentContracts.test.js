const test = require('node:test');
const assert = require('node:assert/strict');
const { validateContent } = require('../scripts/validate-content.cjs');
const { characterDefinitions } = require('../src/shared/characters');
const { POWERUP_TYPES, POWERUP_CATALOG } = require('../src/shared/powerups');
const { resolveLocalEffectMovement } = require('../src/shared/effectRules');
const { effectDefs } = require('../src/server/core/gameRoom/effects/effectDefs');

test('registered content has valid assets, effects, map documents and attack references', () => {
  assert.deepEqual(validateContent(), []);
  assert.deepEqual(require('../src/shared/mapDocument').POWERUP_TYPES, POWERUP_TYPES);
  assert.deepEqual(require('../src/server/core/gameRoomConfig').POWERUP_TYPES, POWERUP_TYPES);
});

test('content validation rejects a missing action and wrong effect owner', () => {
  const characters = structuredClone(characterDefinitions);
  characters.ninja.basicAction = 'missing-action';
  characters.ninja.attacks['ninja-shuriken'].events = { onHitEffect: { type: 'missing-effect' } };
  const errors = validateContent({ characters });
  assert.ok(errors.some(error => error.includes('unknown basic action')));
  assert.ok(errors.some(error => error.includes('unknown effect')));
});

test('content validation detects colliding action IDs and unsupported attack runtimes', () => {
  const characters = structuredClone(characterDefinitions);
  characters.draven.attacks['ninja-shuriken'] = { character: 'draven', runtime: { kind: 'missing-runtime' } };
  const errors = validateContent({ characters });
  assert.ok(errors.some(error => error.includes('duplicate action registration')));
  assert.ok(errors.some(error => error.includes('unknown runtime missing-runtime')));
});

test('validation rejects invalid reload/body data and duplicate tuning or price sources', () => {
  const characters = structuredClone(characterDefinitions);
  const powerups = structuredClone(POWERUP_CATALOG);
  characters.thorg.stats.ammoReloadMs = 0;
  characters.draven.stats.body.widthShrink = characters.draven.frame.w;
  powerups.gravityBoots.localMovement = { jumpMult: 1.5 };
  const errors = validateContent({ characters, powerups, cosmetics: [{ id: 'skin', price: { gems: 10 } }] });
  for (const message of ['invalid ammoReloadMs', 'body must fit', 'localMovement tuning is obsolete', 'cosmetic price duplicates']) {
    assert.ok(errors.some(error => error.includes(message)), message);
  }
});

test('shared movement uses authoritative boost values and multiplicative slow stacking', () => {
  assert.deepEqual(resolveLocalEffectMovement({ rage: 100, gravityBoots: 100 }), { speedMult: 1.4375, jumpMult: 1.55 });
  assert.deepEqual(resolveLocalEffectMovement({ freeze: 100, gloopHookSlow: 100 }), { speedMult: 0.225, jumpMult: 0.3 });
  assert.deepEqual(resolveLocalEffectMovement({ stun: 100, rage: 100 }), { speedMult: 0, jumpMult: 0 });
  assert.deepEqual(resolveLocalEffectMovement({ freeze: 0, slow: 100 }), { speedMult: 0.45, jumpMult: 0.7 });
  assert.deepEqual(resolveLocalEffectMovement({}, { speedMult: 1.2, jumpMult: 1.3 }), { speedMult: 1.2, jumpMult: 1.3 });
  assert.deepEqual(resolveLocalEffectMovement({}, null), { speedMult: 1, jumpMult: 1 });
});

test('server Gravity Boots tuning and scaling remain unchanged', () => {
  assert.deepEqual(effectDefs.gravityBoots.getModifiers(), { jumpMult: 1.55, speedMult: 1.15 });
  assert.equal(effectDefs.gravityBoots.getModifiers({ powerScale: 2 }).jumpMult, 2.1);
  for (const key of POWERUP_TYPES) assert.equal(effectDefs[key].durationMs, POWERUP_CATALOG[key].durationMs);
});
