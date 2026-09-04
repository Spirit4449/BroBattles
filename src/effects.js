// effects.js
// Shared lightweight VFX helpers for movement, combat, and player lifecycle.
import { RENDER_LAYERS } from "./gameScene/renderLayers";

const dustPool = [];
const dustPoolMax = 120;
const markerPool = new Set();

// Central tuning for movement feedback. These effects use Phaser primitives so
// they stay crisp with the game's pixel-art renderer and require no new assets.
export const MOVEMENT_VFX_CONFIG = Object.freeze({
  dustTint: 0xd8d0c2,
  dustHighlight: 0xfff4df,
  impactAccent: 0xffffff,
  behindPlayerDepth: RENDER_LAYERS.PLAYER - 2,
  frontParticleDepth: RENDER_LAYERS.PLAYER + 1,
  landingMinVelocity: 230,
  landingMaxVelocity: 760,
  landingShockwaveMinFallPx: 150,
  wallTrailIntervalMs: 48,
  runSpeedReference: 260,
  runDustMinIntervalMs: 48,
  runDustMaxIntervalMs: 112,
  directionChangeMinSpeed: 72,
  fastFallStartVelocity: 270,
  fastFallMaxVelocity: 760,
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

function spawnMotionPuff(scene, x, y, opts = {}) {
  if (!scene?.add) return null;
  const tint = opts.tint || MOVEMENT_VFX_CONFIG.dustTint;
  const radius = Number(opts.radius) || Phaser.Math.Between(6, 10);
  const alpha = Number(opts.alpha) || Phaser.Math.FloatBetween(0.62, 0.82);
  const puff = scene.add.graphics();
  puff.setDepth(
    Number.isFinite(opts.depth)
      ? opts.depth
      : MOVEMENT_VFX_CONFIG.behindPlayerDepth,
  );
  const pixel = Math.max(2, Math.round(radius / 3));
  // Deliberately stepped blocks instead of soft circles: these retain a
  // playful pixel silhouette while scaling and fading.
  puff.fillStyle(tint, alpha * 0.42);
  puff.fillRect(-pixel * 3, 0, pixel * 2, pixel * 2);
  puff.fillRect(pixel * 2, pixel, pixel * 2, pixel * 2);
  puff.fillStyle(tint, alpha);
  puff.fillRect(-pixel * 2, -pixel, pixel * 4, pixel * 3);
  puff.fillRect(-pixel, -pixel * 2, pixel * 3, pixel * 2);
  puff.fillStyle(MOVEMENT_VFX_CONFIG.dustHighlight, alpha * 0.34);
  puff.fillRect(-pixel, -pixel * 2, pixel * 2, pixel);
  puff.setPosition(Math.round(x), Math.round(y));
  puff.setScale(Number(opts.startScale) || 0.72);

  destroyWhenDone(scene, puff, {
    x: x + (Number(opts.driftX) || 0),
    y: y + (Number(opts.driftY) || 0),
    alpha: 0,
    scaleX: Number(opts.endScaleX) || Phaser.Math.FloatBetween(1.3, 1.8),
    scaleY: Number(opts.endScaleY) || Phaser.Math.FloatBetween(1.1, 1.5),
    duration: Number(opts.duration) || Phaser.Math.Between(280, 420),
    ease: "Cubic.easeOut",
  });
  return puff;
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

/** A compact, directional burst at the instant the player leaves the floor. */
export function spawnJumpTakeoff(scene, x, y, opts = {}) {
  if (!scene?.add) return;
  const bodyWidth = Math.max(34, Number(opts.bodyWidth) || 50);
  const velocityX = Number(opts.velocityX) || 0;
  const motionBias = Phaser.Math.Clamp(velocityX / 280, -1, 1);

  spawnGroundRing(scene, x, y - 1, bodyWidth * 1.25, {
    duration: 210,
    endScaleX: 1.48,
  });

  const flash = scene.add.graphics();
  flash.setDepth(MOVEMENT_VFX_CONFIG.behindPlayerDepth);
  flash.fillStyle(MOVEMENT_VFX_CONFIG.dustHighlight, 0.28);
  flash.fillRect(-bodyWidth * 0.52, -3, bodyWidth * 1.04, 6);
  flash.fillStyle(MOVEMENT_VFX_CONFIG.dustHighlight, 0.18);
  flash.fillRect(-bodyWidth * 0.34, -7, bodyWidth * 0.68, 3);
  flash.setPosition(Math.round(x), Math.round(y - 2));
  flash.setBlendMode(Phaser.BlendModes.ADD);
  destroyWhenDone(scene, flash, {
    alpha: 0,
    scaleX: 1.35,
    scaleY: 0.55,
    duration: 140,
    ease: "Quad.easeOut",
  });

  for (let i = 0; i < 7; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const distance = Phaser.Math.Between(18, 38);
    spawnMotionPuff(
      scene,
      x + side * Phaser.Math.Between(3, Math.max(5, bodyWidth * 0.24)),
      y - Phaser.Math.Between(1, 5),
      {
        radius: Phaser.Math.Between(6, 10),
        driftX: side * distance + motionBias * 10,
        driftY: -Phaser.Math.Between(5, 16),
        duration: Phaser.Math.Between(260, 380),
        endScaleX: Phaser.Math.FloatBetween(1.35, 1.9),
        endScaleY: Phaser.Math.FloatBetween(0.9, 1.25),
      },
    );
  }

  // Short lift lines make the impulse read immediately even at a distance.
  for (let i = 0; i < 4; i++) {
    const lift = scene.add.graphics();
    lift.setDepth(MOVEMENT_VFX_CONFIG.frontParticleDepth);
    lift.fillStyle(MOVEMENT_VFX_CONFIG.impactAccent, 0.74 - i * 0.08);
    const w = Phaser.Math.Between(2, 4);
    const h = Phaser.Math.Between(7, 13);
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

/** A velocity-scaled landing shockwave, dust fan, and small debris spray. */
export function spawnLandingImpact(scene, x, y, opts = {}) {
  if (!scene?.add) return;
  const impactVelocity = Math.max(0, Number(opts.impactVelocity) || 0);
  const intensity = Phaser.Math.Clamp(
    (impactVelocity - MOVEMENT_VFX_CONFIG.landingMinVelocity) /
      (MOVEMENT_VFX_CONFIG.landingMaxVelocity -
        MOVEMENT_VFX_CONFIG.landingMinVelocity),
    0.28,
    1,
  );
  const bodyWidth = Math.max(38, Number(opts.bodyWidth) || 52);
  const radius = bodyWidth * (1.3 + intensity * 0.45);
  const fallDistance = Math.max(0, Number(opts.fallDistance) || 0);
  const showShockwave =
    fallDistance >= MOVEMENT_VFX_CONFIG.landingShockwaveMinFallPx;

  if (showShockwave) {
    spawnGroundRing(scene, x, y - 1, radius, {
      strokeWidth: 3 + intensity * 2,
      duration: 250 + intensity * 90,
      endScaleX: 1.65 + intensity * 0.28,
    });
  }

  const groundFlash = scene.add.graphics();
  groundFlash.setDepth(MOVEMENT_VFX_CONFIG.behindPlayerDepth);
  groundFlash.fillStyle(
    MOVEMENT_VFX_CONFIG.dustHighlight,
    0.18 + intensity * 0.16,
  );
  const impactPlateWidth = showShockwave ? radius * 1.3 : bodyWidth * 0.68;
  groundFlash.fillRect(-impactPlateWidth * 0.5, -3, impactPlateWidth, 6);
  groundFlash.fillStyle(MOVEMENT_VFX_CONFIG.dustHighlight, 0.13);
  groundFlash.fillRect(
    -impactPlateWidth * 0.3,
    -8,
    impactPlateWidth * 0.6,
    4,
  );
  groundFlash.setPosition(Math.round(x), Math.round(y - 2));
  groundFlash.setBlendMode(Phaser.BlendModes.ADD);
  destroyWhenDone(scene, groundFlash, {
    alpha: 0,
    scaleX: showShockwave ? 1.4 + intensity * 0.25 : 1.08,
    scaleY: 0.62,
    duration: 160 + intensity * 70,
    ease: "Quad.easeOut",
  });

  const puffCount = Math.round(7 + intensity * 5);
  for (let i = 0; i < puffCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const lateralSpeed = Phaser.Math.Between(
      24,
      Math.round(44 + intensity * 34),
    );
    spawnMotionPuff(
      scene,
      x + side * Phaser.Math.Between(2, Math.max(6, bodyWidth * 0.38)),
      y - Phaser.Math.Between(0, 6),
      {
        radius: Phaser.Math.Between(7, Math.round(10 + intensity * 4)),
        alpha: Phaser.Math.FloatBetween(0.66, 0.9),
        driftX: side * lateralSpeed,
        driftY: -Phaser.Math.Between(6, Math.round(16 + intensity * 14)),
        duration: Phaser.Math.Between(310, 470),
        endScaleX: Phaser.Math.FloatBetween(1.5, 2.15),
        endScaleY: Phaser.Math.FloatBetween(1, 1.35),
      },
    );
  }

  const debrisCount = Math.round(4 + intensity * 5);
  for (let i = 0; i < debrisCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const debrisSize = Phaser.Math.Between(3, intensity > 0.7 ? 6 : 4);
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

/** Initial scrape accent when entering a wall slide. */
export function spawnWallSlideBurst(scene, x, y, side = "left") {
  if (!scene?.add) return;
  const away = side === "left" ? 1 : -1;

  const contactFlash = scene.add.graphics();
  contactFlash.setDepth(MOVEMENT_VFX_CONFIG.frontParticleDepth);
  contactFlash.fillStyle(MOVEMENT_VFX_CONFIG.dustHighlight, 0.86);
  contactFlash.fillRect(-2, -21, 4, 42);
  contactFlash.fillRect(away > 0 ? 2 : -10, -13, 8, 5);
  contactFlash.fillRect(away > 0 ? 2 : -14, 2, 12, 5);
  contactFlash.fillStyle(MOVEMENT_VFX_CONFIG.dustTint, 0.72);
  contactFlash.fillRect(away > 0 ? 4 : -10, 12, 6, 5);
  contactFlash.setPosition(Math.round(x), Math.round(y));
  contactFlash.setBlendMode(Phaser.BlendModes.ADD);
  destroyWhenDone(scene, contactFlash, {
    x: x + away * 8,
    alpha: 0,
    scaleX: 1.5,
    scaleY: 1.18,
    duration: 190,
    ease: "Quad.easeOut",
  });

  for (let i = 0; i < 8; i++) {
    spawnMotionPuff(
      scene,
      x + away * Phaser.Math.Between(1, 4),
      y + Phaser.Math.Between(-14, 14),
      {
        radius: Phaser.Math.Between(5, 10),
        driftX: away * Phaser.Math.Between(18, 38),
        driftY: Phaser.Math.Between(-22, 9),
        duration: Phaser.Math.Between(250, 370),
      },
    );
  }
}

/** One throttled wall-scrape emission; callers control the cadence. */
export function spawnWallSlideTrail(scene, x, y, side = "left") {
  if (!scene?.add) return;
  const away = side === "left" ? 1 : -1;
  spawnMotionPuff(
    scene,
    x + away * Phaser.Math.Between(1, 4),
    y + Phaser.Math.Between(-4, 7),
    {
      radius: Phaser.Math.Between(4, 7),
      alpha: Phaser.Math.FloatBetween(0.52, 0.72),
      driftX: away * Phaser.Math.Between(11, 23),
      driftY: -Phaser.Math.Between(5, 14),
      duration: Phaser.Math.Between(240, 330),
      endScaleX: Phaser.Math.FloatBetween(1.2, 1.6),
      endScaleY: Phaser.Math.FloatBetween(1, 1.3),
    },
  );

  // A chunky contact tick makes every scrape pulse readable. Alternating its
  // vertical placement keeps the slide lively without moving the player body.
  const gripTick = scene.add.graphics();
  gripTick.setDepth(MOVEMENT_VFX_CONFIG.frontParticleDepth);
  gripTick.fillStyle(MOVEMENT_VFX_CONFIG.dustHighlight, 0.82);
  gripTick.fillRect(away > 0 ? 0 : -11, -2, 11, 4);
  gripTick.fillRect(away > 0 ? 2 : -8, -6, 6, 3);
  gripTick.setPosition(Math.round(x), Math.round(y));
  gripTick.setBlendMode(Phaser.BlendModes.ADD);
  destroyWhenDone(scene, gripTick, {
    x: gripTick.x + away * Phaser.Math.Between(12, 20),
    y: gripTick.y + Phaser.Math.Between(4, 12),
    alpha: 0,
    scaleX: 1.3,
    duration: Phaser.Math.Between(110, 170),
    ease: "Cubic.easeOut",
  });

  for (let i = 0; i < 2; i++) {
    const chunkSize = Phaser.Math.Between(3, 6);
    const chunk = scene.add.rectangle(
      x,
      y + Phaser.Math.Between(-7, 8),
      chunkSize,
      chunkSize,
      i === 0
        ? MOVEMENT_VFX_CONFIG.dustTint
        : MOVEMENT_VFX_CONFIG.dustHighlight,
      Phaser.Math.FloatBetween(0.66, 0.92),
    );
    chunk.setDepth(MOVEMENT_VFX_CONFIG.frontParticleDepth);
    destroyWhenDone(scene, chunk, {
      x: chunk.x + away * Phaser.Math.Between(13, 29),
      y: chunk.y + Phaser.Math.Between(12, 30),
      alpha: 0,
      rotation: Phaser.Math.FloatBetween(-1.6, 1.6),
      duration: Phaser.Math.Between(160, 250),
      ease: "Cubic.easeIn",
    });
  }

  if (Math.random() < 0.72) {
    const fleck = scene.add.graphics();
    fleck.setDepth(MOVEMENT_VFX_CONFIG.frontParticleDepth);
    fleck.fillStyle(MOVEMENT_VFX_CONFIG.dustHighlight, 0.92);
    const length = Phaser.Math.Between(6, 11);
    fleck.fillRect(-1, -length / 2, 2, length);
    fleck.setPosition(x + away * 3, y + Phaser.Math.Between(-5, 5));
    fleck.setRotation(away * Phaser.Math.FloatBetween(0.18, 0.48));
    fleck.setBlendMode(Phaser.BlendModes.ADD);
    destroyWhenDone(scene, fleck, {
      x: fleck.x + away * Phaser.Math.Between(10, 19),
      y: fleck.y + Phaser.Math.Between(13, 24),
      alpha: 0,
      scaleY: 0.35,
      duration: Phaser.Math.Between(130, 190),
      ease: "Cubic.easeIn",
    });
  }
}

/** Visible, velocity-scaled dust kicked behind a grounded runner. */
export function spawnRunDust(scene, x, y, opts = {}) {
  if (!scene?.add) return;
  const direction = Number(opts.direction) < 0 ? -1 : 1;
  const intensity = Phaser.Math.Clamp(Number(opts.intensity) || 0.35, 0.2, 1);
  const behind = -direction;
  const count = Math.round(1 + intensity * 2);

  for (let i = 0; i < count; i++) {
    spawnMotionPuff(
      scene,
      x + behind * Phaser.Math.Between(2, 10),
      y - Phaser.Math.Between(1, 8),
      {
        radius: Phaser.Math.Between(5, Math.round(8 + intensity * 4)),
        alpha: Phaser.Math.FloatBetween(0.42, 0.64),
        driftX:
          behind *
          Phaser.Math.Between(12, Math.round(24 + intensity * 12)),
        driftY: -Phaser.Math.Between(6, Math.round(12 + intensity * 7)),
        duration: Phaser.Math.Between(220, 330),
        endScaleX: Phaser.Math.FloatBetween(1.2, 1.55),
        endScaleY: Phaser.Math.FloatBetween(0.85, 1.12),
      },
    );
  }

  // Chunky square flecks keep footstep dust in the same pixel language as
  // jumps, landings, and wall interactions.
  const chipCount = Math.round(1 + intensity * 2);
  for (let i = 0; i < chipCount; i++) {
    const chip = scene.add.graphics();
    chip.setDepth(MOVEMENT_VFX_CONFIG.frontParticleDepth);
    chip.fillStyle(
      i % 2 === 0
        ? MOVEMENT_VFX_CONFIG.dustHighlight
        : MOVEMENT_VFX_CONFIG.dustTint,
      Phaser.Math.FloatBetween(0.38, 0.62),
    );
    const size = Phaser.Math.Between(2, 4);
    chip.fillRect(-size / 2, -size / 2, size, size);
    chip.setPosition(
      Math.round(x + behind * Phaser.Math.Between(1, 8)),
      Math.round(y - Phaser.Math.Between(2, 7)),
    );
    destroyWhenDone(scene, chip, {
      x:
        chip.x +
        behind * Phaser.Math.Between(8, Math.round(15 + intensity * 10)),
      y: chip.y - Phaser.Math.Between(5, Math.round(9 + intensity * 6)),
      alpha: 0,
      scaleX: Phaser.Math.FloatBetween(0.55, 1.15),
      scaleY: Phaser.Math.FloatBetween(0.55, 1.15),
      duration: Phaser.Math.Between(150, 240),
      ease: "Cubic.easeOut",
    });
  }

  const groundPixel = scene.add.graphics();
  groundPixel.setDepth(MOVEMENT_VFX_CONFIG.behindPlayerDepth);
  groundPixel.fillStyle(MOVEMENT_VFX_CONFIG.dustHighlight, 0.44);
  groundPixel.fillRect(behind > 0 ? 0 : -14, -2, 14, 4);
  groundPixel.fillStyle(MOVEMENT_VFX_CONFIG.dustTint, 0.3);
  groundPixel.fillRect(behind > 0 ? 6 : -18, 3, 12, 3);
  groundPixel.setPosition(Math.round(x), Math.round(y));
  destroyWhenDone(scene, groundPixel, {
    x: groundPixel.x + behind * (12 + intensity * 10),
    alpha: 0,
    scaleX: 1.12,
    duration: 150 + intensity * 55,
    ease: "Cubic.easeOut",
  });
}

/** A planted-foot skid burst when grounded input reverses direction. */
export function spawnDirectionChangeBurst(scene, x, y, opts = {}) {
  if (!scene?.add) return;
  const previousDirection = Number(opts.previousDirection) < 0 ? -1 : 1;
  const speedRatio = Phaser.Math.Clamp(Number(opts.speedRatio) || 0.4, 0.25, 1);

  for (let i = 0; i < 9; i++) {
    const size = Phaser.Math.Between(3, 7);
    const block = scene.add.rectangle(
      x + Phaser.Math.Between(-7, 7),
      y - Phaser.Math.Between(1, 7),
      size,
      Phaser.Math.Between(3, size + 2),
      i % 3 === 0
        ? MOVEMENT_VFX_CONFIG.dustHighlight
        : MOVEMENT_VFX_CONFIG.dustTint,
      Phaser.Math.FloatBetween(0.68, 0.94),
    );
    block.setDepth(MOVEMENT_VFX_CONFIG.frontParticleDepth);
    destroyWhenDone(scene, block, {
      x:
        block.x +
        previousDirection *
          Phaser.Math.Between(24, Math.round(50 + speedRatio * 25)),
      y: block.y - Phaser.Math.Between(7, Math.round(17 + speedRatio * 14)),
      alpha: 0,
      rotation: Phaser.Math.FloatBetween(-1.2, 1.2),
      duration: Phaser.Math.Between(220, 360),
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

export function spawnDust(scene, x, y, tint = 0xbbbbbb) {
  let g = dustPool.find((o) => !o.active);
  if (!g) {
    g = scene.add.graphics();
    dustPool.push(g);
  }
  g.active = true;
  g.clear();
  g.setDepth(MOVEMENT_VFX_CONFIG.behindPlayerDepth);
  const baseSize = Phaser.Math.Between(6, 10);
  // Slightly higher starting alpha range for better visibility
  const alphaStart = Phaser.Math.FloatBetween(0.45, 0.65);
  const puffColor = Phaser.Display.Color.IntegerToColor(tint);
  const pixel = Math.max(2, Math.round(baseSize / 3));
  g.fillStyle(puffColor.color, alphaStart * 0.56);
  g.fillRect(-pixel * 3, 0, pixel * 2, pixel * 2);
  g.fillRect(pixel * 2, pixel, pixel * 2, pixel * 2);
  g.fillStyle(puffColor.color, alphaStart);
  g.fillRect(-pixel * 2, -pixel, pixel * 4, pixel * 3);
  g.fillStyle(MOVEMENT_VFX_CONFIG.dustHighlight, alphaStart * 0.42);
  g.fillRect(-pixel, -pixel * 2, pixel * 2, pixel);
  g.x = x + Phaser.Math.Between(-4, 4);
  g.y = y + Phaser.Math.Between(-2, 2);
  const rise = Phaser.Math.Between(10, 22);
  const driftX = Phaser.Math.Between(-12, 12);
  const scaleTarget = Phaser.Math.FloatBetween(1.2, 1.6);
  const duration = Phaser.Math.Between(380, 520);
  g.scale = 1;
  g.alpha = alphaStart;
  scene.tweens.add({
    targets: g,
    x: g.x + driftX,
    y: g.y - rise,
    alpha: 0,
    scale: scaleTarget,
    duration,
    ease: "Cubic.easeOut",
    onComplete: () => {
      g.active = false;
      g.alpha = 1;
      g.scale = 1;
      g.clear();
    },
  });
  if (dustPool.length > dustPoolMax) {
    const old = dustPool.find((o) => !o.active);
    if (old) {
      old.destroy();
      const idx = dustPool.indexOf(old);
      if (idx >= 0) dustPool.splice(idx, 1);
    }
  }
}

export function spawnWallKickCloud(
  scene,
  x,
  y,
  direction = 1,
  tint = 0xd9d9d9,
) {
  if (!scene || !scene.add) return;
  const puffs = Phaser.Math.Between(7, 10);
  const push = direction >= 0 ? 1 : -1;

  for (let i = 0; i < puffs; i++) {
    const g = scene.add.graphics();
    g.setDepth(MOVEMENT_VFX_CONFIG.frontParticleDepth);
    g.fillStyle(tint, Phaser.Math.FloatBetween(0.62, 0.84));
    const size = Phaser.Math.Between(4, 9);
    g.fillRect(-size / 2, -size / 2, size, size);
    if (i % 2 === 0) {
      g.fillStyle(MOVEMENT_VFX_CONFIG.dustHighlight, 0.7);
      g.fillRect(-size / 2, -size, Math.max(2, size * 0.45), size * 0.45);
    }
    g.x = x + Phaser.Math.Between(-4, 4);
    g.y = y + Phaser.Math.Between(-5, 5);

    scene.tweens.add({
      targets: g,
      x: g.x + push * Phaser.Math.Between(20, 42),
      y: g.y + Phaser.Math.Between(-24, 18),
      alpha: 0,
      scaleX: Phaser.Math.FloatBetween(1.25, 1.9),
      scaleY: Phaser.Math.FloatBetween(1.25, 1.9),
      duration: Phaser.Math.Between(250, 380),
      ease: "Cubic.easeOut",
      onComplete: () => g.destroy(),
    });
  }

  // Layered horizontal pixel bars form the wall-jump shock front.
  for (let i = 0; i < 3; i++) {
    const streak = scene.add.graphics();
    streak.setDepth(MOVEMENT_VFX_CONFIG.frontParticleDepth);
    streak.fillStyle(
      i === 0 ? MOVEMENT_VFX_CONFIG.dustHighlight : 0xffffff,
      0.82 - i * 0.12,
    );
    const width = 16 + i * 6;
    const height = i === 0 ? 5 : 3;
    streak.fillRect(push > 0 ? 0 : -width, -height / 2, width, height);
    streak.fillRect(
      push > 0 ? width * 0.45 : -width * 0.67,
      push > 0 ? -8 - i * 3 : 6 + i * 2,
      width * 0.22,
      3,
    );
    streak.setPosition(Math.round(x), Math.round(y + (i - 1) * 7));
    streak.setBlendMode(Phaser.BlendModes.ADD);
    destroyWhenDone(scene, streak, {
      x: streak.x + push * (14 + i * 7),
      alpha: 0,
      scaleX: 1.35 + i * 0.12,
      duration: 120 + i * 25,
      ease: "Cubic.easeOut",
    });
  }
}

export function prewarmDust(scene, count = 6) {
  for (let i = 0; i < count; i++) {
    spawnDust(scene, -9999, -9999);
  }
  dustPool.forEach((g) => {
    g.active = false;
    g.clear();
  });
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
  const color = positive
    ? teammate ? "#91ffd0" : self ? "#f1f5f9" : "#ffb3b3"
    : self ? "#ffb3b3" : "#ff5050";
  const strokeColor = positive
    ? teammate ? "#123e35" : self ? "#303744" : "#451a24"
    : "#451a24";
  const glowColor = positive
    ? teammate ? "#23d88c" : self ? "#cbd5e1" : "#ff9292"
    : self ? "#ff9292" : "#ff3030";
  const label = `${positive ? "+" : "−"}${Math.abs(rounded)}`;
  // Combat numbers should remain legible above sprites, attacks, and HUD text.
  const depth = Math.max(
    RENDER_LAYERS.ATTACKS + 2,
    typeof opts.depth === "number" ? opts.depth : 0,
  );
  const marker = scene.add.text(x, y - 5, label, {
    fontFamily: "LilitaOne-Regular, 'Arial Black', sans-serif",
    fontSize: opts.fontSize || "16px",
    fontStyle: "bold",
    color,
    stroke: strokeColor,
    strokeThickness: 4,
    padding: { x: 8, y: 6 },
  });
  marker.setOrigin(0.5);
  marker.setDepth(depth);
  marker.setShadow(0, 2, glowColor, 5, false, true);
  marker.setScale(0.65);
  const float = opts.floatDistance || 46;
  const duration = opts.duration || 820;
  // Reserve the whole floating path at the largest pop scale. Live numbers
  // keep their space until destroyed, including hits on nearby players.
  const halfWidth = marker.width * 0.7 + 6;
  const halfHeight = marker.height * 0.7 + 6;
  let markerX = x;
  let markerY = y - 5;
  let bounds;
  for (let slot = 0; ; slot++) {
    const column = [0, -1, 1, -2, 2][slot % 5];
    markerX = x + column * (halfWidth * 2 + 8);
    markerY = y - 5 - Math.floor(slot / 5) * (halfHeight * 2 + float + 8);
    bounds = {
      left: markerX - halfWidth, right: markerX + halfWidth,
      top: markerY - float - halfHeight, bottom: markerY + halfHeight,
    };
    const overlaps = [...markerPool].some((other) => {
      if (!other.active || other.scene !== scene) return false;
      const reserved = other._healthMarkerBounds;
      return reserved && bounds.left < reserved.right && bounds.right > reserved.left &&
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
    scale: 1.15,
    duration: 110,
    ease: "Back.easeOut",
    onComplete: () => {
      if (!marker.active) return;
      scene.tweens.add({
        targets: marker,
        scale: 1,
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

export function triggerDamageScreenPulse(scene, opts = {}) {
  if (!scene) return;
  const vigEl = document.getElementById("water-vignette");
  if (!vigEl) return;

  scene._damageVignetteUntil = Date.now() + (opts.durationMs || 220);
  scene._damageVignetteAlpha = opts.alpha || 0.74;
  vigEl.classList.add("water-danger-active");

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
      if (
        (scene._poisonWaterY ?? Infinity) >
        (Number(scene.scale?.height) ||
          Number(scene.game?.config?.height) ||
          1000) +
          10
      ) {
        vigEl.classList.remove("water-danger-active");
      }
      if ((scene._damageVignetteUntil || 0) <= Date.now()) {
        vigEl.style.opacity = "0";
      }
      scene._damageVignetteTween = null;
    },
  });
}

// Note: character-specific effects (like Draven's fire trail) live in
// their own files under src/characters/<char>/effects.js.
