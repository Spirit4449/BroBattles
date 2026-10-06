// A map's `scenery`: parallax art layers (at least one), drifting clouds and
// optional atmosphere (fog, mist, glows, light rays, dust, platform lighting,
// vignette). Presentation only. The server validates and pins it but never
// simulates it.
//
// Layer and atmosphere positions are offsets in world units from the camera
// bounds centre. `scroll` is the parallax factor: 0 is fixed to the screen,
// 1 moves with the arena, above 1 is foreground that moves faster.
// Clouds are placed in world coordinates, like platforms.
// Atmosphere and clouds stack with `after`: a layer ID, or ARENA_DEPTH for
// over the platforms but under the fighters. `front: true` is over the fighters.
const CLOUD_TYPES = require('./clouds.json');

const COLOR = /^#[0-9a-fA-F]{6}$/;
const URL = /^\/assets\/[a-zA-Z0-9_./-]+$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const ARENA_DEPTH = 'arena';
const FITS = ['cover', 'cover-x', 'none'];
const LAYER_STACKS = ['back', 'arena', 'front'];

const CLOUD_DIRECTIONS = ['left', 'right'];
const RANDOM_CLOUD = 'random';

// `id` registers map-wide unique object IDs (clouds share them with platforms).
function validateScenery(scenery, fail, num, id) {
  if (!scenery || typeof scenery !== 'object') return fail('scenery', 'requires at least one layer');
  const color = (v, path) => { if (v !== undefined && (typeof v !== 'string' || !COLOR.test(v))) fail(path, 'must be a #rrggbb colour'); };
  const range = (v, path, min, max) => {
    if (!Array.isArray(v) || v.length !== 2) return fail(path, 'requires [min, max]');
    num(v[0], `${path}[0]`, min, max); num(v[1], `${path}[1]`, min, max);
    if (v[0] > v[1]) fail(path, 'min must not exceed max');
  };
  const opt = (v, path, min, max) => { if (v !== undefined) num(v, path, min, max); };
  const url = (v, path) => { if (typeof v !== 'string' || !URL.test(v) || v.includes('..')) fail(path, 'requires a local /assets/ URL'); };
  const list = (v, path, max) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > max) { fail(path, `requires an array of at most ${max} entries`); return []; }
    return v;
  };

  const layerIds = new Set();
  const layers = list(scenery.layers, 'scenery.layers', 16);
  if (!layers.length) fail('scenery.layers', 'requires at least one layer');
  layers.forEach((layer, i) => {
    const path = `scenery.layers[${i}]`;
    if (typeof layer?.id !== 'string' || !ID.test(layer.id) || layerIds.has(layer.id)) fail(`${path}.id`, 'requires a unique stable ID');
    layerIds.add(layer?.id);
    url(layer?.url, `${path}.url`);
    num(layer?.scroll, `${path}.scroll`, 0, 3);
    if (layer?.fit !== undefined && !FITS.includes(layer.fit)) fail(`${path}.fit`, `use ${FITS.join(', ')}`);
    if (layer?.filter !== undefined && !['linear', 'nearest'].includes(layer.filter)) fail(`${path}.filter`, 'use linear or nearest');
    opt(layer?.scale, `${path}.scale`, 0.01, 50);
    opt(layer?.x, `${path}.x`); opt(layer?.y, `${path}.y`);
    opt(layer?.alpha, `${path}.alpha`, 0, 1);
    opt(layer?.fog, `${path}.fog`, 0, 1);
    // Blur is baked into the image by the art importer, not applied in game.
    opt(layer?.blur, `${path}.blur`, 0, 16);
    color(layer?.tint, `${path}.tint`);
    // stack: back (behind the platforms; the default up to scroll 1), arena
    // (over platforms, clouds and arena haze; under fighters) or front (over
    // fighters; the default above scroll 1).
    if (layer?.stack !== undefined && !LAYER_STACKS.includes(layer.stack)) fail(`${path}.stack`, `use ${LAYER_STACKS.join(', ')}`);
    // Optional design frame: the full canvas the art was exported from and this
    // image's top-left inside it (image px). Layers that share a frame keep its
    // composition: the frame is fitted, and the image sits where it was drawn.
    if (layer?.frame !== undefined) {
      const f = layer.frame;
      num(f?.width, `${path}.frame.width`, 1, 100000); num(f?.height, `${path}.frame.height`, 1, 100000);
      num(f?.x, `${path}.frame.x`); num(f?.y, `${path}.frame.y`);
    }
  });

  const placement = (item, path) => {
    if (item?.front !== undefined && typeof item.front !== 'boolean') fail(`${path}.front`, 'must be boolean');
    if (!item?.front && item?.after !== ARENA_DEPTH && !layerIds.has(item?.after)) fail(`${path}.after`, `must name a scenery layer or "${ARENA_DEPTH}", or set front: true`);
  };

  // Clouds drift sideways at `speed` (world px/s) and wrap around the arena.
  const clouds = scenery.clouds;
  if (clouds !== undefined) {
    if (!clouds || typeof clouds !== 'object' || typeof clouds.enabled !== 'boolean') fail('scenery.clouds', 'requires enabled (boolean) and items');
    list(clouds?.items, 'scenery.clouds.items', 40).forEach((c, i) => {
      const path = `scenery.clouds.items[${i}]`;
      if (layerIds.has(c?.id)) fail(`${path}.id`, 'must differ from layer IDs');
      id(c?.id, `${path}.id`);
      if (c?.type !== RANDOM_CLOUD && !CLOUD_TYPES[c?.type]) fail(`${path}.type`, `use "${RANDOM_CLOUD}" or a cloud from clouds.json`);
      if (!CLOUD_DIRECTIONS.includes(c?.direction)) fail(`${path}.direction`, `use ${CLOUD_DIRECTIONS.join(' or ')}`);
      num(c?.x, `${path}.x`); num(c?.y, `${path}.y`); num(c?.speed, `${path}.speed`, 0, 500);
      if (c?.after !== undefined || c?.front !== undefined) placement(c, path);
      opt(c?.scale, `${path}.scale`, 0.01, 50); opt(c?.alpha, `${path}.alpha`, 0, 1);
      if (c?.flipX !== undefined && typeof c.flipX !== 'boolean') fail(`${path}.flipX`, 'must be boolean');
    });
  }

  const a = scenery.atmosphere;
  if (a === undefined) return;
  if (!a || typeof a !== 'object') return fail('scenery.atmosphere', 'must be an object');
  color(a.fogColor, 'scenery.atmosphere.fogColor');
  list(a.mist, 'scenery.atmosphere.mist', 8).forEach((m, i) => {
    const path = `scenery.atmosphere.mist[${i}]`;
    placement(m, path); color(m?.color, `${path}.color`);
    num(m?.alpha, `${path}.alpha`, 0, 1); num(m?.scroll, `${path}.scroll`, 0, 3);
    opt(m?.y, `${path}.y`); num(m?.height, `${path}.height`, 1, 8000); opt(m?.speed, `${path}.speed`, -500, 500);
  });
  list(a.glows, 'scenery.atmosphere.glows', 8).forEach((g, i) => {
    const path = `scenery.atmosphere.glows[${i}]`;
    placement(g, path); color(g?.color, `${path}.color`);
    num(g?.x, `${path}.x`); num(g?.y, `${path}.y`); num(g?.scroll, `${path}.scroll`, 0, 3);
    num(g?.radius, `${path}.radius`, 1, 8000); range(g?.alpha, `${path}.alpha`, 0, 1); opt(g?.periodMs, `${path}.periodMs`, 100, 60000);
  });
  list(a.rays, 'scenery.atmosphere.rays', 8).forEach((r, i) => {
    const path = `scenery.atmosphere.rays[${i}]`;
    placement(r, path); color(r?.color, `${path}.color`);
    num(r?.x, `${path}.x`); num(r?.y, `${path}.y`); num(r?.scroll, `${path}.scroll`, 0, 3);
    num(r?.count, `${path}.count`, 1, 24); num(r?.angle, `${path}.angle`, -180, 180); num(r?.spread, `${path}.spread`, 0, 180);
    num(r?.length, `${path}.length`, 1, 10000); range(r?.width, `${path}.width`, 1, 4000);
    range(r?.alpha, `${path}.alpha`, 0, 1); range(r?.periodMs, `${path}.periodMs`, 100, 60000);
  });
  // One dust field, or several at different depths. Without `after` a field
  // floats over the fighters.
  const dust = Array.isArray(a.dust) ? a.dust : a.dust === undefined ? [] : [a.dust];
  if (dust.length > 6) fail('scenery.atmosphere.dust', 'allows at most 6 fields');
  dust.forEach((d, i) => {
    const path = Array.isArray(a.dust) ? `scenery.atmosphere.dust[${i}]` : 'scenery.atmosphere.dust';
    color(d?.color, `${path}.color`); num(d?.count, `${path}.count`, 0, 400); opt(d?.superHighCount, `${path}.superHighCount`, 0, 400);
    num(d?.scroll, `${path}.scroll`, 0, 3); range(d?.size, `${path}.size`, 0.5, 256); opt(d?.alpha, `${path}.alpha`, 0, 1);
    if (d?.front !== undefined && typeof d.front !== 'boolean') fail(`${path}.front`, 'must be boolean');
    if (d?.after !== undefined) placement(d, path);
  });
  if (a.platforms !== undefined) {
    const p = a.platforms, path = 'scenery.atmosphere.platforms';
    color(p?.top, `${path}.top`); color(p?.bottom, `${path}.bottom`); num(p?.strength, `${path}.strength`, 0, 1);
    if (p?.shadow !== undefined) { color(p.shadow?.color, `${path}.shadow.color`); num(p.shadow?.alpha, `${path}.shadow.alpha`, 0, 1); opt(p.shadow?.y, `${path}.shadow.y`, -64, 64); }
  }
  if (a.vignette !== undefined) { color(a.vignette?.color, 'scenery.atmosphere.vignette.color'); num(a.vignette?.alpha, 'scenery.atmosphere.vignette.alpha', 0, 1); }
}

/** Cloud art for a cloud object; "random" picks by ID, so every client agrees. */
function cloudUrl(cloud) {
  if (cloud.type !== RANDOM_CLOUD) return CLOUD_TYPES[cloud.type];
  const types = Object.keys(CLOUD_TYPES);
  let hash = 0;
  for (const char of String(cloud.id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return CLOUD_TYPES[types[hash % types.length]];
}

/** Clouds that render: none when the map turns them off. */
function activeClouds(scenery) {
  return scenery?.clouds?.enabled ? scenery.clouds.items || [] : [];
}

/** Image files a scenery block loads. */
function sceneryUrls(scenery) {
  return [...(scenery?.layers || []).map(layer => layer.url), ...activeClouds(scenery).map(cloudUrl)];
}

/** Apparent zoom of a layer. Far layers react less to camera zoom. */
function layerZoom(referenceZoom, zoom, scroll) {
  return referenceZoom * Math.pow(zoom / referenceZoom, scroll);
}

/**
 * Phaser position and scale multiplier for a scenery object with scrollFactor
 * `scroll`, so that it sits at `offset` from the bounds centre when the camera
 * is centred there. Phaser draws at origin + zoom * (x - scroll * scrollX - origin).
 */
function sceneryTransform({ scroll, offset, center, origin, zoom, referenceZoom }) {
  const scale = layerZoom(referenceZoom, zoom, scroll) / zoom;
  return {
    x: scroll * center.x + (1 - scroll) * origin.x + scale * offset.x,
    y: scroll * center.y + (1 - scroll) * origin.y + scale * offset.y,
    scale,
  };
}

/**
 * Smallest image scale that keeps a layer covering the screen at every zoom
 * the match camera uses, wherever it sits inside its bounds. `horizontalOnly`
 * suits horizon strips that are meant to leave sky above or below them.
 */
function coverScale({ image, scroll, offset = { x: 0, y: 0 }, view, bounds, referenceZoom, zoomRange, margin = 0, horizontalOnly = false }) {
  const [minZoom, maxZoom] = zoomRange;
  let scale = 0;
  for (let i = 0; i <= 16; i++) {
    const zoom = minZoom * Math.pow(maxZoom / minZoom, i / 16);
    const apparent = layerZoom(referenceZoom, zoom, scroll);
    // Inside the bounds the camera roams this far from their centre; a view
    // larger than the bounds is pinned to their leading edge, off centre.
    const travelX = Math.abs(bounds.width / 2 - view.width / (2 * zoom)) + margin;
    const travelY = Math.abs(bounds.height / 2 - view.height / (2 * zoom)) + margin;
    const halfW = view.width / 2 + zoom * scroll * travelX + apparent * Math.abs(offset.x);
    const halfH = view.height / 2 + zoom * scroll * travelY + apparent * Math.abs(offset.y);
    scale = Math.max(scale, (2 * halfW) / (image.width * apparent), horizontalOnly ? 0 : (2 * halfH) / (image.height * apparent));
  }
  return scale;
}

module.exports = { ARENA_DEPTH, CLOUD_TYPES, CLOUD_DIRECTIONS, RANDOM_CLOUD, validateScenery, cloudUrl, activeClouds, sceneryUrls, layerZoom, sceneryTransform, coverScale };
