import socket from "../../socket";

const FIREBALL_SPEED = 800; // px per second after launch
const FIREBALL_RANGE = 720; // px travel before despawn
const FIREBALL_RADIUS = 14; // collision radius
const FIREBALL_INITIAL_SCALE = 0.1; // spawn scale
const FIREBALL_ACTIVE_SCALE = 0.29; // scale once flying
const FIREBALL_GLOW_RADIUS_MULT = 1.35;
const FIREBALL_BOB_AMPLITUDE = 14;
const FIREBALL_VERTICAL_OFFSET = 0.12; // fraction of height to lift from feet
const FIREBALL_CAST_DELAY_MS = 200; // pre-launch delay
const FIREBALL_ROTATION_SPEED = 600; // degrees per second
const FIREBALL_BOB_TWEEN_MS = 220; // remote bob tween duration
const FIREBALL_FORWARD_OFFSET = 0.2; // multiplier applied to sprite width for spawn X offset
const FIREBALL_BOB_FREQ_MS = 90; // divisor for owner bob sine wave (larger = slower)
const FIREBALL_ROTATION_TWEEN_MS = 400; // remote rotation tween duration

function makeId() {
  return `wizardFireball_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function circleRectOverlap(cx, cy, radius, bx1, by1, bx2, by2) {
  const closestX = Phaser.Math.Clamp(cx, bx1, bx2);
  const closestY = Phaser.Math.Clamp(cy, by1, by2);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

function createFireballSprite(scene, x, y, direction) {
  const key = scene.textures.exists("wizard-fireball")
    ? "wizard-fireball"
    : scene.textures.exists("fireball")
    ? "fireball"
    : scene.textures.exists("wizard")
    ? "wizard"
    : null;
  const sprite = key
    ? scene.add.sprite(x, y, key)
    : scene.add.circle(x, y, FIREBALL_RADIUS, 0xff8b3d, 0.9);
  sprite.setDepth(8);
  if (sprite.setBlendMode) sprite.setBlendMode(Phaser.BlendModes.ADD);
  if (sprite.setScale) sprite.setScale(FIREBALL_INITIAL_SCALE);
  if (sprite.setFlipX) sprite.setFlipX(direction < 0);
  if (sprite.setRotation)
    sprite.setRotation(Phaser.Math.DegToRad(direction < 0 ? 180 : 0));
  return sprite;
}

function spawnFireballTrail(scene, sprite) {
  if (!scene?.add) return null;
  if (!scene.add.circle) return null;
  const glow = scene.add.circle(
    sprite.x,
    sprite.y,
    FIREBALL_RADIUS * FIREBALL_GLOW_RADIUS_MULT,
    0xff6b2c,
    0.22
  );
  glow.setDepth(sprite.depth - 1);
  glow.setBlendMode(Phaser.BlendModes.ADD);
  const update = () => {
    if (!glow.active || !sprite.active) return;
    glow.x = sprite.x;
    glow.y = sprite.y;
    if (glow.scale) {
      glow.scale = Phaser.Math.FloatBetween(0.95, 1.1);
    }
  };
  scene.events.on("update", update);
  return {
    destroy() {
      scene.events.off("update", update);
      glow.destroy();
    },
  };
}

function spawnImpact(scene, x, y) {
  try {
    if (scene.add?.particles) {
      const emitter = scene.add.particles(0xffe29f, {
        x,
        y,
        speed: 90,
        lifespan: 280,
        quantity: 6,
        scale: { start: 0.8, end: 0 },
        alpha: { start: 0.8, end: 0 },
        blendMode: "ADD",
      });
      scene.time.delayedCall(320, () => emitter.destroy());
    } else if (scene.add?.circle) {
      const flash = scene.add.circle(x, y, FIREBALL_RADIUS, 0xffd9a0, 0.6);
      flash.setBlendMode(Phaser.BlendModes.ADD);
      scene.tweens.add({
        targets: flash,
        alpha: 0,
        scale: 1.4,
        duration: 220,
        onComplete: () => flash.destroy(),
      });
    }
    const played = scene.sound?.play("wizard-impact", { volume: 0.45 });
    if (!played) {
      scene.sound?.play("damage", { volume: 0.4 });
    }
  } catch (_) {}
}

export function performWizardFireball(instance) {
  const { scene, player: p, username, gameId, opponentPlayersRef } = instance;
  let direction = p.flipX ? -1 : 1;
  let travelDirection = direction;
  const attackId = makeId();

  const computeOrigin = (dir = direction) => ({
    x: p.x + dir * ((p.displayWidth || 80) * FIREBALL_FORWARD_OFFSET),
    y: p.y - (p.displayHeight || p.height || 120) * FIREBALL_VERTICAL_OFFSET,
  });

  let currentOrigin = computeOrigin(direction);
  let travelBaseY = currentOrigin.y;
  const payloadStart = { ...currentOrigin };

  if (scene.anims) {
    if (scene.anims.exists("wizard-throw")) {
      p.anims.play("wizard-throw", true);
    } else if (scene.anims.exists("throw")) {
      p.anims.play("throw", true);
    }
  }
  try {
    const fired = scene.sound?.play("wizard-fireball", { volume: 0.55 });
    if (!fired) {
      scene.sound?.play("draven-fireball", { volume: 0.45 });
    }
  } catch (_) {}

  const sprite = createFireballSprite(
    scene,
    currentOrigin.x,
    currentOrigin.y,
    direction
  );
  scene.tweens.add({
    targets: sprite,
    scale: FIREBALL_ACTIVE_SCALE,
    ease: "Sine.easeOut",
    duration: FIREBALL_CAST_DELAY_MS,
  });
  const trail = spawnFireballTrail(scene, sprite);
  const lifetimeMs = Math.round((FIREBALL_RANGE / FIREBALL_SPEED) * 1000);
  const hitSet = new Set();
  let traveled = 0;
  let travelElapsed = 0;
  let launchTimer = FIREBALL_CAST_DELAY_MS;
  let launched = launchTimer <= 0;
  let alive = true;

  const damageValue = Math.max(
    1,
    Math.round(instance.constructor?.getStats?.()?.baseDamage || 0)
  );

  const cleanup = (hitPosition) => {
    if (!alive) return;
    alive = false;
    scene.events.off("update", update);
    if (trail) trail.destroy();
    spawnImpact(scene, hitPosition?.x ?? sprite.x, hitPosition?.y ?? sprite.y);
    sprite.destroy();
  };

  const update = () => {
    if (!alive || !sprite.active) return;
    const dt = scene.game.loop.delta || 16;
    if (!launched) {
      direction = p.flipX ? -1 : 1;
      currentOrigin = computeOrigin(direction);
      sprite.x = currentOrigin.x;
      sprite.y = currentOrigin.y;
      if (sprite.setFlipX) sprite.setFlipX(direction < 0);
      launchTimer -= dt;
      if (launchTimer > 0) return;
      launched = true;
      travelDirection = direction;
      travelBaseY = currentOrigin.y;
      sprite.x = currentOrigin.x;
      sprite.y = currentOrigin.y;
      return;
    }
    const step = (FIREBALL_SPEED * dt) / 1000;
    traveled += step;
    travelElapsed += dt;
    sprite.x += step * travelDirection;
    sprite.y =
      travelBaseY +
      Math.sin(travelElapsed / FIREBALL_BOB_FREQ_MS) * FIREBALL_BOB_AMPLITUDE;
    if (sprite.rotation !== undefined) {
      sprite.rotation +=
        Phaser.Math.DegToRad(FIREBALL_ROTATION_SPEED * (dt / 1000)) *
        travelDirection;
    }

    // Owner-side collision detection
    const opponents = Object.values(opponentPlayersRef || {});
    for (const wrap of opponents) {
      const spr = wrap?.opponent;
      const name = wrap?.username;
      if (!spr || !name || hitSet.has(name)) continue;
      let bx1, by1, bx2, by2;
      if (spr.body) {
        bx1 = spr.body.x;
        by1 = spr.body.y;
        bx2 = spr.body.x + spr.body.width;
        by2 = spr.body.y + spr.body.height;
      } else {
        const halfW = (spr.displayWidth || spr.width || 0) / 2;
        const halfH = (spr.displayHeight || spr.height || 0) / 2;
        bx1 = spr.x - halfW;
        by1 = spr.y - halfH;
        bx2 = spr.x + halfW;
        by2 = spr.y + halfH;
      }
      if (
        circleRectOverlap(
          sprite.x,
          sprite.y,
          FIREBALL_RADIUS,
          bx1,
          by1,
          bx2,
          by2
        )
      ) {
        hitSet.add(name);
        socket.emit("hit", {
          attacker: username,
          target: name,
          attackType: "basic",
          damage: damageValue,
          gameId,
        });
        cleanup({ x: (bx1 + bx2) / 2, y: (by1 + by2) / 2 });
        return;
      }
    }

    if (traveled >= FIREBALL_RANGE || travelElapsed >= lifetimeMs) {
      cleanup();
    }
  };

  scene.events.on("update", update);

  return {
    type: "wizard-fireball",
    id: attackId,
    direction: travelDirection,
    start: payloadStart,
    range: FIREBALL_RANGE,
    duration: lifetimeMs,
    startup: FIREBALL_CAST_DELAY_MS,
    bob: FIREBALL_BOB_AMPLITUDE,
  };
}

export function spawnWizardFireballVisual(scene, payload, ownerSprite) {
  if (!scene?.add) return null;
  const direction = payload?.direction || 1;
  const start = payload?.start || {
    x: ownerSprite?.x || 0,
    y: ownerSprite
      ? ownerSprite.y - ownerSprite.height * FIREBALL_VERTICAL_OFFSET
      : 0,
  };
  const range = payload?.range || FIREBALL_RANGE;
  const travelDuration =
    payload?.duration || Math.round((range / FIREBALL_SPEED) * 1000);
  const startup = payload?.startup ?? FIREBALL_CAST_DELAY_MS;
  const bob = payload?.bob ?? FIREBALL_BOB_AMPLITUDE;

  const sprite = createFireballSprite(scene, start.x, start.y, direction);
  scene.tweens.add({
    targets: sprite,
    scale: FIREBALL_ACTIVE_SCALE,
    ease: "Sine.easeOut",
    duration: startup,
  });
  const trail = spawnFireballTrail(scene, sprite);

  scene.tweens.add({
    targets: sprite,
    x: start.x + direction * range,
    ease: "Linear",
    duration: travelDuration,
    delay: startup,
    onComplete: () => {
      spawnImpact(scene, sprite.x, sprite.y);
      sprite.destroy();
      if (trail) trail.destroy();
    },
  });
  scene.tweens.add({
    targets: sprite,
    y: start.y + bob,
    ease: "Sine.easeInOut",
    yoyo: true,
    duration: FIREBALL_BOB_TWEEN_MS,
    delay: startup,
    repeat: Math.ceil(travelDuration / FIREBALL_BOB_TWEEN_MS),
  });
  scene.tweens.add({
    targets: sprite,
    angle: { from: 0, to: direction < 0 ? -360 : 360 },
    ease: "Linear",
    duration: FIREBALL_ROTATION_TWEEN_MS,
    delay: startup,
    repeat: travelDuration
      ? Math.ceil(travelDuration / FIREBALL_ROTATION_TWEEN_MS)
      : -1,
  });
  return sprite;
}
