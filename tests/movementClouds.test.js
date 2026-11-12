const { loadClientModule } = require('./helpers/clientModule');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createCloudSim } = loadClientModule('src/client/game/scene/clouds/cloudSim.js');
const raster = loadClientModule('src/client/game/scene/clouds/cloudRaster.js');
const emitters = loadClientModule('src/client/game/scene/clouds/cloudEmitters.js');

function seeded(seed = 7) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(sim, ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += 16) sim.step(16);
}

const area = (blobs) => blobs.reduce((sum, b) => sum + b.radius * b.radius, 0);

test('shockwave smoke follows the moving body, turns with its flight, and expires', () => {
  const { createClientModuleGraph } = require('./helpers/clientModule');
  const { EventEmitter } = require('node:events');
  for (const direction of [-1, 1]) {
    const { spawnShockwaveHitSmoke } = createClientModuleGraph({
      globals: { ImageData: class {} },
    }).load('src/client/game/powerups/shockwaveHit.js');
    // No camera: exercise the real follower and simulation without canvas drawing.
    const scene = { add: { image() {} }, textures: { createCanvas() {} }, events: new EventEmitter() };
    const sprite = { active: true, x: 200, y: 150, scaleX: 1, scaleY: 1,
      displayOriginX: 25, displayOriginY: 40,
      body: { offset: { x: 0, y: 0 }, width: 50, height: 80 } };
    spawnShockwaveHitSmoke(scene, sprite, { amountX: direction * 1200, amountY: -600 });
    const sim = scene._cloudSystem.sim;
    const first = sim.blobs[0];
    assert.ok((first.x - sprite.x) * direction < 0, 'smoke starts behind the launch');
    const initial = new Set(sim.blobs);
    sprite.x += direction * 100;
    scene.events.emit('update', 16, 16);
    const trail = sim.blobs.filter(blob => !initial.has(blob));
    assert.ok(trail.length > 3, 'moving lays multiple puffs along the travelled path');
    assert.ok(trail.some(blob => (blob.x - first.x) * direction > 50), 'smoke follows the body away from the impact');
    assert.ok(sim.blobs.every(blob => blob.layer === 'back'));
    const beforeTurn = new Set(sim.blobs);
    sprite.y -= 100;
    scene.events.emit('update', 32, 16);
    const turn = sim.blobs.filter(blob => !beforeTurn.has(blob));
    assert.ok(turn.some(blob => blob.y < sprite.y + 50), 'trail follows a change in flight direction');
    assert.ok(turn.some(blob => blob.vy > 0), 'fresh smoke drifts behind upward travel');
    const stoppedCount = sim.size;
    scene.events.emit('update', 48, 16);
    assert.equal(sim.size, stoppedCount, 'stopping does not pile up new smoke');
    for (let i = 0; i < 300; i++) {
      sprite.x += direction * 10;
      scene.events.emit('update', 48 + i * 16, 16);
    }
    assert.equal(sim.size, 0, 'emission ends even if the fighter keeps moving, and the trail dissipates');
    spawnShockwaveHitSmoke(scene, { ...sprite, active: false }, {});
    spawnShockwaveHitSmoke(scene, null, {});
    assert.equal(sim.size, 0);
    scene.events.emit('shutdown');
    assert.equal(scene.events.listenerCount('update'), 0);
  }
});

describe('cloud simulation', () => {
  test('a cloud puffs out, breaks into smaller drifting pieces, then dissipates completely', () => {
    const sim = createCloudSim({ random: seeded() });
    sim.add({ x: 0, y: 0, vx: 220, radius: 8, targetRadius: 14, splitAt: 180, erodeAt: 400 });

    run(sim, 128);
    assert.equal(sim.size, 1);
    assert.ok(sim.blobs[0].radius > 8, 'it grows by puffing out, not by being scaled');

    run(sim, 96);
    assert.ok(sim.size >= 2, 'it has broken into pieces');
    assert.ok(sim.blobs.every((b) => b.radius < 14), 'pieces are smaller than the cloud they came from');
    assert.ok(sim.blobs.every((b) => b.vx > 0), 'pieces keep travelling the way the cloud was going');

    run(sim, 3000);
    assert.equal(sim.size, 0);
  });

  test('a curling puff kicked backwards rolls up and over instead of flying straight', () => {
    const sim = createCloudSim({ random: seeded(4) });
    // Kicked left behind a fighter running right; curl turns it upward.
    const blob = sim.add({ x: 0, y: 0, vx: -80, vy: 0, radius: 5, curl: 6, rise: 0, wobble: 0, erodeAt: 5000 });
    run(sim, 160);
    assert.ok(blob.vy < 0, 'it is heading up');
    run(sim, 240);
    assert.ok(blob.vx > 0, 'it has curled back over');
    assert.ok(blob.y < -2);
  });

  test('drag brings a launched cloud to rest instead of letting it fly forever', () => {
    const sim = createCloudSim({ random: seeded(3) });
    sim.add({ x: 0, y: 0, vx: 400, radius: 10, erodeAt: 5000 });
    run(sim, 1500);
    const [blob] = sim.blobs;
    assert.ok(Math.abs(blob.vx) < 20);
    assert.ok(blob.x > 40 && blob.x < 400 * 1.5);
  });
});

describe('cloud rasterizer', () => {
  const opaque = (pixel) => pixel >>> 24 === 255;

  test('overlapping blobs melt into one silhouette with no outline between them', () => {
    const grid = raster.createCloudGrid(60, 40, 3);
    raster.rasterizeClouds(grid, [
      { x: 60, y: 60, radius: 12, tone: 0 },
      { x: 84, y: 60, radius: 12, tone: 0 },
    ]);
    const row = Math.floor(60 / 3) * grid.width;
    for (let cx = Math.floor(60 / 3); cx <= Math.floor(84 / 3); cx++) {
      assert.ok(opaque(grid.pixels[row + cx]), `cell ${cx} between the blobs is solid cloud`);
    }
  });

  test('a blob is lit on its upper edge, shadowed underneath, and outlined outside', () => {
    const grid = raster.createCloudGrid(40, 40, 3);
    raster.rasterizeClouds(grid, [{ x: 60, y: 60, radius: 18, tone: 0 }]);
    const column = Math.floor(60 / 3);
    const cells = [];
    for (let cy = 0; cy < grid.height; cy++) cells.push(grid.pixels[cy * grid.width + column]);
    const inside = cells.map((p, i) => (opaque(p) ? i : -1)).filter((i) => i >= 0);
    const top = cells[inside[0]];
    const bottom = cells[inside[inside.length - 1]];
    assert.equal(top, raster.packColor(raster.DEFAULT_CLOUD_PALETTE.light));
    assert.equal(bottom, raster.packColor(raster.DEFAULT_CLOUD_PALETTE.deep));
    const outline = cells[inside[inside.length - 1] + 1];
    assert.ok(outline !== 0 && !opaque(outline), 'a translucent outline sits just outside');
  });

  test('a light cloud draws see-through and a heavy one solid', () => {
    const alphaAt = (opacity) => {
      const grid = raster.createCloudGrid(40, 40, 3);
      raster.rasterizeClouds(grid, [{ x: 60, y: 60, radius: 15, tone: 0, opacity }]);
      return grid.pixels[20 * grid.width + 20] >>> 24;
    };
    assert.equal(alphaAt(1), 255);
    assert.ok(alphaAt(0.6) < 200 && alphaAt(0.6) > 100);
  });

  test('a pass with nothing to draw clears what the last pass drew', () => {
    const grid = raster.createCloudGrid(40, 40, 3);
    raster.rasterizeClouds(grid, [{ x: 60, y: 60, radius: 12, tone: 0 }]);
    const changed = raster.rasterizeClouds(grid, []);
    assert.ok(changed, 'the cleared area is reported so it can be re-uploaded');
    assert.ok(grid.pixels.every((p) => p === 0));
  });
});

describe('cloud emitters', () => {
  test('a floor impact rolls clouds both ways, harder impacts make more cloud', () => {
    const soft = createCloudSim({ random: seeded(11) });
    const hard = createCloudSim({ random: seeded(11) });
    emitters.emitSurfaceBurst(soft, { x: 0, y: 0, nx: 0, ny: -1, strength: 0.15 });
    emitters.emitSurfaceBurst(hard, { x: 0, y: 0, nx: 0, ny: -1, strength: 1 });
    for (const sim of [soft, hard]) {
      assert.ok(sim.blobs.some((b) => b.vx < -40) && sim.blobs.some((b) => b.vx > 40));
      assert.ok(sim.blobs.every((b) => b.y <= 0), 'clouds sit on top of the floor');
    }
    assert.ok(area(hard.blobs) > area(soft.blobs) * 1.5);
  });

  test('impact clouds can pop in near full size so a landing reads on its first frame', () => {
    const grown = createCloudSim({ random: seeded(8) });
    const popped = createCloudSim({ random: seeded(8) });
    emitters.emitSurfaceBurst(grown, { x: 0, y: 0, strength: 0.8 });
    emitters.emitSurfaceBurst(popped, { x: 0, y: 0, strength: 0.8, pop: true });
    const startFraction = (sim) => area(sim.blobs) / sim.blobs.reduce((s, b) => s + b.targetRadius ** 2, 0);
    assert.ok(startFraction(popped) > 0.75);
    assert.ok(startFraction(popped) > startFraction(grown) * 1.5);
  });

  test('harder impacts throw out more solid cloud', () => {
    const opacityOf = (strength) => {
      const sim = createCloudSim({ random: seeded(6) });
      emitters.emitSurfaceBurst(sim, { x: 0, y: 0, strength });
      return Math.min(...sim.blobs.map((blob) => blob.opacity));
    };
    assert.ok(opacityOf(1) > opacityOf(0.2));
  });

  test('momentum carries more of the cloud the way the body was moving', () => {
    const sim = createCloudSim({ random: seeded(5) });
    emitters.emitSurfaceBurst(sim, { x: 0, y: 0, nx: 0, ny: -1, strength: 0.5, bias: 1 });
    const right = area(sim.blobs.filter((b) => b.vx > 0));
    const left = area(sim.blobs.filter((b) => b.vx < 0));
    assert.ok(right > left);
  });

  test('a wall impact spreads along the wall and stays on the open side of it', () => {
    const sim = createCloudSim({ random: seeded(9) });
    emitters.emitSurfaceBurst(sim, { x: 100, y: 0, nx: 1, ny: 0, strength: 0.6 });
    assert.ok(sim.blobs.every((b) => b.x >= 100));
    assert.ok(sim.blobs.some((b) => b.vy < -40) && sim.blobs.some((b) => b.vy > 40));
  });

  test('wall scrapes sit on the wall face being slid down, not out beside the fighter', () => {
    const sim = createCloudSim({ random: seeded(2) });
    for (let i = 0; i < 6; i++) {
      emitters.emitWallScrape(sim, { x: 200, y: i * 6, awayX: -1, speedRatio: 1, slideVelocity: 120 });
    }
    // Wall on the right of x=200 (fighter is to the left, awayX -1).
    assert.ok(sim.blobs.every((b) => b.x >= 200 && b.x < 200 + b.targetRadius * 1.5));
    assert.ok(sim.blobs.every((b) => b.vx >= 0), 'they never drift out toward the fighter');
  });
});
