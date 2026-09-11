// Versioned, data-only map contract. Shared by the editor, Phaser and the server.
const { resolveLanding } = require('./spawnPlacement');
const VARIANTS = ['1v1', '2v2', '3v3'];
const { POWERUP_TYPES } = require('./powerups');
const clone = value => JSON.parse(JSON.stringify(value));
function variantKey(value) {
  const match = String(value || '').match(/([123])v[123]$/);
  return match ? `${match[1]}v${match[1]}` : `${Math.max(1, Math.min(3, Number(value) || 1))}v${Math.max(1, Math.min(3, Number(value) || 1))}`;
}
function geometryFromMap(data, mapId = null) {
  const platforms = data.layout.platforms.map((p, i) => {
    const size = data.textureSizes[p.textureKey];
    const sx = Math.abs(p.scaleX || 1), sy = Math.abs(p.scaleY || 1);
    const left = p.x - size.width * sx / 2 + (p.body?.offsetX || 0) * sx;
    const top = p.y - size.height * sy / 2 + (p.body?.offsetY || 0) * sy;
    return { id: p.id || `p${i}`, x: p.x, y: p.y, left, top,
      right: left + (p.body?.width || size.width * sx), bottom: top + (p.body?.height || size.height * sy),
      enabled: p.collisionEnabled !== false,
      collision: { up: true, down: true, left: true, right: true, ...p.collision } };
  });
  const hitboxes = data.layout.hitboxes.map((p, i) => ({ id: p.id || `h${i}`, x: p.x, y: p.y,
    left: p.x - p.width / 2, right: p.x + p.width / 2, top: p.y - p.height / 2,
    bottom: p.y + p.height / 2, enabled: p.collisionEnabled !== false,
    collision: { up: true, down: true, left: true, right: true, ...p.collision } }));
  const all = [...platforms, ...hitboxes];
  const anchors = Object.fromEntries(all.map(p => [p.id, p]));
  for (const [name, ref] of Object.entries(data.anchors || {})) {
    anchors[name] = ref.objectId ? anchors[ref.objectId] : (ref.kind === 'platform' ? platforms : hitboxes)[ref.index];
  }
  return { mapId, world: data.bounds.world, spawns: data.spawns, anchors, colliders: all.filter(p => p.enabled), settings: data.powerups };
}
function constrainPoint(data, point, x, y, body = { width: 64, height: 96 }) {
  const geometry = geometryFromMap(data);
  const landing = resolveLanding({ x, y }, null, geometry.colliders, body);
  return { ...point, anchorId: landing.surface.id, dx: landing.x - (landing.surface.left + landing.surface.right) / 2,
    x: undefined, y: undefined };
}
function resolvePowerupPoints(geometry) {
  return (geometry?.spawns?.powerups || []).filter(p => p.enabled !== false).map(p => {
    if (!p.anchorId) return { ...p, freePosition: true };
    const anchor = geometry.anchors[p.anchorId];
    const landing = resolveLanding(p, anchor, geometry.colliders, { width: 32, height: 40 });
    return { ...p, x: landing.x, y: landing.y };
  });
}
function validateMapUnsafe(data) {
  const errors = [];
  const fail = (path, message) => errors.push(`${path}: ${message}`);
  const num = (v, path, min = -100000, max = 100000) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(path, `must be a finite number between ${min} and ${max}`);
  };
  const ids = new Set();
  function id(v, path) { if (typeof v !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(v) || ids.has(v)) fail(path, 'requires a unique stable ID'); ids.add(v); }
  if (!data || typeof data !== 'object') return ['map: must be an object'];
  for (const k of ['world', 'camera']) {
    const b = data.bounds?.[k];
    for (const field of ['x', 'y', 'width', 'height']) num(b?.[field], `bounds.${k}.${field}`, /width|height/.test(field) ? 1 : -100000);
  }
  for (const k of ['zoom', 'deadzoneWidth', 'deadzoneHeight', 'followOffsetY']) if (data.bounds?.camera?.[k] !== undefined) num(data.bounds.camera[k], `bounds.camera.${k}`, k === 'zoom' ? 0.05 : k === 'followOffsetY' ? -100000 : 0, k === 'zoom' ? 8 : 100000);
  for (const kind of ['platforms', 'hitboxes']) {
    const rows = data.layout?.[kind];
    if (!Array.isArray(rows) || rows.length > 1000) { fail(`layout.${kind}`, 'requires an array of at most 1000 objects'); continue; }
    rows.forEach((p, i) => {
      const path = `layout.${kind}[${i}]`;
      id(p?.id, `${path}.id`); num(p?.x, `${path}.x`); num(p?.y, `${path}.y`);
      if (kind === 'platforms') {
        const size = data.textureSizes?.[p.textureKey];
        if (!size) fail(`${path}.textureKey`, 'missing frame dimensions in textureSizes');
        else { num(size.width, `textureSizes.${p.textureKey}.width`, 1, 16384); num(size.height, `textureSizes.${p.textureKey}.height`, 1, 16384); }
        num(p.scaleX, `${path}.scaleX`, 0.01, 100); num(p.scaleY, `${path}.scaleY`, 0.01, 100);
        for (const k of ['width', 'height', 'offsetX', 'offsetY']) if (p.body?.[k] !== undefined) num(p.body[k], `${path}.body.${k}`, /width|height/.test(k) ? 1 : -100000);
      } else { num(p.width, `${path}.width`, 1); num(p.height, `${path}.height`, 1); }
      for (const v of Object.values(p.collision || {})) if (typeof v !== 'boolean') fail(`${path}.collision`, 'sides must be booleans');
    });
  }
  for (const [key, a] of Object.entries(data.assets || {})) {
    if (!['image', 'spritesheet', 'atlas'].includes(a.type)) fail(`assets.${key}.type`, 'use image, spritesheet or atlas');
    for (const field of a.type === 'atlas' ? ['url', 'atlasURL'] : ['url']) if (typeof a[field] !== 'string' || !/^\/assets\/[a-zA-Z0-9_./-]+$/.test(a[field]) || a[field].includes('..')) fail(`assets.${key}.${field}`, 'requires a local /assets/ URL');
    if (a.type === 'spritesheet') for (const k of ['frameWidth', 'frameHeight']) num(a.frameConfig?.[k], `assets.${key}.frameConfig.${k}`, 1, 16384);
    if (a.animation) {
      num(a.animation.frameRate, `assets.${key}.animation.frameRate`, 1, 120);
      if (!Array.isArray(a.animation.frames) || !a.animation.frames.length || a.animation.frames.some(f => !['string','number'].includes(typeof f))) fail(`assets.${key}.animation.frames`, 'requires explicit frame names or numbers');
      num(a.animation.repeat, `assets.${key}.animation.repeat`, -1, 1000);
    }
  }
  for (const p of data.layout?.platforms || []) if (!data.assets?.[p.textureKey]) fail(`platform.${p.id}.textureKey`, 'asset is not registered');
  if (data.powerups) {
    for (const [key, min, max] of [['spawnIntervalMs',500,3600000],['maxActive',0,100],['despawnMs',500,3600000],['pickupRadius',1,500],['omenMs',0,60000],['spawnLift',0,500]]) num(data.powerups[key], `powerups.${key}`, min, max);
    if (!Array.isArray(data.powerups.types) || !data.powerups.types.length || data.powerups.types.some(t => !POWERUP_TYPES.includes(t))) fail('powerups.types', 'select known powerup types');
  }
  if (errors.length) return errors;
  if (typeof data.background !== 'string' || !/^\/assets\/[a-zA-Z0-9_./-]+$/.test(data.background) || data.background.includes('..')) fail('background', 'requires a local /assets/ URL');
  for (const p of [...data.layout.platforms,...data.layout.hitboxes]) {
    if(p.collisionEnabled !== undefined && typeof p.collisionEnabled !== 'boolean') fail(p.id, 'collisionEnabled must be boolean');
    if(p.alpha !== undefined) num(p.alpha, `${p.id}.alpha`,0,1);
    if(p.depth !== undefined) num(p.depth, `${p.id}.depth`);
    if(p.frame !== undefined && !['string','number'].includes(typeof p.frame)) fail(p.id,'invalid frame');
  }
  const geometry = geometryFromMap(data);
  const validatePoint = (p, path, body) => {
    if (!p || !geometry.anchors[p.anchorId]) { fail(path, 'must reference an existing platform or hitbox'); return; }
    if (p.dx !== undefined) num(p.dx, `${path}.dx`);
    if (p.x !== undefined) num(p.x, `${path}.x`);
    if (p.dropHeight !== undefined) num(p.dropHeight, `${path}.dropHeight`, 0, 320);
    try {
      const landing = resolveLanding(p, geometry.anchors[p.anchorId], geometry.colliders, body);
      if (landing.surface !== geometry.anchors[p.anchorId]) fail(path, 'anchor has no clear walkable landing space');
    } catch (e) { fail(path, e.message); }
  };
  for (const team of ['team1', 'team2']) for (const size of [1, 2, 3]) {
    const points = data.spawns?.players?.[team]?.[size];
    if (!Array.isArray(points) || points.length !== size) fail(`spawns.players.${team}.${size}`, `requires ${size} slots`);
    else points.forEach((p,i) => validatePoint(p, `spawns.players.${team}.${size}[${i}]`, { width: 64, height: 96 }));
  }
  if (!Array.isArray(data.spawns?.powerups) || data.spawns.powerups.length > 200) fail('spawns.powerups', 'requires an array of at most 200 points');
  else data.spawns.powerups.forEach((p,i) => { id(p.id, `spawns.powerups[${i}].id`); if(p.anchorId) validatePoint(p, `spawns.powerups[${i}]`, { width: 32, height: 40 }); else {num(p.x, `spawns.powerups[${i}].x`);num(p.y, `spawns.powerups[${i}].y`);} if (p.type && !POWERUP_TYPES.includes(p.type)) fail(`spawns.powerups[${i}].type`, 'unknown powerup'); });
  const bank = data.objectiveLayout?.bankBust;
  if (bank) {
    for (const team of ['team1','team2']) for (const key of ['vaults','respawnPoints']) {
      const p = bank[key]?.[team]; num(p?.x, `objectiveLayout.bankBust.${key}.${team}.x`); num(p?.y, `objectiveLayout.bankBust.${key}.${team}.y`);
    }
    for (const key of ['objects','randomGoldSpawnPoints']) {
      if (!Array.isArray(bank[key])) { fail(`objectiveLayout.bankBust.${key}`, 'requires an array'); continue; }
      for (const p of bank[key]) {
        id(p.id, `objectiveLayout.bankBust.${key}.id`); num(p.x, `${p.id}.x`); num(p.y, `${p.id}.y`);
        if (key === 'objects' && !['goldMine','claimableTurret','wallSlot'].includes(p.type)) fail(`${p.id}.type`, 'unsupported objective');
        for (const [k,v] of Object.entries(p)) if (typeof v === 'number') num(v, `${p.id}.${k}`, ['x','y'].includes(k) ? -100000 : 0, 3600000);
      }
    }
  }
  return errors;
}
function validateMap(data) {
  try { return validateMapUnsafe(data); } catch (_) { return ['map: malformed layout, spawn, objective or asset structure']; }
}
function validateDocument(doc) {
  if (!doc || doc.schemaVersion !== 1 || !Number.isInteger(doc.id) || doc.id < 1 || typeof doc.label !== 'string' || !doc.label.trim()) return ['document: requires schemaVersion 1, positive integer id, and label'];
  const meta = doc.metadata;
  if (!meta || meta.id !== doc.id || !Array.isArray(meta.compatibleModeIds) || !meta.compatibleModeIds.length || !Array.isArray(meta.compatibleVariantIds)) return ['metadata: requires matching id and game mode compatibility arrays'];
  if (typeof meta.musicVolume !== 'number' || !Number.isFinite(meta.musicVolume) || meta.musicVolume < 0 || meta.musicVolume > 1) return ['metadata.musicVolume: must be between 0 and 1'];
  return VARIANTS.flatMap(key => validateMap(doc.variants?.[key]).map(e => `${key}.${e}`));
}
class MapHistory {
  constructor(value, limit = 250) { this.limit = limit; this.stack = [clone(value)]; this.index = 0; }
  commit(value) { if (JSON.stringify(value) === JSON.stringify(this.stack[this.index])) return false; this.stack.splice(this.index + 1); this.stack.push(clone(value)); if (this.stack.length > this.limit) this.stack.shift(); this.index = this.stack.length - 1; return true; }
  undo() { if (this.index > 0) this.index--; return clone(this.stack[this.index]); }
  redo() { if (this.index < this.stack.length - 1) this.index++; return clone(this.stack[this.index]); }
}
module.exports = { VARIANTS, POWERUP_TYPES, clone, variantKey, geometryFromMap, constrainPoint, resolvePowerupPoints, validateMap, validateDocument, MapHistory };
