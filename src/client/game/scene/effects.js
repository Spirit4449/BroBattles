// effects.js
// Shared lightweight VFX helpers for movement, combat, and player lifecycle.
import { RENDER_LAYERS } from "./renderLayers";
import { getCloudSystem } from "./clouds/cloudLayer";
import {
  emitPuff,
  emitSurfaceBurst,
  emitWake,
  emitWallScrape,
} from "./clouds/cloudEmitters";

const markerPool = new Set();

// Central tuning for movement feedback. These effects use Phaser primitives so
// they stay crisp with the game's pixel-art renderer and require no new assets.
export const MOVEMENT_VFX_CONFIG = Object.freeze({
  dustTint: 0xd8d0c2,
  dustHighlight: 0xfff4df,
  impactAccent: 0xffffff,
  behindPlayerDepth: RENDER_LAYERS.PLAYER - 2,
  frontParticleDepth: RENDER_LAYERS.PLAYER + 1,
  landingMinVelocity: 241,
  landingMaxVelocity: 796,
  landingShockwaveMinFallPx: 163,
  wallSlideSpeedReference: 120,
  runSpeedReference: 260,
  runDustMinIntervalMs: 48,
  runDustMaxIntervalMs: 112,
  directionChangeMinSpeed: 72,
  fastFallStartVelocity: 283,
  fastFallMaxVelocity: 796,
  fastFallTrailMinIntervalMs: 42,
  fastFallTrailMaxIntervalMs: 104,
});

function destroyWhenDone(scene, target, tweenConfig) {
  if (!scene?.tweens || !target) return;
  scene.tweens.add({
    targets: target,
    ...tweenConfig,
    onComplete: () => target?.destroy?.(),
  });
}

function spawnGroundRing(scene, x, y, width, opts = {}) {
  if (!scene?.add) return null;
  const color = opts.color || MOVEMENT_VFX_CONFIG.dustHighlight;
  const ringWidth = Math.round(Math.max(36, width));
  const ring = scene.add.graphics();
  ring.setDepth(
    Number.isFinite(opts.depth)
      ? opts.depth
      : MOVEMENT_VFX_CONFIG.behindPlayerDepth,
  );
  const stroke = Math.max(2, Math.round(Number(opts.strokeWidth) || 3));
  ring.fillStyle(color, 0.84);
  ring.fillRect(-ringWidth / 2, -stroke / 2, ringWidth, stroke);
  ring.fillStyle(color, 0.46);
  ring.fillRect(-ringWidth * 0.68, -stroke * 1.5, ringWidth * 0.16, stroke);
  ring.fillRect(ringWidth * 0.52, -stroke * 1.5, ringWidth * 0.16, stroke);
  ring.fillStyle(color, 0.26);
  ring.fillRect(-ringWidth * 0.83, stroke * 0.65, ringWidth * 0.13, stroke);
  ring.fillRect(ringWidth * 0.7, stroke * 0.65, ringWidth * 0.13, stroke);
  ring.setPosition(Math.round(x), Math.round(y));
  ring.setBlendMode(Phaser.BlendModes.ADD);
  ring.setScale(0.54, 1);
  destroyWhenDone(scene, ring, {
    alpha: 0,
    scaleX: Number(opts.endScaleX) || 1.55,
    scaleY: Number(opts.endScaleY) || 0.72,
    duration: Number(opts.duration) || 230,
    ease: "Cubic.easeOut",
  });
  return ring;
}


// ---------------------------------------------------------------------------
// Movement clouds
//
// Cloud shapes come from the simulated cloud system in ./clouds: soft blobs
// that melt into one pixel-art silhouette, puff out, and break into smaller
// drifting pieces as they travel. These helpers translate movement events into
// physical inputs (contact point, surface normal, impact strength, momentum),
// so the same collision looks the same on every floor and wall.
// ---------------------------------------------------------------------------

function withClouds(scene, draw) {
  const system = getCloudSystem(scene);
  if (system) draw(system.sim, system);
}

/** Paces wall-slide clouds by distance slid, so density follows speed. */
const WALL_SCRAPE_SPACING_PX = 9;

/** A compact, directional burst at the instant the player leaves the floor. */
export function spawnJumpTakeoff(scene, x, y, opts = {}) {
  if (!scene?.add) return;
  const bodyWidth = Math.max(34, Number(opts.bodyWidth) || 50);
  const velocityX = Number(opts.velocityX) || 0;
  const motionBias = Phaser.Math.Clamp(velocityX / 280, -1, 1);

  spawnGroundRing(scene, x, y - 1, bodyWidth * 1.15, {
    duration: 200,
    endScaleX: 1.42,
  });

  // The feet shove the floor backwards, so the trailing streak is the big one.
  withClouds(scene, (sim) => emitSurfaceBurst(sim, {
    x,
    y,
    nx: 0,
    ny: -1,
    strength: 0.18 + Math.abs(motionBias) * 0.2,
    bias: -motionBias * 0.85,
    pop: true,
    halfWidth: bodyWidth * 0.4,
  }));

  // Short lift lines make the impulse read immediately even at a distance.
  for (let i = 0; i < 3; i++) {
    const lift = scene.add.graphics();
    lift.setDepth(MOVEMENT_VFX_CONFIG.frontParticleDepth);
    lift.fillStyle(MOVEMENT_VFX_CONFIG.impactAccent, 0.7 - i * 0.1);
    const w = Phaser.Math.Between(2, 4);
    const h = Phaser.Math.Between(7, 12);
    lift.fillRect(-w / 2, -h, w, h);
    lift.setPosition(
      x + Phaser.Math.Between(-bodyWidth * 0.34, bodyWidth * 0.34),
      y - Phaser.Math.Between(1, 4),
    );
    lift.setBlendMode(Phaser.BlendModes.ADD);
    destroyWhenDone(scene, lift, {
      y: lift.y - Phaser.Math.Between(14, 25),
      alpha: 0,
      scaleY: 1.35,
      duration: Phaser.Math.Between(130, 190),
      ease: "Cubic.easeOut",
    });
  }
}

/** A velocity-scaled landing shockwave, rolling clouds and a debris spray. */
export function spawnLandingImpact(scene, x, y, opts = {}) {
  if (!scene?.add) return;
  const impactVelocity = Math.max(0, Number(opts.impactVelocity) || 0);
  const intensity = Phaser.Math.Clamp(
    (impactVelocity - MOVEMENT_VFX_CONFIG.landingMinVelocity) /
      (MOVEMENT_VFX_CONFIG.landingMaxVelocity -
        MOVEMENT_VFX_CONFIG.landingMinVelocity),
    0.15,
    1,
  );
  const bodyWidth = Math.max(38, Number(opts.bodyWidth) || 52);
  const radius = bodyWidth * (1.3 + intensity * 0.45);
  const fallDistance = Math.max(0, Number(opts.fallDistance) || 0);
  const showShockwave =
    fallDistance >= MOVEMENT_VFX_CONFIG.landingShockwaveMinFallPx;
  const heavy = (Number(opts.smokeMultiplier) || 1) > 1;

  if (showShockwave) {
    spawnGroundRing(scene, x, y - 1, radius, {
      strokeWidth: 3 + intensity * 2,
      duration: 250 + intensity * 90,
      endScaleX: 1.65 + intensity * 0.28,
    });
  }

  // Air squeezed out from under the feet rolls away both ways along the floor.
  withClouds(scene, (sim) => emitSurfaceBurst(sim, {
    x,
    y,
    nx: 0,
    ny: -1,
    strength: intensity * 0.75,
    bias: Phaser.Math.Clamp((Number(opts.velocityX) || 0) / 400, -0.6, 0.6),
    scale: heavy ? 1.2 : 0.85,
    pop: true,
    halfWidth: bodyWidth * 0.45,
    // A stomp is the heaviest contact there is: fully solid cloud.
    ...(heavy ? { opacity: 1 } : {}),
  }));

  const debrisCount = Math.round(2 + intensity * 4);
  for (let i = 0; i < debrisCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const debrisSize = Phaser.Math.Between(3, intensity > 0.7 ? 5 : 4);
    const debris = scene.add.rectangle(
      x + Phaser.Math.Between(-8, 8),
      y - Phaser.Math.Between(2, 7),
      debrisSize,
      Phaser.Math.Between(2, debrisSize),
      i % 3 === 0
        ? MOVEMENT_VFX_CONFIG.dustHighlight
        : MOVEMENT_VFX_CONFIG.dustTint,
      Phaser.Math.FloatBetween(0.72, 0.94),
    );
    debris.setDepth(MOVEMENT_VFX_CONFIG.frontParticleDepth);
    destroyWhenDone(scene, debris, {
      x:
        debris.x +
        side * Phaser.Math.Between(26, Math.round(48 + intensity * 28)),
      y: debris.y - Phaser.Math.Between(12, Math.round(24 + intensity * 22)),
      alpha: 0,
      rotation: Phaser.Math.FloatBetween(-2.4, 2.4),
      scaleX: 0.35,
      scaleY: 0.35,
      duration: Phaser.Math.Between(240, 380),
      ease: "Cubic.easeOut",
    });
  }

  if (showShockwave && opts.cameraShake !== false && intensity > 0.36) {
    try {
      scene.cameras?.main?.shake?.(
        45 + intensity * 32,
        0.00055 + intensity * 0.00125,
      );
    } catch (_) {}
  }
}

/** Clouds squeezed along the wall when a slide grabs on. */
export function spawnWallSlideBurst(scene, x, y, side = "left") {
  if (!scene?.add) return;
  const away = side === "left" ? 1 : -1;
  // Still travelling down on contact, so the downward streak is longer.
  withClouds(scene, (sim) => emitSurfaceBurst(sim, {
    x,
    y,
    nx: away,
    ny: 0,
    strength: 0.12,
    bias: away * 0.5,
    surfaceOffset: -0.35,
  }));
}

/**
 * Wall-slide clouds, called every frame while sliding. Blobs are laid along
 * the wall per distance slid (not per frame), so a fast slide leaves a dense
 * column and a slow one a sparse trail, at any frame rate. `owner` is any
 * object that persists for the fighter; it stores where the last blob went.
 */
export function spawnWallSlideTrail(scene, x, y, side = "left", opts = {}) {
  if (!scene?.add) return;
  const away = side === "left" ? 1 : -1;
  const owner = opts.owner || scene;
  const now = Date.now();
  const last = owner._cloudScrape;
  const fresh = !last || last.side !== side || now - last.at > 160 ||
    Math.abs(last.x - x) > 12 || Math.abs(y - last.y) > 80;
  if (fresh) {
    owner._cloudScrape = { x, y, side, at: now };
    return;
  }
  last.at = now;
  last.x = x;
  const travelled = y - last.y;
  if (travelled < WALL_SCRAPE_SPACING_PX) return;
  withClouds(scene, (sim) => {
    const speedRatio = Phaser.Math.Clamp(Number(opts.speedRatio) || 0.6, 0, 1);
    const steps = Math.min(6, Math.floor(travelled / WALL_SCRAPE_SPACING_PX));
    for (let i = 1; i <= steps; i++) {
      emitWallScrape(sim, {
        x,
        y: last.y + i * WALL_SCRAPE_SPACING_PX,
        awayX: away,
        speedRatio,
        slideVelocity: Number(opts.velocityY) || 0,
      });
    }
  });
  last.y += Math.floor(travelled / WALL_SCRAPE_SPACING_PX) * WALL_SCRAPE_SPACING_PX;
}

/** Velocity-scaled clouds kicked behind a grounded runner. */
export function spawnRunDust(scene, x, y, opts = {}) {
  if (!scene?.add) return;
  const direction = Number(opts.direction) < 0 ? -1 : 1;
  const intensity = Phaser.Math.Clamp(Number(opts.intensity) || 0.35, 0.2, 1);
  const behind = -direction;

  // Light footing: a small puff on some steps only, and none at a walk.
  if (intensity > 0.4 && Math.random() < 0.3 + intensity * 0.25) {
    withClouds(scene, (sim) => emitPuff(sim, {
      // Callers pass a point ~10px behind the body; pull it in to the heel.
      x: x - behind * Phaser.Math.Between(3, 6),
      y: y - Phaser.Math.Between(0, 1),
      vx: behind * Phaser.Math.Between(22, Math.round(30 + intensity * 14)),
      vy: -Phaser.Math.Between(2, 5),
      size: 4 + intensity * 2.5 + Math.random(),
      lobes: intensity > 0.7 ? 2 : 1,
      // Kicked back off the heel, then the puff curls up and over.
      curl: -behind * Phaser.Math.FloatBetween(5.5, 7.5),
      drag: 3,
      rise: 18,
      lifeScale: 0.55,
      erodeRate: 20,
      opacity: 0.74 + intensity * 0.08,
    }));
  }

  if (Math.random() < 0.35 + intensity * 0.3) {
    const chip = scene.add.rectangle(
      Math.round(x + behind * Phaser.Math.Between(1, 6)),
      Math.round(y - Phaser.Math.Between(2, 6)),
      3,
      3,
      MOVEMENT_VFX_CONFIG.dustTint,
      0.7,
    );
    chip.setDepth(MOVEMENT_VFX_CONFIG.frontParticleDepth);
    destroyWhenDone(scene, chip, {
      x: chip.x + behind * Phaser.Math.Between(10, Math.round(16 + intensity * 12)),
      y: chip.y - Phaser.Math.Between(5, 12),
      alpha: 0,
      duration: Phaser.Math.Between(150, 230),
      ease: "Cubic.easeOut",
    });
  }
}

/** A planted-foot skid burst when grounded input reverses direction. */
export function spawnDirectionChangeBurst(scene, x, y, opts = {}) {
  if (!scene?.add) return;
  const previousDirection = Number(opts.previousDirection) < 0 ? -1 : 1;
  const speedRatio = Phaser.Math.Clamp(Number(opts.speedRatio) || 0.4, 0.25, 1);

  // Momentum carries the skid cloud the way the player was going.
  withClouds(scene, (sim) => emitSurfaceBurst(sim, {
    x,
    y,
    nx: 0,
    ny: -1,
    strength: 0.12 + speedRatio * 0.3,
    bias: previousDirection * 0.9,
  }));

  for (let i = 0; i < 4; i++) {
    const size = Phaser.Math.Between(3, 5);
    const block = scene.add.rectangle(
      x + Phaser.Math.Between(-6, 6),
      y - Phaser.Math.Between(1, 6),
      size,
      size,
      i % 2 === 0
        ? MOVEMENT_VFX_CONFIG.dustHighlight
        : MOVEMENT_VFX_CONFIG.dustTint,
      Phaser.Math.FloatBetween(0.68, 0.94),
    );
    block.setDepth(MOVEMENT_VFX_CONFIG.frontParticleDepth);
    destroyWhenDone(scene, block, {
      x:
        block.x +
        previousDirection *
          Phaser.Math.Between(24, Math.round(46 + speedRatio * 24)),
      y: block.y - Phaser.Math.Between(7, Math.round(15 + speedRatio * 12)),
      alpha: 0,
      rotation: Phaser.Math.FloatBetween(-1.2, 1.2),
      duration: Phaser.Math.Between(200, 320),
      ease: "Cubic.easeOut",
    });
  }

  spawnGroundRing(scene, x, y, 40 + speedRatio * 30, {
    duration: 190,
    endScaleX: 1.35,
    strokeWidth: 3,
  });
}

/** Segmented vertical speed lines that intensify during a fast fall. */
export function spawnFastFallTrail(scene, sprite, opts = {}) {
  if (!scene?.add || !sprite) return;
  const body = sprite.body;
  const velocityY = Math.max(0, Number(opts.velocityY) || 0);
  const intensity = Phaser.Math.Clamp(
    (velocityY - MOVEMENT_VFX_CONFIG.fastFallStartVelocity) /
      (MOVEMENT_VFX_CONFIG.fastFallMaxVelocity -
        MOVEMENT_VFX_CONFIG.fastFallStartVelocity),
    0.12,
    1,
  );
  const centerX = Number(body?.center?.x) || Number(sprite.x) || 0;
  const top = Number(body?.top) || Number(sprite.y) - 36;
  const width = Math.max(
    34,
    Number(body?.width) || Number(sprite.displayWidth) || 50,
  );
  const lineCount = Math.round(2 + intensity * 4);

  for (let i = 0; i < lineCount; i++) {
    const line = scene.add.graphics();
    line.setDepth(MOVEMENT_VFX_CONFIG.behindPlayerDepth);
    const pixel = Phaser.Math.Between(2, intensity > 0.65 ? 4 : 3);
    const length = Phaser.Math.Between(12, Math.round(22 + intensity * 30));
    line.fillStyle(
      i % 3 === 0
        ? MOVEMENT_VFX_CONFIG.dustHighlight
        : MOVEMENT_VFX_CONFIG.impactAccent,
      Phaser.Math.FloatBetween(0.35, 0.72),
    );
    line.fillRect(-pixel / 2, 0, pixel, Math.round(length * 0.45));
    line.fillRect(-pixel / 2, Math.round(length * 0.62), pixel, length * 0.22);
    line.setPosition(
      Math.round(
        centerX + Phaser.Math.Between(-width * 0.82, width * 0.82),
      ),
      Math.round(top - Phaser.Math.Between(0, 24)),
    );
    line.setBlendMode(Phaser.BlendModes.ADD);
    destroyWhenDone(scene, line, {
      y: line.y - Phaser.Math.Between(18, Math.round(30 + intensity * 28)),
      alpha: 0,
      scaleY: 1.15 + intensity * 0.55,
      duration: Phaser.Math.Between(150, 240),
      ease: "Cubic.easeOut",
    });
  }
}


/**
 * Wall kick: a hard push-off. A flash and a pixel pressure arc leave the wall,
 * clouds squeeze out along the wall both ways, and if `opts.follow` (the
 * fighter's sprite) is given, a tapering wake trails the launch for a moment
 * and breaks up behind it.
 */
export function spawnWallKickCloud(scene, x, y, direction = 1, opts = {}) {
  if (!scene || !scene.add) return;
  const push = direction >= 0 ? 1 : -1;

  const flash = scene.add.graphics();
  flash.setDepth(MOVEMENT_VFX_CONFIG.frontParticleDepth);
  flash.fillStyle(MOVEMENT_VFX_CONFIG.impactAccent, 0.92);
  flash.fillRect(push > 0 ? 0 : -4, -24, 4, 48);
  flash.fillStyle(MOVEMENT_VFX_CONFIG.impactAccent, 0.55);
  flash.fillRect(push > 0 ? 4 : -8, -14, 4, 28);
  flash.setPosition(Math.round(x), Math.round(y));
  flash.setBlendMode(Phaser.BlendModes.ADD);
  destroyWhenDone(scene, flash, {
    alpha: 0,
    scaleY: 1.35,
    duration: 130,
    ease: "Quad.easeOut",
  });

  // Stepped ")" arc that travels off the wall like a pressure wave.
  const arc = scene.add.graphics();
  arc.setDepth(MOVEMENT_VFX_CONFIG.frontParticleDepth);
  const step = 3;
  const half = 8;
  for (let k = -half; k <= half; k++) {
    const bend = Math.round((1 - (k / half) ** 2) * 3) * step;
    arc.fillStyle(MOVEMENT_VFX_CONFIG.impactAccent, 0.85 - Math.abs(k / half) * 0.45);
    arc.fillRect(push * bend - (push > 0 ? 0 : step), k * step, step, step);
  }
  arc.setPosition(Math.round(x + push * 4), Math.round(y));
  arc.setBlendMode(Phaser.BlendModes.ADD);
  destroyWhenDone(scene, arc, {
    x: arc.x + push * 34,
    alpha: 0,
    scaleY: 1.4,
    scaleX: 1.3,
    duration: 220,
    ease: "Cubic.easeOut",
  });

  withClouds(scene, (sim, system) => {
    emitSurfaceBurst(sim, {
      x,
      y,
      nx: push,
      ny: 0,
      strength: 0.38,
      // The kick drives up and away, so more air escapes downward.
      bias: push * 0.35,
      scale: 0.85,
      rise: 10,
    });
    const target = opts.follow;
    if (target) {
      system.follow(target, {
        durationMs: 170,
        spacing: 10,
        offsetY: 6,
        emit: (s, wx, wy, progress) => emitWake(s, {
          x: wx,
          y: wy,
          size: 9,
          progress,
          vx: -push * 25,
          vy: 10,
        }),
      });
    }
  });

  // Horizontal speed lines sell the impulse.
  for (let i = 0; i < 4; i++) {
    const streak = scene.add.graphics();
    streak.setDepth(MOVEMENT_VFX_CONFIG.behindPlayerDepth);
    streak.fillStyle(MOVEMENT_VFX_CONFIG.impactAccent, Phaser.Math.FloatBetween(0.5, 0.78));
    const pixel = Phaser.Math.Between(2, 3);
    const length = Phaser.Math.Between(30, 52);
    const first = Math.round(length * 0.45);
    const gapEnd = Math.round(length * 0.62);
    const last = Math.round(length * 0.22);
    streak.fillRect(push > 0 ? 0 : -first, -pixel / 2, first, pixel);
    streak.fillRect(push > 0 ? gapEnd : -gapEnd - last, -pixel / 2, last, pixel);
    streak.setPosition(
      Math.round(x + push * Phaser.Math.Between(2, 14)),
      Math.round(y + (i - 1.5) * 11 + Phaser.Math.Between(-2, 2)),
    );
    streak.setBlendMode(Phaser.BlendModes.ADD);
    destroyWhenDone(scene, streak, {
      x: streak.x + push * Phaser.Math.Between(28, 52),
      alpha: 0,
      scaleX: Phaser.Math.FloatBetween(1.3, 1.65),
      duration: Phaser.Math.Between(200, 280),
      ease: "Cubic.easeOut",
    });
  }
}

export function spawnHealthMarker(scene, x, y, delta, opts = {}) {
  if (!scene || !scene.add) return null;
  if (!Number.isFinite(delta) || delta === 0) return null;
  const rounded = Math.round(delta);
  if (rounded === 0) return null;
  const positive = rounded > 0;
  const self = opts.isSelf === true;
  const teammate = !self &&
    (opts.team === "ally" || opts.team === "teammate" || opts.team === true);
  // Bright fills over a near-black outline keep numbers readable on any map.
  const color = positive
    ? teammate ? "#7dffc0" : self ? "#ffffff" : "#ffd0d0"
    : self ? "#ff8a8a" : "#ff4a4a";
  const strokeColor = "#0d0a14";
  const shadowColor = positive
    ? teammate ? "#0a5c3c" : self ? "#4a5568" : "#7a1f2a"
    : "#8a1010";
  const label = `${positive ? "+" : "-"}${Math.abs(rounded)}`;
  // Combat numbers should remain legible above sprites, attacks, and HUD text.
  const depth = Math.max(
    RENDER_LAYERS.ATTACKS + 2,
    typeof opts.depth === "number" ? opts.depth : 0,
  );
  const marker = scene.add.text(x, y - 5, label, {
    fontFamily: "'Press Start 2P', monospace",
    fontSize: opts.fontSize || "12px",
    color,
    stroke: strokeColor,
    strokeThickness: 5,
    padding: { x: 8, y: 6 },
  });
  marker.setOrigin(0.5);
  marker.setDepth(depth);
  // Hard offset shadow (no blur) for a chunky pixel look.
  marker.setShadow(0, 3, shadowColor, 0, true, true);
  // Small hits (multi-hit attacks, ticks) draw smaller so they don't flood the screen.
  const sizeScale = Math.abs(rounded) < 200 ? 0.78 : 0.95;
  marker.setScale(0.65 * sizeScale);
  const float = opts.floatDistance || 28;
  const duration = opts.duration || 820;
  // Exclude transparent text padding and the outline, leaving a small gap.
  // Only part of the drift is reserved so stacked numbers sit close together.
  // Neighbours may overlap slightly so bursts of hits stay packed together.
  const halfWidth = ((marker.width - 16) * 0.5 - 1) * sizeScale * 0.8;
  const halfHeight = ((marker.height - 12) * 0.5 - 2) * sizeScale * 0.7;
  const reservedDrift = float * 0.15;
  const occupied = [...markerPool]
    .filter((other) => other.active && other.scene === scene)
    .map((other) => other._healthMarkerBounds)
    .filter(Boolean);
  // A closest free position lies at the hit point or at an occupied edge.
  // Try those positions by radius instead of spreading hits across wide columns.
  const xs = new Set([x]);
  const ys = new Set([y - 5]);
  for (const reserved of occupied) {
    xs.add(reserved.left - halfWidth);
    xs.add(reserved.right + halfWidth);
    ys.add(reserved.top - halfHeight);
    ys.add(reserved.bottom + reservedDrift + halfHeight);
  }
  const positions = [...xs].flatMap((px) => [...ys].map((py) => ({
    x: px,
    y: py,
    distance: (px - x) ** 2 + (py - (y - 5)) ** 2,
  })));
  positions.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  let markerX = x;
  let markerY = y - 5;
  let bounds;
  for (const position of positions) {
    markerX = position.x;
    markerY = position.y;
    bounds = {
      left: markerX - halfWidth, right: markerX + halfWidth,
      top: markerY - reservedDrift - halfHeight, bottom: markerY + halfHeight,
    };
    const overlaps = occupied.some((reserved) => {
      return bounds.left < reserved.right && bounds.right > reserved.left &&
        bounds.top < reserved.bottom && bounds.bottom > reserved.top;
    });
    if (!overlaps) break;
  }
  marker.setPosition(markerX, markerY);
  marker._healthMarkerBounds = bounds;
  markerPool.add(marker);
  marker.once("destroy", () => markerPool.delete(marker));
  scene.tweens.add({
    targets: marker,
    scale: 1.15 * sizeScale,
    duration: 110,
    ease: "Back.easeOut",
    onComplete: () => {
      if (!marker.active) return;
      scene.tweens.add({
        targets: marker,
        scale: sizeScale,
        angle: 0,
        duration: 160,
        ease: "Sine.easeOut",
      });
    },
  });
  scene.tweens.add({
    targets: marker,
    y: markerY - float,
    duration,
    ease: "Cubic.easeOut",
  });
  scene.tweens.add({
    targets: marker,
    alpha: 0,
    delay: duration * 0.5,
    duration: duration * 0.5,
    ease: "Sine.easeIn",
    onComplete: () => {
      scene.tweens.killTweensOf(marker);
      markerPool.delete(marker);
      marker.destroy();
    },
  });
  return marker;
}

export function spawnDamageImpact(scene, sprite, opts = {}) {
  if (!scene?.add || !sprite?.active) return;

  const body = sprite.body;
  const cx = Number(body?.center?.x) || sprite.x;
  const cy = Number(body?.center?.y) || sprite.y;
  const top = Number(body?.top) || cy - (sprite.height || 80) * 0.5;
  const bottom = Number(body?.bottom) || cy + (sprite.height || 80) * 0.5;
  const left = Number(body?.left) || cx - (sprite.width || 60) * 0.5;
  const right = Number(body?.right) || cx + (sprite.width || 60) * 0.5;
  const color = opts.color || 0xff4d6d;
  const glowColor = opts.glowColor || 0xff9aa2;
  const depth =
    typeof opts.depth === "number" ? opts.depth : RENDER_LAYERS.PLAYER_HUD;

  const flash = scene.add.ellipse(
    cx,
    cy,
    Math.max(34, right - left + 18),
    Math.max(44, bottom - top + 18),
    color,
    0.22,
  );
  flash.setDepth(depth);
  flash.setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: flash,
    alpha: 0,
    scaleX: 1.35,
    scaleY: 1.35,
    duration: 140,
    ease: "Quad.easeOut",
    onComplete: () => flash.destroy(),
  });

  const ring = scene.add.circle(
    cx,
    cy,
    Math.max(18, (right - left) * 0.36),
    color,
    0.14,
  );
  ring.setDepth(depth);
  ring.setStrokeStyle(4, glowColor, 0.95);
  ring.setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: ring,
    alpha: 0,
    scaleX: 1.6,
    scaleY: 1.6,
    duration: 190,
    ease: "Cubic.easeOut",
    onComplete: () => ring.destroy(),
  });

  const particleCount = Phaser.Math.Between(6, 10);
  for (let i = 0; i < particleCount; i++) {
    const p = scene.add.circle(
      Phaser.Math.Between(left, right),
      Phaser.Math.Between(top, bottom),
      Phaser.Math.Between(3, 6),
      i % 3 === 0 ? glowColor : color,
      Phaser.Math.FloatBetween(0.72, 0.95),
    );
    p.setDepth(depth);
    p.setBlendMode(Phaser.BlendModes.ADD);
    const angle = Phaser.Math.FloatBetween(-Math.PI, Math.PI);
    const speed = Phaser.Math.Between(26, 58);
    scene.tweens.add({
      targets: p,
      x: p.x + Math.cos(angle) * speed,
      y: p.y + Math.sin(angle) * speed,
      alpha: 0,
      scaleX: Phaser.Math.FloatBetween(0.8, 1.8),
      scaleY: Phaser.Math.FloatBetween(0.8, 1.8),
      duration: Phaser.Math.Between(140, 220),
      ease: "Cubic.easeOut",
      onComplete: () => p.destroy(),
    });
  }

  for (let i = 0; i < 3; i++) {
    const g = scene.add.graphics();
    g.setDepth(depth);
    g.fillStyle(glowColor, 0.88 - i * 0.18);
    const w = Phaser.Math.Between(18, 26);
    const h = Phaser.Math.Between(4, 6);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 2);
    g.x = cx + Phaser.Math.Between(-8, 8);
    g.y = cy + Phaser.Math.Between(-10, 10);
    g.rotation = Phaser.Math.FloatBetween(-1.1, 1.1);
    g.setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: g,
      x: g.x + Phaser.Math.Between(-26, 26),
      y: g.y + Phaser.Math.Between(-26, 26),
      alpha: 0,
      scaleX: 1.8,
      duration: 150,
      ease: "Sine.easeOut",
      onComplete: () => g.destroy(),
    });
  }
}

export function spawnDuckGuardImpact(scene, sprite) {
  if (!scene?.add || !sprite?.active) return;
  const textureKey = "duck-guard-impact";
  if (!scene.textures.exists(textureKey)) return;

  // The supplied sheet has 13 columns of 64px cells; row six is white.
  const animationKey = "duck-guard-impact-white";
  if (!scene.anims.exists(animationKey)) {
    scene.anims.create({
      key: animationKey,
      frames: scene.anims.generateFrameNumbers(textureKey, { start: 65, end: 77 }),
      frameRate: 24,
      repeat: 0,
    });
  }

  const body = sprite.body;
  const cx = Number(body?.center?.x) || sprite.x;
  const cy = Number(body?.center?.y) || sprite.y;
  const impact = scene.add.sprite(cx, cy, textureKey, 65);
  impact.setOrigin(0.5);
  impact.setScale(2);
  impact.setDepth(RENDER_LAYERS.PLAYER_HUD + 3);
  impact.once("animationcomplete", () => impact.destroy());
  impact.play(animationKey);

  const radius = Math.max(34, Math.hypot(body?.width || 46, body?.height || 42) / 2 + 10) * 0.8;
  const bubble = scene.add.circle(cx, cy, radius, 0xffffff, 0.5);
  bubble.setStrokeStyle(3, 0xffffff, 1);
  bubble.setDepth(RENDER_LAYERS.PLAYER_HUD + 2);
  scene.tweens.add({
    targets: bubble,
    alpha: 0,
    scale: 1.15,
    duration: 540,
    ease: "Quad.easeOut",
    onUpdate: () => {
      if (!sprite.active) { bubble.setVisible(false); return; }
      bubble.setPosition(sprite.body?.center?.x ?? sprite.x, sprite.body?.center?.y ?? sprite.y);
    },
    onComplete: () => bubble.destroy(),
  });
}

export function spawnDeathBurst(scene, sprite, opts = {}) {
  if (!scene?.add || !sprite) return;

  const body = sprite.body;
  const cx = Number(body?.center?.x) || Number(sprite.x) || 0;
  const cy = Number(body?.center?.y) || Number(sprite.y) || 0;
  const color = opts.color || 0xff8fb1;
  const glowColor = opts.glowColor || 0xffd3df;
  const depth =
    typeof opts.depth === "number" ? opts.depth : RENDER_LAYERS.PLAYER_HUD;

  const core = scene.add.circle(cx, cy, 26, color, 0.24);
  core.setDepth(depth);
  core.setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: core,
    alpha: 0,
    scaleX: 2.2,
    scaleY: 2.2,
    duration: 260,
    ease: "Cubic.easeOut",
    onComplete: () => core.destroy(),
  });

  const halo = scene.add.circle(cx, cy, 40, glowColor, 0.12);
  halo.setDepth(depth);
  halo.setStrokeStyle(5, glowColor, 0.95);
  halo.setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: halo,
    alpha: 0,
    scaleX: 1.8,
    scaleY: 1.8,
    duration: 340,
    ease: "Cubic.easeOut",
    onComplete: () => halo.destroy(),
  });

  for (let i = 0; i < 12; i++) {
    const spark = scene.add.circle(
      cx,
      cy,
      Phaser.Math.Between(3, 6),
      i % 3 === 0 ? glowColor : color,
      Phaser.Math.FloatBetween(0.72, 0.96),
    );
    spark.setDepth(depth);
    spark.setBlendMode(Phaser.BlendModes.ADD);
    const angle =
      (Math.PI * 2 * i) / 12 + Phaser.Math.FloatBetween(-0.12, 0.12);
    const speed = Phaser.Math.Between(44, 96);
    scene.tweens.add({
      targets: spark,
      x: cx + Math.cos(angle) * speed,
      y: cy + Math.sin(angle) * speed,
      alpha: 0,
      scaleX: Phaser.Math.FloatBetween(0.8, 1.6),
      scaleY: Phaser.Math.FloatBetween(0.8, 1.6),
      duration: Phaser.Math.Between(220, 320),
      ease: "Cubic.easeOut",
      onComplete: () => spark.destroy(),
    });
  }

  for (let i = 0; i < 5; i++) {
    const streak = scene.add.graphics();
    streak.setDepth(depth);
    streak.fillStyle(glowColor, 0.9 - i * 0.1);
    const w = Phaser.Math.Between(18, 28);
    const h = Phaser.Math.Between(4, 6);
    streak.fillRoundedRect(-w / 2, -h / 2, w, h, 2);
    streak.x = cx;
    streak.y = cy;
    streak.rotation = Phaser.Math.FloatBetween(-Math.PI, Math.PI);
    streak.setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: streak,
      x: cx + Math.cos(streak.rotation) * Phaser.Math.Between(52, 88),
      y: cy + Math.sin(streak.rotation) * Phaser.Math.Between(52, 88),
      alpha: 0,
      scaleX: 1.9,
      duration: Phaser.Math.Between(200, 280),
      ease: "Sine.easeOut",
      onComplete: () => streak.destroy(),
    });
  }
}

export function spawnSpawnBurst(scene, sprite, opts = {}) {
  if (!scene?.add || !sprite) return;

  const body = sprite.body;
  const cx = Number(body?.center?.x) || Number(sprite.x) || 0;
  const cy = Number(body?.center?.y) || Number(sprite.y) || 0;
  const top =
    Number(body?.top) ||
    cy - (Number(body?.height) || Number(sprite.height) || 82) * 0.5;
  const bottom =
    Number(body?.bottom) ||
    cy + (Number(body?.height) || Number(sprite.height) || 82) * 0.5;
  const halfWidth = Math.max(
    16,
    (Number(body?.width) || Number(sprite.width) || 54) * 0.5 + 6,
  );
  const height = Math.max(52, bottom - top + 18);
  const baseRadius = Number(opts.radius) || Math.max(28, halfWidth + 8);
  const tint = opts.tint || 0xf8fafc;
  const accent = opts.accent || 0xb8ecff;
  const depth =
    typeof opts.depth === "number" ? opts.depth : RENDER_LAYERS.PLAYER_HUD;

  const column = scene.add.ellipse(
    cx,
    cy - 3,
    halfWidth * 2.8,
    height,
    accent,
    0.12,
  );
  column.setDepth(depth - 2);
  column.setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: column,
    alpha: 0,
    scaleX: 1.18,
    scaleY: 1.05,
    duration: 440,
    ease: "Quad.easeOut",
    onComplete: () => column.destroy(),
  });

  const coreGlow = scene.add.ellipse(
    cx,
    cy,
    halfWidth * 1.9,
    height * 0.88,
    tint,
    0.16,
  );
  coreGlow.setDepth(depth - 1);
  coreGlow.setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: coreGlow,
    alpha: 0,
    scaleX: 0.94,
    scaleY: 1.12,
    duration: 320,
    ease: "Cubic.easeOut",
    onComplete: () => coreGlow.destroy(),
  });

  const groundFlash = scene.add.ellipse(
    cx,
    bottom - 4,
    baseRadius * 2.2,
    Math.max(12, baseRadius * 0.68),
    accent,
    0.2,
  );
  groundFlash.setDepth(depth - 1);
  groundFlash.setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: groundFlash,
    alpha: 0,
    scaleX: 1.35,
    scaleY: 1.1,
    duration: 380,
    ease: "Quad.easeOut",
    onComplete: () => groundFlash.destroy(),
  });

  const ringSteps = [0.04, 0.28, 0.52, 0.76, 0.94];
  ringSteps.forEach((step, index) => {
    const ringY = bottom - height * step;
    const ring = scene.add.ellipse(
      cx,
      ringY,
      baseRadius * (1.55 + step * 0.3),
      Math.max(10, baseRadius * (0.32 + step * 0.04)),
      accent,
      0,
    );
    ring.setDepth(depth + index);
    ring.setStrokeStyle(
      index % 2 === 0 ? 5 : 3,
      index % 2 === 0 ? tint : accent,
      0.95 - index * 0.1,
    );
    ring.setBlendMode(Phaser.BlendModes.ADD);
    ring.scaleX = 0.74;
    ring.scaleY = 0.74;
    scene.tweens.add({
      targets: ring,
      alpha: 0,
      scaleX: 1.14 + index * 0.04,
      scaleY: 1.06 + index * 0.03,
      y: ringY - 10 + index * 2,
      duration: 260 + index * 45,
      delay: index * 26,
      ease: "Cubic.easeOut",
      onComplete: () => ring.destroy(),
    });
  });

  for (let i = 0; i < 22; i++) {
    const spark = scene.add.circle(
      cx + Phaser.Math.Between(-halfWidth, halfWidth),
      bottom - Phaser.Math.FloatBetween(0, height),
      Phaser.Math.Between(1, 3),
      i % 4 === 0 ? tint : accent,
      Phaser.Math.FloatBetween(0.7, 0.96),
    );
    spark.setDepth(depth + 6);
    spark.setBlendMode(Phaser.BlendModes.ADD);
    const driftX = Phaser.Math.Between(-10, 10);
    const rise = Phaser.Math.Between(18, 44);
    scene.tweens.add({
      targets: spark,
      x: spark.x + driftX,
      y: spark.y - rise,
      alpha: 0,
      scaleX: Phaser.Math.FloatBetween(0.8, 1.8),
      scaleY: Phaser.Math.FloatBetween(1.2, 2.1),
      duration: Phaser.Math.Between(180, 320),
      delay: Phaser.Math.Between(0, 90),
      ease: "Cubic.easeOut",
      onComplete: () => spark.destroy(),
    });
  }

  for (let i = 0; i < 12; i++) {
    const strand = scene.add.graphics();
    strand.setDepth(depth + 2);
    strand.fillStyle(i % 3 === 0 ? tint : accent, 0.8);
    const w = Phaser.Math.Between(2, 4);
    const h = Phaser.Math.Between(18, 30);
    strand.fillRoundedRect(-w / 2, -h / 2, w, h, 2);
    strand.x = cx + Phaser.Math.Between(-halfWidth + 4, halfWidth - 4);
    strand.y = bottom - Phaser.Math.Between(4, 20);
    strand.setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: strand,
      y: strand.y - Phaser.Math.Between(height * 0.45, height * 0.85),
      alpha: 0,
      scaleY: Phaser.Math.FloatBetween(1.1, 1.8),
      duration: Phaser.Math.Between(220, 360),
      delay: Phaser.Math.Between(0, 60),
      ease: "Sine.easeOut",
      onComplete: () => strand.destroy(),
    });
  }
}

// Pixel "decloak" when the invisibility powerup ends: the sprite materializes
// through a mask of chunky cells that switch on in a loose, noisy head-to-toe
// order, while chroma pixels flicker in and out over the body. The mask is set
// synchronously so the sprite never flashes fully visible before the effect.
const CHROMA_CELL = 4;

export function spawnChromaReveal(scene, sprite, opts = {}) {
  if (!scene?.make || !scene.tweens || !sprite?.active || !sprite.frame) return;

  sprite._chromaRevealStop?.();
  const depth =
    typeof opts.depth === "number" ? opts.depth : RENDER_LAYERS.PLAYER_HUD;
  const duration = Number(opts.duration) || 520;
  const hueStart = Math.random();
  const hueAt = (h) =>
    Phaser.Display.Color.HSVToRGB(((h % 1) + 1) % 1, 0.85, 1).color;

  const cols = Math.max(1, Math.ceil(sprite.displayWidth / CHROMA_CELL));
  const rows = Math.max(1, Math.ceil(sprite.displayHeight / CHROMA_CELL));
  // Mostly top-down, with enough noise that the front stays ragged.
  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      cells.push({ r, c, jitter: Math.random(), revealed: false });
    }
  }

  const maskGraphics = scene.make.graphics({}, false);
  const mask = maskGraphics.createGeometryMask();
  sprite.setMask(mask);

  const frameBounds = () => {
    const w = Math.abs(sprite.displayWidth);
    const h = Math.abs(sprite.displayHeight);
    const left = sprite.x - sprite.originX * w;
    const top = sprite.y - sprite.originY * h;
    const body = sprite.body;
    const headTop = Math.max(top, (Number(body?.top) || top) - 10);
    const feet = Math.max(headTop + 1, Number(body?.bottom) || top + h);
    return { w, h, left, top, body, headTop, feet };
  };

  const spawnPixel = (x, y, hue) => {
    const pixel = scene.add.rectangle(
      x,
      y,
      CHROMA_CELL,
      CHROMA_CELL,
      hueAt(hue),
      0,
    );
    pixel.setOrigin(0, 0);
    pixel.setDepth(depth);
    pixel.setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: pixel,
      fillAlpha: 0.9,
      duration: Phaser.Math.Between(60, 110),
      hold: Phaser.Math.Between(20, 70),
      yoyo: true,
      ease: "Sine.easeInOut",
      onComplete: () => pixel.destroy(),
    });
  };

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (sprite._chromaRevealStop === finish) sprite._chromaRevealStop = null;
    tween?.stop();
    if (sprite.active && sprite.mask === mask) sprite.clearMask();
    mask.destroy();
    maskGraphics.destroy();
  };

  const draw = (t) => {
    const b = frameBounds();
    const cellW = b.w / cols;
    const cellH = b.h / rows;
    const span = b.feet - b.headTop;
    const bodyLeft = Number(b.body?.left) || b.left;
    const bodyRight = Number(b.body?.right) || b.left + b.w;
    maskGraphics.clear();
    maskGraphics.fillStyle(0xffffff, 1);
    for (const cell of cells) {
      const x = b.left + cell.c * cellW;
      const y = b.top + cell.r * cellH;
      const progress = Phaser.Math.Clamp((y - b.headTop) / span, 0, 1);
      const threshold = progress * 0.6 + cell.jitter * 0.4;
      if (t < threshold) continue;
      maskGraphics.fillRect(x, y, Math.ceil(cellW), Math.ceil(cellH));
      if (cell.revealed) continue;
      cell.revealed = true;
      const onBody =
        x + cellW > bodyLeft && x < bodyRight && y + cellH > b.headTop && y < b.feet;
      if (onBody && Math.random() < 0.45) {
        spawnPixel(Math.round(x), Math.round(y), hueStart + progress * 0.8 + cell.jitter * 0.2);
      }
    }
  };

  const tween = scene.tweens.addCounter({
    from: 0,
    to: 1,
    duration,
    ease: "Linear",
    onUpdate: (tw) => {
      if (!sprite.active || sprite._powerupInvisible) {
        finish();
        return;
      }
      draw(tw.getValue());
    },
    onComplete: finish,
  });
  sprite._chromaRevealStop = finish;
  draw(0);
}

export function triggerDamageScreenPulse(scene, opts = {}) {
  if (!scene) return;
  const vigEl = document.getElementById("water-vignette");
  if (!vigEl) return;

  scene._damageVignetteAlpha = opts.alpha || 0.74;
  // The looping water animation overrides inline opacity, so pause it for hits.
  vigEl.classList.remove("water-danger-active");

  try {
    scene._damageVignetteTween?.stop?.();
  } catch (_) {}
  scene._damageVignetteTween = null;

  const pulseState = { alpha: scene._damageVignetteAlpha };
  vigEl.style.opacity = String(pulseState.alpha);
  scene._damageVignetteTween = scene.tweens?.add?.({
    targets: pulseState,
    alpha: 0,
    duration: opts.durationMs || 220,
    ease: "Quad.easeOut",
    onUpdate: () => {
      vigEl.style.opacity = String(pulseState.alpha);
    },
    onComplete: () => {
      vigEl.style.opacity = "0";
      scene._damageVignetteTween = null;
    },
  });
}

// Note: character-specific effects (like Draven's fire trail) live in
// their own files under src/client/game/characters/<char>/effects.js.

/** Heavy dash-down impact: wider dust/debris and two bright pressure rings. */
export function spawnStompImpact(scene, x, y, opts = {}) {
  spawnLandingImpact(scene, x, y, { impactVelocity: 1200, fallDistance: 400,
    bodyWidth: 73.333, smokeMultiplier: 3, cameraShake: false });
  for (const [radius, delay] of [[60.133, 0], [44, 65]]) {
    const ring = scene.add.graphics().setPosition(x, y - 2).setDepth(31);
    ring.lineStyle(5, 0xb9edff, 0.95);
    ring.strokeEllipse(0, 0, radius * 2, 24);
    scene.tweens.add({ targets: ring, scaleX: 110 / radius, scaleY: 1.8,
      alpha: 0, duration: 360, delay, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  }
  if (opts.cameraShake) scene.cameras?.main?.shake?.(135, 0.0075);
}
