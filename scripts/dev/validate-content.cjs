const { combatCoverageErrors } = require("../../src/shared/combat/runtime/coverage");
const fs = require('node:fs');
const path = require('node:path');
const { characterDefinitions } = require('../../src/shared/characters');
const { rigErrors } = require('../../src/shared/characters/characterRig');
const { POWERUP_CATALOG } = require('../../src/shared/powerups');
const { effectDefs } = require('../../src/shared/combat/runtime/effects/effectDefs.js');
const { validateDocument } = require('../../src/shared/maps/mapDocument');
const mapDefaults = require('../../src/shared/maps').mapDefaults;
const { CLOUD_TYPES } = require('../../src/shared/maps/scenery');
const { ATTACK_RUNTIMES } = require('../../src/shared/combat/runtime/characterAttackRegistry.js');
const { BOT_PROFILES } = require('../../src/shared/combat/characterProfiles.js');
const skinsCatalog = require('../../src/shared/catalogs/skinsCatalog.json');
const cardsCatalog = require('../../src/shared/catalogs/playerCardsCatalog.json');
const { FIELDS: CARD_VERSION_FIELDS, playerCardAssetVersion } = require('../art/player-card-versions.cjs');
const iconsCatalog = require('../../src/shared/catalogs/profileIconsCatalog.json');
const titlesCatalog = require('../../src/shared/catalogs/titlesCatalog.json');
const { validateCatalog } = require('../../src/server/services/shop/shopCatalog');
const shopCatalog = require('../../src/shared/catalogs/shopCatalog.json');

const trophyCatalog = require('../../src/shared/catalogs/trophySystem.catalog.cjs');

function validateTrophyScoring(catalog) {
  const errors = [];
  const ranges = catalog?.modeTrophyRanges;
  if (!ranges?.default) errors.push('trophies: missing default mode range');
  for (const [mode, range] of Object.entries(ranges || {})) {
    if (!Number.isFinite(range?.min) || !Number.isFinite(range?.max) ||
        range.min < 1 || range.max < range.min) errors.push(`trophies: invalid range for ${mode}`);
  }

  const fractions = [
    ['drawRangeScale', catalog?.drawRangeScale, 0, 1],
    ['lossRangeScale', catalog?.lossRangeScale, 0.1, 1],
    ['lossPerformanceMitigation', catalog?.lossPerformanceMitigation, 0, 0.9],
    ...['damage', 'kills', 'hits'].map(stat => [
      `performanceWeights.${stat}`, catalog?.performanceWeights?.[stat], 0, Infinity,
    ]),
  ];
  for (const [field, value, min, max] of fractions) {
    if (!Number.isFinite(value) || value < min || value > max) errors.push(`trophies: invalid ${field}`);
  }
  return errors;
}

function validParticle(particle) {
  const { kind, chance, offset, size, duration } = particle;
  const range = v => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) && v[0] > 0 && v[1] >= v[0];
  return ['plus', 'trail', 'arrow'].includes(kind) && Number.isFinite(chance) && chance >= 0 && chance <= 1 &&
    Array.isArray(offset) && offset.length === 3 && offset.every(Number.isFinite) && offset[0] >= 0 && offset[1] <= offset[2] &&
    (range(size) || (kind !== 'arrow' && Number.isFinite(size) && size > 0)) && Number.isFinite(duration) && duration > 0;
}

function validateContent({ characters = characterDefinitions, powerups = POWERUP_CATALOG,
  cosmetics = [
    ...Object.values(skinsCatalog.characters).flatMap(entry => entry.skins),
    ...cardsCatalog.cards, ...iconsCatalog.icons,
  ], shop = shopCatalog, trophies = trophyCatalog, botProfiles = BOT_PROFILES } = {}) {
  const errors = [...combatCoverageErrors(characters), ...validateTrophyScoring(trophies)];
  const titleIds = new Set();
  for (const title of titlesCatalog.titles || []) {
    if (!/^[a-z0-9-]+$/.test(title.id) || titleIds.has(title.id)) errors.push(`Invalid or duplicate title ID: ${title.id}`);
    titleIds.add(title.id);
    if (!title.name || title.name.length > 28) errors.push(`${title.id}: invalid title name`);
    for (const color of [title.color, title.gleamColor]) {
      if (!/^#[0-9a-f]{6}$/i.test(color)) errors.push(`${title.id}: invalid title color`);
    }
    if (!Number.isSafeInteger(title.cost?.gems) || title.cost.gems < 50) errors.push(`${title.id}: titles require at least 50 gems`);
  }
  const publicDir = path.resolve(__dirname, '../../public');
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
    errors.push(...rigErrors(definition).map(error => `${key}: ${error}`));
    const body = definition.stats?.body;
    for (const field of ['widthShrink', 'heightShrink', 'offsetXFromHalf', 'offsetY']) {
      if (!Number.isFinite(body?.[field])) errors.push(`${key}: invalid body.${field}`);
    }
    if (body?.widthShrink >= definition.frame?.w || body?.heightShrink >= definition.frame?.h) errors.push(`${key}: body must fit within frame dimensions`);
    if (definition.stats?.free !== true && (!Number.isInteger(definition.stats?.unlockPrice) || definition.stats.unlockPrice <= 0)) errors.push(`${key}: invalid unlockPrice`);
    if (!(definition.frame?.w > 0) || !(definition.frame?.h > 0)) errors.push(`${key}: missing frame dimensions`);
    if (!Array.isArray(definition.duckFrame) || definition.duckFrame.length !== 2 || definition.duckFrame.some(n => !Number.isInteger(n) || n < 1)) errors.push(`${key}: invalid duck frame`);
    if (!actions[definition.basicAction] || actions[definition.basicAction].character !== key) errors.push(`${key}: unknown basic action ${definition.basicAction}`);
    if (!Object.hasOwn(botProfiles, key)) errors.push(`${key}: missing bot profile in src/shared/combat/characterProfiles.js`);
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
    const visual = definition.visual || {};
    if (visual.bubbleStrength != null && (!(visual.bubbleStrength > 0 && visual.bubbleStrength <= 1) || !Number.isFinite(visual.bubbleOrder))) errors.push(`${key}: invalid bubble style`);
    if (visual.tintPulse && (!Array.isArray(visual.tintPulse) || visual.tintPulse.length !== 2 ||
        !visual.tintPulse.every(color => Number.isInteger(color) && color >= 0 && color <= 0xffffff) || !(visual.tintSpeed > 0))) errors.push(`${key}: invalid tint pulse`);
    if ((visual.tintPulse || visual.particle) && !Number.isFinite(visual.priority)) errors.push(`${key}: missing visual priority`);
    if (visual.particle && !validParticle(visual.particle)) errors.push(`${key}: invalid particle style`);
    if ('localMovement' in definition) errors.push(`${key}: separate localMovement tuning is obsolete; use shared modifiers`);
    for (const field of ['touchVolume', 'tickVolume']) {
      if (field in definition && (!Number.isFinite(definition[field]) || definition[field] < 0 || definition[field] > 1)) errors.push(`${key}: invalid ${field}`);
    }
    for (const [field, value] of Object.entries(definition.modifiers || {})) {
      if (!['speedMult', 'jumpMult', 'damageMult', 'damageTakenMult'].includes(field) || !Number.isFinite(value) || value < 0) errors.push(`${key}: invalid modifier ${field}`);
    }
    for (const file of ['icon.webp', 'touch.mp3']) assetExists(`/assets/powerups/${definition.assetDir}/${file}`, key);
    if (definition.tickVolume != null) assetExists(`/assets/powerups/${definition.assetDir}/tick.mp3`, key);
  }
  for (const cosmetic of cosmetics) {
    if ('price' in cosmetic) errors.push(`${cosmetic.id}: cosmetic price duplicates shop offer pricing`);
    if (cosmetic.animationUrl) {
      if (!/^\/assets\/player-cards\/([a-z0-9-]+)\/\1-animated\.webm$/.test(cosmetic.animationUrl)) {
        errors.push(`${cosmetic.id}: invalid card animation URL`);
      } else assetExists(cosmetic.animationUrl, cosmetic.id);
      assetExists(cosmetic.assetUrl, cosmetic.id);
      if (cosmetic.animationAppleUrl) assetExists(cosmetic.animationAppleUrl, cosmetic.id);
      // A stale version would pin old bytes under an immutable cache header.
      for (const [urlField, versionField] of CARD_VERSION_FIELDS) {
        if (!cosmetic[urlField]) continue;
        let actual = null;
        try { actual = playerCardAssetVersion(cosmetic[urlField]); } catch (_) { /* Reported by assetExists. */ }
        if (actual && cosmetic[versionField] !== actual) errors.push(`${cosmetic.id}: ${versionField} is stale; run node scripts/art/player-card-versions.cjs`);
      }
    }
  }
  errors.push(...validateCatalog(shop).map(error => `shop: ${error}`));
  const registeredMaps = new Set(mapDefaults.map(document => `${document.id}.json`));
  for (const filename of fs.readdirSync(path.resolve(__dirname, '../../src/shared/maps'))) {
    if (/^\d+\.json$/.test(filename) && !registeredMaps.has(filename)) errors.push(`Unregistered shipped map: ${filename}`);
  }
  for (const document of mapDefaults) {
    errors.push(...validateDocument(document).map(error => `map ${document.id}: ${error}`));
  }
  for (const [type, url] of Object.entries(CLOUD_TYPES)) assetExists(url, `cloud ${type}`);
  return errors;
}

if (require.main === module) {
  const errors = [...validateContent(), ...require('../art/build-portraits.cjs').portraitErrors()];
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`Content valid: ${Object.keys(characterDefinitions).length} characters, ${Object.keys(POWERUP_CATALOG).length} powerups, ${mapDefaults.length} built-in maps.`);
}
module.exports = { validateContent };
