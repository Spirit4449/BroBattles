import socket from "../../socket";

const FIREBALL_SPEED = 450; // px per second after launch
const FIREBALL_RANGE = 1050; // px travel before despawn
const FIREBALL_VISUAL_RADIUS = 14;
const FIREBALL_COLLISION_RADIUS = 57; // generous hitbox to catch edge hits
const FIREBALL_INITIAL_SCALE = 0.1; // spawn scale
const FIREBALL_ACTIVE_SCALE = 0.5; // scale once flying
const FIREBALL_GLOW_RADIUS_MULT = 1.35;
const FIREBALL_BOB_AMPLITUDE = 5;
const FIREBALL_VERTICAL_OFFSET = 0.12; // fraction of height to lift from feet
const FIREBALL_CAST_DELAY_MS = 300; // pre-launch delay
const FIREBALL_BOB_TWEEN_MS = 220; // remote bob tween duration
const FIREBALL_FORWARD_OFFSET = 0.23; // multiplier applied to sprite width for spawn X offset
const FIREBALL_BOB_FREQ_MS = 120; // divisor for owner bob sine wave (larger = slower)
const FIREBALL_DEPTH = 100; // ensure rendering above tilemap and ground
const FIREBALL_BASE_ANGLE_DEG = -90; // sideways orientation; right=+90, left=-90

let DEBUG_DRAW = false;
const ACTIVE_DEBUG_SHAPES = new Set();

function makeId() {
  return `wizardFireball_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function registerDebugShape(shape) {
  if (!shape) return shape;
  ACTIVE_DEBUG_SHAPES.add(shape);
  shape.setVisible(DEBUG_DRAW);
  shape.once("destroy", () => {
    ACTIVE_DEBUG_SHAPES.delete(shape);
  });
  return shape;
}

function createDebugCircle(scene) {
  if (!scene?.add) return null;
  const circle = scene.add.circle(
    0,
    0,
    FIREBALL_COLLISION_RADIUS,
    0x00ffff,
    0.08
  );
  circle.setStrokeStyle(1, 0x00ffff, 0.8);
  circle.setDepth(9999);
  return registerDebugShape(circle);
}

function attachDebugFollower(scene, target) {
  if (!scene || !target) return null;
  const circle = createDebugCircle(scene);
  if (!circle) return null;
  const updater = () => {
    if (!circle.active || !target.active) return;
    circle.x = target.x;
    circle.y = target.y;
  };
  scene.events.on("update", updater);
  let disposed = false;
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    scene.events.off("update", updater);
    circle.destroy();
  };
  return {
    destroy,
    shape: circle,
  };
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
    : scene.add.circle(x, y, FIREBALL_VISUAL_RADIUS, 0xff8b3d, 0.9);
  sprite.setDepth(FIREBALL_DEPTH);
  if (sprite.setScale) sprite.setScale(FIREBALL_INITIAL_SCALE);
  if (sprite.setFlipX) sprite.setFlipX(direction < 0);
  if (sprite.setAngle)
    sprite.setAngle(direction < 0 ? -FIREBALL_BASE_ANGLE_DEG : FIREBALL_BASE_ANGLE_DEG);

  // Ensure animated fireball plays if atlas frames are available
  if (key === "wizard-fireball" && scene.textures.exists("wizard-fireball")) {
    const animKey = "wizard-fireball:loop";
    if (!scene.anims.exists(animKey)) {
      const tex = scene.textures.get("wizard-fireball");
      const names = (tex && tex.getFrameNames && tex.getFrameNames()) || [];
      const frames = names.filter((n) => n && n !== "__BASE");
      if (frames.length > 1) {
        frames.sort((a, b) => {
          const ra = /([0-9]+)(?!.*[0-9])/.exec(a);
          const rb = /([0-9]+)(?!.*[0-9])/.exec(b);
          if (ra && rb) return Number(ra[1]) - Number(rb[1]);
          return a.localeCompare(b);
        });
        scene.anims.create({
          key: animKey,
          frames: frames.map((f) => ({ key: "wizard-fireball", frame: f })),
          frameRate: 16,
          repeat: -1,
        });
      }
    }
    if (sprite.anims && scene.anims.exists("wizard-fireball:loop")) {
      sprite.anims.play("wizard-fireball:loop", true);
    }
  }
  return sprite;
}

function spawnFireballTrail(scene, sprite) {
  if (!scene?.add) return null;
  if (!scene.add.circle) return null;
  const glow = scene.add.circle(
    sprite.x,
    sprite.y,
    FIREBALL_VISUAL_RADIUS * FIREBALL_GLOW_RADIUS_MULT,
    0xff6b2c,
    0.22
  );
  glow.setDepth(FIREBALL_DEPTH - 1);
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
      const flash = scene.add.circle(
        x,
        y,
        FIREBALL_VISUAL_RADIUS,
        0xffd9a0,
        0.6
      );
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
  const debugFollower = attachDebugFollower(scene, sprite);
  if (debugFollower) {
    sprite.once("destroy", () => debugFollower.destroy());
  }
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
    debugFollower?.destroy();
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
      if (sprite.setAngle)
        sprite.setAngle(direction < 0 ? -FIREBALL_BASE_ANGLE_DEG : FIREBALL_BASE_ANGLE_DEG);
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
    // No rotation during flight

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
          FIREBALL_COLLISION_RADIUS,
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
  if (sprite.setAngle)
    sprite.setAngle(direction < 0 ? -FIREBALL_BASE_ANGLE_DEG : FIREBALL_BASE_ANGLE_DEG);
  scene.tweens.add({
    targets: sprite,
    scale: FIREBALL_ACTIVE_SCALE,
    ease: "Sine.easeOut",
    duration: startup,
  });
  const debugFollower = attachDebugFollower(scene, sprite);
  if (debugFollower) {
    sprite.once("destroy", () => debugFollower.destroy());
  }
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
      debugFollower?.destroy();
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
  return sprite;
}

export function changeDebugState(state) {
  DEBUG_DRAW = !!state;
  for (const shape of ACTIVE_DEBUG_SHAPES) {
    shape.setVisible(DEBUG_DRAW);
  }
}
