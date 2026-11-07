// cloudLayer.js
// Phaser glue for the movement cloud system: one simulation per scene,
// stepped on scene update and drawn into two world-space pixel canvases (one
// behind the fighters, one in front). The canvases cover the camera view
// snapped to the cloud pixel grid, so cloud pixels never shimmer as the camera
// moves, and only the rectangle that actually changed is re-uploaded.
import { RENDER_LAYERS } from "../renderLayers";
import { createCloudSim } from "./cloudSim";
import { createCloudGrid, rasterizeClouds } from "./cloudRaster";

/** World pixels per cloud pixel. */
export const CLOUD_PIXEL = 3;
const MARGIN_CELLS = 28;

export const CLOUD_LAYER_DEPTHS = Object.freeze({
  back: RENDER_LAYERS.PLAYER - 2,
  front: RENDER_LAYERS.PLAYER + 1,
});

// Whole-layer opacity on top of each cloud's own (blob.opacity). The front
// layer sits over fighters, so it stays lighter.
export const CLOUD_LAYER_ALPHA = Object.freeze({
  back: 1,
  front: 0.8,
});

let nextLayerId = 0;

function createSurface(scene, name, id) {
  return {
    name,
    key: `__movement_clouds_${id}_${name}`,
    texture: null,
    image: null,
    grid: null,
    imageData: null,
    blobs: [],
  };
}

function ensureSurfaceSize(scene, surface, cols, rows) {
  const grid = surface.grid;
  if (grid && grid.width >= cols && grid.height >= rows &&
      grid.width <= cols * 1.6 && grid.height <= rows * 1.6) return true;
  const width = Math.ceil(cols * 1.15);
  const height = Math.ceil(rows * 1.15);
  if (!surface.texture) {
    surface.texture = scene.textures.createCanvas(surface.key, width, height);
    if (!surface.texture) return false;
    surface.texture.setFilter?.(Phaser.Textures.FilterMode.NEAREST);
    surface.image = scene.add.image(0, 0, surface.key)
      .setOrigin(0, 0)
      .setScale(CLOUD_PIXEL)
      .setDepth(CLOUD_LAYER_DEPTHS[surface.name])
      .setAlpha(CLOUD_LAYER_ALPHA[surface.name]);
  } else {
    surface.texture.setSize(width, height);
    surface.image.setTexture(surface.key);
  }
  surface.grid = createCloudGrid(width, height, CLOUD_PIXEL);
  surface.imageData = new ImageData(
    new Uint8ClampedArray(surface.grid.pixels.buffer),
    width,
    height,
  );
  surface.texture.context.clearRect(0, 0, width, height);
  return true;
}

function drawSurface(scene, surface, view) {
  const cols = Math.ceil(view.width / CLOUD_PIXEL) + MARGIN_CELLS * 2;
  const rows = Math.ceil(view.height / CLOUD_PIXEL) + MARGIN_CELLS * 2;
  if (!surface.blobs.length && !surface.grid?.dirty) {
    if (surface.image) surface.image.setVisible(false);
    return;
  }
  if (!ensureSurfaceSize(scene, surface, cols, rows)) return;
  const grid = surface.grid;
  grid.originX = Math.floor(view.x / CLOUD_PIXEL) * CLOUD_PIXEL - MARGIN_CELLS * CLOUD_PIXEL;
  grid.originY = Math.floor(view.y / CLOUD_PIXEL) * CLOUD_PIXEL - MARGIN_CELLS * CLOUD_PIXEL;
  const rect = rasterizeClouds(grid, surface.blobs);
  if (rect) {
    surface.texture.context.putImageData(
      surface.imageData,
      0,
      0,
      rect.x0,
      rect.y0,
      rect.x1 - rect.x0 + 1,
      rect.y1 - rect.y0 + 1,
    );
    surface.texture.refresh();
  }
  surface.image.setPosition(grid.originX, grid.originY);
  surface.image.setVisible(!!grid.dirty);
}

function createCloudSystem(scene) {
  const id = nextLayerId++;
  const sim = createCloudSim();
  const surfaces = {
    back: createSurface(scene, "back", id),
    front: createSurface(scene, "front", id),
  };
  let followers = [];
  let destroyed = false;
  let clock = 0; // ms of scene updates, so followers pause with the game

  function updateFollowers(now) {
    if (!followers.length) return;
    followers = followers.filter((f) => {
      const target = f.target;
      if (!target || target.active === false || now >= f.until) return false;
      const x = Number(target.body?.center?.x ?? target.x);
      const y = Number(target.body?.center?.y ?? target.y) + (f.offsetY || 0);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      let dx = x - f.lastX;
      let dy = y - f.lastY;
      let distance = Math.hypot(dx, dy);
      if (distance > 160) return false; // teleported or respawned
      const progress = 1 - (f.until - now) / f.duration;
      while (distance >= f.spacing) {
        f.lastX += (dx / distance) * f.spacing;
        f.lastY += (dy / distance) * f.spacing;
        f.emit(sim, f.lastX, f.lastY, progress);
        dx = x - f.lastX;
        dy = y - f.lastY;
        distance = Math.hypot(dx, dy);
      }
      return true;
    });
  }

  function update(_time, delta) {
    if (destroyed) return;
    const step = Math.min(50, Math.max(0, Number(delta) || 0));
    clock += step;
    sim.step(step);
    updateFollowers(clock);
    surfaces.back.blobs.length = 0;
    surfaces.front.blobs.length = 0;
    for (const blob of sim.blobs) {
      (blob.layer === "front" ? surfaces.front : surfaces.back).blobs.push(blob);
    }
    const view = scene.cameras?.main?.worldView;
    if (!view) return;
    drawSurface(scene, surfaces.back, view);
    drawSurface(scene, surfaces.front, view);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    scene.events.off("update", update);
    for (const surface of Object.values(surfaces)) {
      surface.image?.destroy();
      if (surface.texture) scene.textures.remove(surface.key);
    }
    followers = [];
    sim.clear();
    if (scene._cloudSystem === system) scene._cloudSystem = null;
  }

  const system = {
    sim,
    /**
     * Emit clouds along a moving target's path for `durationMs`, one call to
     * `emit(sim, x, y, progress)` every `spacing` world pixels travelled.
     */
    follow(target, { durationMs = 160, spacing = 9, offsetY = 0, emit }) {
      if (!target || typeof emit !== "function") return;
      const x = Number(target.body?.center?.x ?? target.x);
      const y = Number(target.body?.center?.y ?? target.y) + offsetY;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      followers.push({
        target,
        emit,
        spacing,
        offsetY,
        duration: durationMs,
        until: clock + durationMs,
        lastX: x,
        lastY: y,
      });
    },
    destroy,
    get destroyed() { return destroyed; },
  };

  scene.events.on("update", update);
  scene.events.once("shutdown", destroy);
  scene.events.once("destroy", destroy);
  return system;
}

/** The scene's cloud system, created on first use; null without a renderer. */
export function getCloudSystem(scene) {
  if (!scene?.add?.image || !scene.textures?.createCanvas || !scene.events?.on) return null;
  if (typeof ImageData === "undefined") return null;
  if (!scene._cloudSystem || scene._cloudSystem.destroyed) {
    scene._cloudSystem = createCloudSystem(scene);
  }
  return scene._cloudSystem;
}
