const fs = require('node:fs');
const path = require('node:path');
const { characterDefinitions } = require('../src/shared/characters');
const { POWERUP_CATALOG } = require('../src/shared/powerups');
const { effectDefs } = require('../src/server/core/gameRoom/effects/effectDefs');
const { validateDocument } = require('../src/shared/mapDocument');
const mapDefaults = require('../src/shared/maps').mapDefaults;
const { ATTACK_RUNTIMES } = require('../src/server/core/gameRoom/characterAttackRegistry');
const skinsCatalog = require('../src/shared/skinsCatalog.json');
const cardsCatalog = require('../src/shared/playerCardsCatalog.json');
const iconsCatalog = require('../src/shared/profileIconsCatalog.json');
const { validateCatalog } = require('../src/server/helpers/shopCatalog');
const shopCatalog = require('../src/shared/shopCatalog.json');

function validateContent({ characters = characterDefinitions, powerups = POWERUP_CATALOG,
  cosmetics = [
    ...Object.values(skinsCatalog.characters).flatMap(entry => entry.skins),
    ...cardsCatalog.cards, ...iconsCatalog.icons,
  ], shop = shopCatalog } = {}) {
  const errors = [];
  const publicDir = path.resolve(__dirname, '../public');
  const assetExists = (url, owner) => {
    if (!fs.existsSync(path.join(publicDir, url))) errors.push(`${owner}: missing asset ${url}`);
  };
  const actions = Object.create(null);
  for (const definition of Object.values(characters)) {
    for (const [action, descriptor] of Object.entries(definition.attacks || {})) {
      if (Object.hasOwn(actions, action)) errors.push(`${action}: duplicate action registration`);
      actions[action] = descriptor;
    }
  }
  for (const [key, definition] of Object.entries(characters)) {
    if (definition.key !== key) errors.push(`${key}: definition key does not match registry`);
    if (!(definition.stats?.baseHealth > 0) || !(definition.stats?.ammoCapacity > 0)) errors.push(`${key}: invalid base stats`);
    for (const field of ['ammoReloadMs', 'ammoCooldownMs', 'spriteScale']) {
      if (!Number.isFinite(definition.stats?.[field]) || definition.stats[field] <= 0) errors.push(`${key}: invalid ${field}`);
    }
    const body = definition.stats?.body;
    for (const field of ['widthShrink', 'heightShrink', 'offsetXFromHalf', 'offsetY']) {
      if (!Number.isFinite(body?.[field])) errors.push(`${key}: invalid body.${field}`);
    }
    if (body?.widthShrink >= definition.frame?.w || body?.heightShrink >= definition.frame?.h) errors.push(`${key}: body must fit within frame dimensions`);
    if (definition.stats?.free !== true && (!Number.isInteger(definition.stats?.unlockPrice) || definition.stats.unlockPrice <= 0)) errors.push(`${key}: invalid unlockPrice`);
    if (!(definition.frame?.w > 0) || !(definition.frame?.h > 0)) errors.push(`${key}: missing frame dimensions`);
    if (!Array.isArray(definition.duckFrame) || definition.duckFrame.length !== 2 || definition.duckFrame.some(n => !Number.isInteger(n) || n < 1)) errors.push(`${key}: invalid duck frame`);
    if (!actions[definition.basicAction] || actions[definition.basicAction].character !== key) errors.push(`${key}: unknown basic action ${definition.basicAction}`);
    for (const file of ['body.webp', 'spritesheet.webp', 'animations.json']) assetExists(`/assets/${key}/${file}`, key);
    const atlasPath = path.join(publicDir, 'assets', key, 'animations.json');
    if (fs.existsSync(atlasPath)) {
      try {
        const atlas = JSON.parse(fs.readFileSync(atlasPath, 'utf8'));
        if (!atlas.frames || !Object.keys(atlas.frames).length) errors.push(`${key}: empty atlas`);
      } catch (error) {
        errors.push(`${key}: invalid atlas JSON (${error.message})`);
      }
    }
    for (const [action, descriptor] of Object.entries(definition.attacks || {})) {
      if (descriptor.character !== key) errors.push(`${action}: incorrect character owner`);
      if (descriptor.runtime && !Object.hasOwn(ATTACK_RUNTIMES, descriptor.runtime.kind)) errors.push(`${action}: unknown runtime ${descriptor.runtime.kind}`);
      const release = descriptor.actionFlow?.releaseActionType;
      if (release && !actions[release]) errors.push(`${action}: unknown release action ${release}`);
      const effect = descriptor.events?.onHitEffect?.type;
      if (effect && !effectDefs[effect]) errors.push(`${action}: unknown effect ${effect}`);
    }
  }
  for (const [key, definition] of Object.entries(powerups)) {
    if (!effectDefs[key]) errors.push(`${key}: missing server effect`);
    if (!(definition.durationMs > 0)) errors.push(`${key}: invalid duration`);
    if ('localMovement' in definition) errors.push(`${key}: separate localMovement tuning is obsolete; use shared modifiers`);
    for (const [field, value] of Object.entries(definition.modifiers || {})) {
      if (!['speedMult', 'jumpMult', 'damageMult', 'damageTakenMult'].includes(field) || !Number.isFinite(value) || value < 0) errors.push(`${key}: invalid modifier ${field}`);
    }
    for (const file of ['icon.webp', 'touch.mp3', 'tick.mp3']) assetExists(`/assets/powerups/${definition.assetDir}/${file}`, key);
  }
  for (const cosmetic of cosmetics) {
    if ('price' in cosmetic) errors.push(`${cosmetic.id}: cosmetic price duplicates shop offer pricing`);
  }
  errors.push(...validateCatalog(shop).map(error => `shop: ${error}`));
  for (const document of mapDefaults) {
    errors.push(...validateDocument(document).map(error => `map ${document.id}: ${error}`));
  }
  return errors;
}

if (require.main === module) {
  const errors = validateContent();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`Content valid: ${Object.keys(characterDefinitions).length} characters, ${Object.keys(POWERUP_CATALOG).length} powerups, ${mapDefaults.length} built-in maps.`);
}
module.exports = { validateContent };
