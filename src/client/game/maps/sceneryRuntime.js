// Layered map scenery (see `scenery` in docs/development/maps.md). Every map's
// backdrop renders here. Art layers, drifting clouds and parallax render at
// every quality level. Atmosphere (fog, mist, glows, light rays, dust, platform
// lighting, vignette) is WebGL-only and appears on High and Super High.
// Depth-of-field blur is baked into layer art by the importer, not done here.
import { getSettings, subscribeSettings } from '../../site/preferences';
import { RENDER_LAYERS } from '../scene/renderLayers';
import { ARENA_DEPTH, activeClouds, cloudUrl, coverScale, sceneryTransform, sceneryUrls } from '../../../shared/maps/scenery';
import { mapArena } from '../../../shared/maps/arenas';
import { ensureSceneryTextures, SCENERY_TEXTURES as T } from './sceneryTextures';
import { GAME_VIEW } from '../scene/gameViewport';

const ATMOSPHERE_LEVELS = new Set(['high', 'super-high']);
// Extra camera travel covered beyond the bounds: aim look-ahead and shake.
const COVER_MARGIN = 160;
// Dash adds a few percent of zoom on top of the arena's follow range.
const DASH_ZOOM = 1.03;
// Sub-steps above each back layer (10 apart), so its haze sits on it, its light
// over that and its clouds in front.
const STACK = { fog: 1, mist: 2, glow: 3, rays: 4, dust: 4.5, clouds: 5 };
// Clouds wrap this far beyond the camera bounds' half-width (world px).
const CLOUD_WRAP_MARGIN = 500;

/** Texture key a scenery image loads under. */
export const sceneryTextureKey = (url) => `scenery:${url}`;
const layerKey = sceneryTextureKey;
const color = (hex, fallback = 0xffffff) => (typeof hex === 'string' ? parseInt(hex.slice(1), 16) : fallback);
const between = ([min, max], t = Math.random()) => min + (max - min) * t;

export function preloadScenery(scene, data) {
  for (const url of sceneryUrls(data?.scenery)) {
    const key = layerKey(url);
    if (!scene.textures.exists(key)) scene.load.image(key, url);
  }
}

// Layers in the arena stack sit above everything placed `after: "arena"`.
const ARENA_LAYER_DEPTH = RENDER_LAYERS.WORLD + 5;

function layerDepths(layers) {
  const depths = {};
  let back = 0, arena = 0, front = 0;
  for (const layer of layers) {
    const stack = layer.stack || (layer.scroll > 1 ? 'front' : 'back');
    depths[layer.id] = stack === 'front' ? RENDER_LAYERS.SCENERY_FRONT + 0.5 + 0.1 * front++
      : stack === 'arena' ? ARENA_LAYER_DEPTH + 0.1 * arena++
        : RENDER_LAYERS.SCENERY_BACK + 10 * back++;
  }
  return depths;
}

// Depth for an item placed with `after` (a layer ID or "arena") or `front`.
function stackDepth(depths, item, step) {
  if (item.front) return RENDER_LAYERS.SCENERY_FRONT + 0.1 * step;
  if (item.after === ARENA_DEPTH) return RENDER_LAYERS.WORLD + 1 + 0.1 * step;
  return depths[item.after] + step;
}

function loadTexture(scene, url, filter) {
  const key = layerKey(url);
  if (!scene.textures.exists(key)) return null;
  const texture = scene.textures.get(key);
  texture.setFilter(filter === 'nearest' ? Phaser.Textures.FilterMode.NEAREST : Phaser.Textures.FilterMode.LINEAR);
  return texture;
}

function atmosphereEnabled(scene) {
  return scene.game.renderer.type === Phaser.WEBGL && ATMOSPHERE_LEVELS.has(getSettings().graphics);
}

/**
 * Build a map's scenery into a scene. The match runs it live: parallax against
 * the camera, drifting clouds and atmosphere. `still: true` (Map Studio's edit
 * view) composes it once as the match camera sees it at its reference zoom,
 * centred in its bounds, with clouds at their placed positions.
 */
export function buildScenery(scene, data, { still = false } = {}) {
  destroyScenery(scene);
  const scenery = data?.scenery;
  const camera = mapArena(data)?.camera;
  if (!scenery || !camera) return null;
  const runtime = {
    scene,
    scenery,
    center: { x: camera.x + camera.width / 2, y: camera.y + camera.height / 2 },
    bounds: { width: camera.width, height: camera.height },
    referenceZoom: camera.zoom,
    // The follow camera's zoom range (cameraDynamics.js).
    zoomLimits: [camera.minZoom, camera.maxZoom],
    depths: layerDepths(scenery.layers),
    layers: [],
    clouds: [],
    atmosphere: null,
  };
  for (const layer of scenery.layers) {
    const texture = loadTexture(scene, layer.url, layer.filter);
    if (!texture) continue;
    const image = scene.add.image(0, 0, texture.key)
      .setScrollFactor(layer.scroll)
      .setDepth(runtime.depths[layer.id])
      .setAlpha(layer.alpha ?? 1);
    if (layer.tint) image.setTint(color(layer.tint));
    const source = texture.getSourceImage();
    const f = layer.frame;
    runtime.layers.push({ obj: image, layer, scroll: layer.scroll, offset: { x: layer.x || 0, y: layer.y || 0 },
      image: f ? { width: f.width, height: f.height } : { width: source.width, height: source.height },
      // Image centre relative to its frame's centre, in image px.
      frameOffset: f ? { x: f.x + source.width / 2 - f.width / 2, y: f.y + source.height / 2 - f.height / 2 } : { x: 0, y: 0 },
      sx: layer.scale || 1, sy: layer.scale || 1 });
  }

  fitLayers(runtime);

  // Clouds sit in the world like platforms and drift sideways; by default
  // over the platforms and under the fighters.
  activeClouds(scenery).forEach((cloud, i) => {
    const texture = loadTexture(scene, cloudUrl(cloud));
    if (!texture) return;
    const scale = cloud.scale || 1;
    const placement = cloud.front || cloud.after ? cloud : { after: ARENA_DEPTH };
    const obj = scene.add.image(0, 0, texture.key).setScrollFactor(1).setFlipX(Boolean(cloud.flipX))
      .setDepth(stackDepth(runtime.depths, placement, STACK.clouds) + 0.001 * i).setAlpha(cloud.alpha ?? 1);
    const halfSpan = runtime.bounds.width / 2 + CLOUD_WRAP_MARGIN + texture.getSourceImage().width * scale / 2;
    const home = cloud.x - runtime.center.x;
    runtime.clouds.push({ obj, scroll: 1, home, speed: cloud.direction === 'left' ? -cloud.speed : cloud.speed, halfSpan,
      offset: { x: home, y: cloud.y - runtime.center.y }, sx: scale, sy: scale });
  });

  if (still) {
    for (const item of [...runtime.layers, ...runtime.clouds]) {
      item.obj.setScrollFactor(1).setPosition(runtime.center.x + item.offset.x, runtime.center.y + item.offset.y)
        .setScale(item.sx, item.sy);
    }
    runtime.destroy = () => { for (const item of [...runtime.layers, ...runtime.clouds]) item.obj.destroy(); };
    scene._sceneryRuntime = runtime;
    return runtime;
  }

  const sync = () => {
    const enabled = Boolean(scenery.atmosphere) && atmosphereEnabled(scene);
    if (enabled && !runtime.atmosphere) runtime.atmosphere = buildAtmosphere(runtime);
    if (!enabled && runtime.atmosphere) { runtime.atmosphere.destroy(); runtime.atmosphere = null; }
    // Super High adds denser dust; rebuild when switching between the two.
    if (enabled && runtime.atmosphere && runtime.atmosphere.level !== getSettings().graphics) {
      runtime.atmosphere.destroy();
      runtime.atmosphere = buildAtmosphere(runtime);
    }
  };
  sync();
  const unsubscribe = subscribeSettings(sync);
  const update = () => updateScenery(runtime);
  scene.events.on('postupdate', update);
  runtime.destroy = () => {
    unsubscribe();
    scene.events.off('postupdate', update);
    runtime.atmosphere?.destroy();
    for (const item of [...runtime.layers, ...runtime.clouds]) item.obj.destroy();
    runtime.layers = [];
    runtime.clouds = [];
  };
  scene.events.once('shutdown', () => destroyScenery(scene));
  scene._sceneryRuntime = runtime;
  updateScenery(runtime);
  return runtime;
}

export function destroyScenery(scene) {
  scene?._sceneryRuntime?.destroy();
  if (scene) scene._sceneryRuntime = null;
}

// Fit cover layers once, for every logical size the window can give the game
// (gameViewport.js), so resizing never makes a layer jump in scale.
const FIT_VIEWS = [
  [GAME_VIEW.minWidth, GAME_VIEW.minHeight], [GAME_VIEW.minWidth, GAME_VIEW.maxHeight],
  [GAME_VIEW.width, GAME_VIEW.minHeight], [GAME_VIEW.width, GAME_VIEW.maxHeight],
].map(([width, height]) => ({ width, height }));

function fitLayers(runtime) {
  for (const item of runtime.layers) {
    const extra = { x: item.layer.x || 0, y: item.layer.y || 0 };
    let scale = item.layer.scale || 1;
    if (item.layer.fit !== 'none') {
      scale = item.layer.scale || 0;
      for (const view of FIT_VIEWS) {
        const fitZoom = Math.max(view.width / runtime.bounds.width, view.height / runtime.bounds.height);
        const [low, high] = runtime.zoomLimits;
        scale = Math.max(scale, coverScale({
          image: item.image, scroll: item.scroll, offset: extra, view, bounds: runtime.bounds,
          referenceZoom: runtime.referenceZoom, zoomRange: [Math.min(fitZoom, low, runtime.referenceZoom), high * DASH_ZOOM],
          margin: COVER_MARGIN, horizontalOnly: item.layer.fit === 'cover-x',
        }));
      }
    }
    item.sx = item.sy = scale;
    // A framed image keeps its place in the fitted frame.
    item.offset = { x: extra.x + item.frameOffset.x * scale, y: extra.y + item.frameOffset.y * scale };
  }
}

function place(runtime, item, cam, origin) {
  const t = sceneryTransform({ scroll: item.scroll, offset: item.offset, center: runtime.center, origin,
    zoom: cam.zoom, referenceZoom: runtime.referenceZoom });
  item.obj.setPosition(t.x, t.y).setScale(item.sx * t.scale, item.sy * t.scale);
}

function updateScenery(runtime) {
  const cam = runtime.scene.cameras.main;
  if (!cam) return;
  const origin = { x: cam.width * cam.originX, y: cam.height * cam.originY };
  for (const item of runtime.layers) place(runtime, item, cam, origin);
  const time = runtime.scene.time.now / 1000;
  // Clouds drift and wrap around the arena, re-entering from the far side.
  for (const cloud of runtime.clouds) {
    const span = cloud.halfSpan * 2;
    const x = cloud.home + cloud.speed * time + cloud.halfSpan;
    cloud.offset.x = ((x % span) + span) % span - cloud.halfSpan;
    place(runtime, cloud, cam, origin);
  }
  const atmosphere = runtime.atmosphere;
  if (!atmosphere) return;
  for (const item of atmosphere.placed) place(runtime, item, cam, origin);
  // Full-screen overlays: scroll factor 0, sized to the zoomed view.
  for (const obj of atmosphere.screens) {
    obj.setPosition(origin.x, origin.y).setDisplaySize(cam.width / cam.zoom * 1.04, cam.height / cam.zoom * 1.04);
  }
  // Lighting copies follow their platform (animation frames, editor moves).
  for (const { source, overlays } of atmosphere.lit) {
    for (const { obj, dy, alpha } of overlays) {
      if (obj.frame.name !== source.frame.name) obj.setFrame(source.frame.name);
      obj.setPosition(source.x, source.y + dy).setScale(source.scaleX, source.scaleY)
        .setFlip(source.flipX, source.flipY).setAngle(source.angle)
        .setVisible(source.visible && source.active).setAlpha(alpha * source.alpha);
    }
  }
  for (const mist of atmosphere.mists) {
    const t = sceneryTransform({ scroll: mist.scroll, offset: { x: 0, y: mist.y }, center: runtime.center, origin,
      zoom: cam.zoom, referenceZoom: runtime.referenceZoom });
    const scaleY = (mist.height * t.scale) / mist.obj.height;
    mist.obj.setPosition(origin.x, t.y).setScale(1 / cam.zoom, scaleY);
    // Keep the mist texture's aspect, then drift it and parallax it horizontally.
    mist.obj.tileScaleX = scaleY * cam.zoom;
    mist.obj.tileScaleY = 1;
    mist.obj.tilePositionX = (time * mist.speed + cam.scrollX * mist.scroll * cam.zoom) / mist.obj.tileScaleX;
  }
}

function buildAtmosphere(runtime) {
  const { scene, scenery, depths } = runtime;
  const a = scenery.atmosphere || {};
  const level = getSettings().graphics;
  ensureSceneryTextures(scene);
  const objects = [], placed = [], screens = [], mists = [], tweens = [], lit = [];
  const add = (obj) => { objects.push(obj); return obj; };
  const depthFor = (item, step) => stackDepth(depths, item, step);
  const fogColor = color(a.fogColor);

  // Haze in front of each back layer accumulates with distance.
  for (const layer of scenery.layers) {
    if (!(layer.fog > 0) || layer.scroll > 1) continue;
    screens.push(add(scene.add.image(0, 0, T.fog).setScrollFactor(0).setDepth(depths[layer.id] + STACK.fog)
      .setTint(fogColor).setAlpha(layer.fog)));
  }

  for (const m of a.mist || []) {
    const obj = add(scene.add.tileSprite(0, 0, Math.ceil(GAME_VIEW.width * 1.1), 256, T.mist)
      .setScrollFactor(0, m.scroll).setDepth(depthFor(m, STACK.mist)).setTint(color(m.color)).setAlpha(m.alpha));
    mists.push({ obj, scroll: m.scroll, y: m.y || 0, height: m.height, speed: m.speed ?? 8 });
  }

  for (const g of a.glows || []) {
    const glowTexture = scene.textures.get(T.glow).getSourceImage();
    const obj = add(scene.add.image(0, 0, T.glow).setScrollFactor(g.scroll).setDepth(depthFor(g, STACK.glow))
      .setBlendMode(Phaser.BlendModes.ADD).setTint(color(g.color)).setAlpha(g.alpha[0]));
    const size = (g.radius * 2) / glowTexture.width;
    placed.push({ obj, scroll: g.scroll, offset: { x: g.x, y: g.y }, sx: size, sy: size });
    tweens.push(scene.tweens.add({ targets: obj, alpha: g.alpha[1], duration: g.periodMs || 6000,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
  }

  const rayTexture = scene.textures.get(T.ray).getSourceImage();
  for (const r of a.rays || []) {
    for (let i = 0; i < r.count; i++) {
      const spreadAt = r.count === 1 ? 0.5 : i / (r.count - 1);
      const angle = r.angle + (spreadAt - 0.5) * r.spread + (Math.random() - 0.5) * 3;
      const obj = add(scene.add.image(0, 0, T.ray).setOrigin(0.5, 0).setAngle(angle)
        .setScrollFactor(r.scroll).setDepth(depthFor(r, STACK.rays))
        .setBlendMode(Phaser.BlendModes.ADD).setTint(color(r.color)).setAlpha(r.alpha[0]));
      const item = { obj, scroll: r.scroll, offset: { x: r.x, y: r.y },
        sx: between(r.width) / rayTexture.width, sy: (r.length * between([0.8, 1.15])) / rayTexture.height };
      placed.push(item);
      // Independent periods keep the shafts from pulsing in step.
      const period = between(r.periodMs);
      tweens.push(scene.tweens.add({ targets: obj, alpha: between([r.alpha[0], r.alpha[1]], 0.5 + Math.random() * 0.5),
        duration: period, delay: Math.random() * period, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
      tweens.push(scene.tweens.add({ targets: item, sx: item.sx * between([1.1, 1.35]), duration: period * 1.7,
        delay: Math.random() * period, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
      tweens.push(scene.tweens.add({ targets: obj, angle: angle + (Math.random() < 0.5 ? -1.5 : 1.5),
        duration: period * 2.3, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
    }
  }

  const dustFields = Array.isArray(a.dust) ? a.dust : a.dust ? [a.dust] : [];
  for (const d of dustFields) {
    const count = level === 'super-high' ? d.superHighCount ?? Math.round(d.count * 1.8) : d.count;
    const bounds = scene.cameras.main.getBounds();
    const dot = scene.textures.get(T.dot).getSourceImage().width;
    const peak = d.alpha ?? 0.7;
    const lifespan = { min: 6000, max: 11000 };
    if (!(count > 0)) continue;
    const emitter = add(scene.add.particles(0, 0, T.dot, {
      x: { min: bounds.x, max: bounds.right },
      y: { min: bounds.y, max: bounds.bottom },
      lifespan,
      speedX: { min: -9, max: 9 },
      speedY: { min: -14, max: -2 },
      scale: { min: d.size[0] / dot, max: d.size[1] / dot },
      // Each mote fades in and out over its life.
      alpha: { onEmit: () => 0, onUpdate: (_particle, _key, t) => Math.sin(Math.PI * t) * peak },
      tint: color(d.color),
      blendMode: Phaser.BlendModes.ADD,
      frequency: (lifespan.min + lifespan.max) / 2 / count,
      maxAliveParticles: count,
    }));
    const depth = d.after ? depthFor(d, STACK.dust)
      : d.front === false ? RENDER_LAYERS.WORLD - 1 : RENDER_LAYERS.SCENERY_FRONT + 0.2;
    emitter.setScrollFactor(d.scroll).setDepth(depth);
    emitter.fastForward(lifespan.max);
  }

  // Platform lighting uses tinted copies of each platform rather than preFX,
  // which renders offset under the game's framebuffer scaling.
  if (a.platforms) {
    const p = a.platforms;
    for (const source of scene._mapObjects || []) {
      if (!source?.texture || !source.active || source.type === 'Zone') continue;
      const copy = (depth) => add(scene.add.image(source.x, source.y, source.texture.key, source.frame.name)
        .setOrigin(source.originX, source.originY).setDepth(depth));
      // Light from above: blend the sprite toward a top-to-bottom gradient.
      const light = copy(source.depth + 0.01).setTintFill(color(p.top), color(p.top), color(p.bottom, 0), color(p.bottom, 0))
        .setAlpha(p.strength);
      const overlays = [{ obj: light, dy: 0, alpha: p.strength }];
      if (p.shadow) {
        const shadow = copy(source.depth - 0.01).setTintFill(color(p.shadow.color, 0)).setAlpha(p.shadow.alpha);
        overlays.push({ obj: shadow, dy: p.shadow.y ?? 6, alpha: p.shadow.alpha });
      }
      lit.push({ source, overlays });
    }
  }

  if (a.vignette) {
    screens.push(add(scene.add.image(0, 0, T.vignette).setScrollFactor(0).setDepth(RENDER_LAYERS.PLAYER_HUD - 0.5)
      .setTint(color(a.vignette.color, 0)).setAlpha(a.vignette.alpha)));
  }

  return {
    level, placed, screens, mists, lit,
    destroy() {
      for (const tween of tweens) tween.remove();
      for (const obj of objects) obj.destroy();
    },
  };
}
