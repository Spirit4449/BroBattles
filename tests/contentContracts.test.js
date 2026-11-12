const test = require('node:test');
const assert = require('node:assert/strict');
const { validateContent } = require('../scripts/dev/validate-content.cjs');
const { characterDefinitions } = require('../src/shared/characters');
const { POWERUP_TYPES, POWERUP_CATALOG } = require('../src/shared/powerups');
const { resolveLocalEffectMovement } = require('../src/shared/effectRules');

test('registered content has valid assets, effects, map documents and attack references', () => {
  assert.deepEqual(validateContent(), []);
  assert.deepEqual(require('../src/shared/maps/mapDocument').POWERUP_TYPES, POWERUP_TYPES);
  assert.deepEqual(require('../src/shared/combat/matchConfig.js').POWERUP_TYPES, POWERUP_TYPES);
});

test('content validation rejects a missing action and wrong effect owner', () => {
  const characters = structuredClone(characterDefinitions);
  characters.ninja.basicAction = 'missing-action';
  characters.ninja.attacks['ninja-shuriken'].events = { onHitEffect: { type: 'missing-effect' } };
  const errors = validateContent({ characters });
  assert.ok(errors.some(error => error.includes('unknown basic action')));
  assert.ok(errors.some(error => error.includes('unknown effect')));
});

test('content validation rejects rig points that are malformed or outside the frame', () => {
  const characters = structuredClone(characterDefinitions);
  characters.ozzy.rig.feet = [999, 140];
  characters.ozzy.rig.points.staffTip.attack[2] = ['x', 1];
  characters.ozzy.rig.points.orb = 'top';
  const errors = validateContent({ characters });
  assert.ok(errors.some(error => error.includes('ozzy: rig feet is outside')));
  assert.ok(errors.some(error => error.includes('staffTip.attack[2] must be [x, y]')));
  assert.ok(errors.some(error => error.includes('rig orb must be')));
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

test('local movement multiplies active effects, ignores expired timers and honors authoritative overrides', () => {
  const { EFFECT_RULES } = require('../src/shared/effectRules');
  for (const keys of [['rage', 'gravityBoots'], ['freeze', 'gloopHookSlow'], ['stun', 'rage']]) {
    const expected = { speedMult: 1, jumpMult: 1 };
    for (const key of keys) for (const field of Object.keys(expected)) {
      expected[field] *= EFFECT_RULES[key].modifiers[field] ?? 1;
    }
    assert.deepEqual(resolveLocalEffectMovement(Object.fromEntries(keys.map(key => [key, 100]))), expected, keys.join(','));
  }
  assert.deepEqual(resolveLocalEffectMovement({ freeze: 0, slow: 100 }), EFFECT_RULES.slow.modifiers);
  assert.deepEqual(resolveLocalEffectMovement({}, { speedMult: 1.2, jumpMult: 1.3 }), { speedMult: 1.2, jumpMult: 1.3 });
  assert.deepEqual(resolveLocalEffectMovement({}, null), { speedMult: 1, jumpMult: 1 });
});

test('every registered character declares how bots play it', () => {
  const { BOT_PROFILES } = require('../src/shared/combat/characterProfiles.js');
  const botProfiles = { ...BOT_PROFILES };
  delete botProfiles.gloop;
  assert.ok(validateContent({ botProfiles }).some(error => error.includes('gloop: missing bot profile')));
  for (const key of Object.keys(BOT_PROFILES)) assert.ok(characterDefinitions[key], `${key} bot profile has no character`);
});

test('character levels parse from rows without throwing on malformed data', () => {
  const { parseCharacterLevels, getCharacterLevel, canonicalCharacterKey } = require('../src/shared/characters/characterStats');
  assert.deepEqual(parseCharacterLevels('{"ozzy":3}'), { ozzy: 3 });
  assert.deepEqual(parseCharacterLevels({ ninja: 1 }), { ninja: 1 });
  assert.deepEqual(parseCharacterLevels('not json'), {});
  assert.deepEqual(parseCharacterLevels('7'), {});
  assert.equal(getCharacterLevel({ char_levels: '{"gloop":4}' }, 'gloop'), 4);
  assert.equal(getCharacterLevel(null, 'gloop'), 0);
  assert.equal(canonicalCharacterKey(' Hunteress '), 'sparrow');
});

test("character display names and legacy character keys resolve correctly", () => {
  const { getCharacterDisplayName, resolveCharacterKey } = require("../src/shared/characters/characterStats");
  assert.equal(getCharacterDisplayName("ozzy"), "Ozzy");
  assert.equal(getCharacterDisplayName("sparrow"), "Sparrow");
  assert.equal(getCharacterDisplayName("ninja"), "Ninja");
  assert.equal(getCharacterDisplayName("hunteress"), "Sparrow");
  assert.equal(resolveCharacterKey("hunteress"), "sparrow");
  assert.equal(resolveCharacterKey("huntress"), "sparrow");
  assert.equal(resolveCharacterKey("wizard"), "ozzy");
});
