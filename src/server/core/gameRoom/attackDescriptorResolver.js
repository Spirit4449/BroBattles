const attackDescriptors = require("../../../shared/attackDescriptors.json");
const {
  getResolvedCharacterAttackConfig,
  getResolvedCharacterAimConfig,
  getResolvedCharacterSpecialConfig,
} = require("../../../lib/characterTuning.js");

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = cloneValue(entry);
    }
    return out;
  }
  return value;
}

function mergeObjects(base, overrides) {
  const out = cloneValue(base);
  if (!overrides || typeof overrides !== "object") return out;
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      out[key] &&
      typeof out[key] === "object" &&
      !Array.isArray(out[key])
    ) {
      out[key] = mergeObjects(out[key], value);
    } else {
      out[key] = cloneValue(value);
    }
  }
  return out;
}

function getRuntimeOverrides(actionType) {
  const key = String(actionType || "").toLowerCase();
  if (!key) return null;

  if (key === "wizard-fireball" || key === "wizard-fireball-release") {
    const fireball =
      getResolvedCharacterAttackConfig("wizard", "fireball") || {};
    const runtime = {
      collisionRadius: Number(fireball.collisionRadius) || 38,
      speed: Number(fireball.speed) || 450,
      range: Number(fireball.range) || 1050,
      forwardOffsetWidthFactor: Number(fireball.forwardOffset) || 0.23,
      verticalOffsetHeightFactor: Number(fireball.verticalOffset) || 0.12,
      bobAmplitude: Number(fireball.bobAmplitude) || 5,
      bobFreqMs: Number(fireball.bobFreqMs) || 120,
    };
    if (key === "wizard-fireball") {
      return {
        actionFlow: {
          startupMs: Math.max(0, Number(fireball.castDelayMs) || 0),
        },
      };
    }
    return { runtime };
  }

  if (key === "draven-splash") {
    const splash = getResolvedCharacterAttackConfig("draven", "splash") || {};
    return {
      runtime: {
        activeWindowMs: Math.max(1, Number(splash.activeWindowMs) || 450),
        damageStartMs: Math.max(0, Number(splash.damageStartMs) || 0),
        damageTickMs: Math.max(1, Number(splash.damageTickMs) || 90),
        width: Math.max(1, Number(splash.width) || 150),
        height: Math.max(1, Number(splash.height) || 108),
        tipOffset: Number(splash.tipOffset) || 50,
        minHeight: Math.max(1, Number(splash.minHeight) || 20),
        growDurationMs: Math.max(1, Number(splash.growDurationMs) || 220),
        centerYFactor: Number(splash.centerYFactor) || 0.15,
      },
    };
  }

  if (key === "thorg-fall") {
    const fall = getResolvedCharacterAttackConfig("thorg", "fall") || {};
    return {
      runtime: {
        width: Number(fall.rectWidth) || 94,
        height: Number(fall.rectHeight) || 46,
        windupMs: Math.max(0, Number(fall.windupMs) || 180),
        activeWindowMs: Math.max(1, Number(fall.strikeMs) || 290),
        followAfterWindupMs: Math.max(0, Number(fall.followAfterWindupMs) || 0),
        damageTickMs: Math.max(1, Number(fall.damageTickMs) || 90),
        originOffsetX: Number(fall.originOffsetX) || 0,
        originHeightFactor: Number(fall.originHeightFactor) || 0,
        startOffsetX: Number(fall.startOffsetX) || 0,
        startOffsetY: Number(fall.startOffsetY) || 0,
        range: Math.max(1, Number(fall.range) || 120),
        endYOffset: Number(fall.endYOffset) || 300,
        arcHeight: Number(fall.arcHeight) || 120,
        curveMagnitude: Number(fall.curveMagnitude) || 20,
      },
    };
  }

  if (key === "ninja-shuriken") {
    const shuriken =
      getResolvedCharacterAttackConfig("ninja", "returningShuriken") || {};
    return {
      runtime: {
        collisionRadius: Math.max(1, Number(shuriken.collisionRadius) || 18),
        hoverDurationMs: Math.max(0, Number(shuriken.hoverDurationMs) || 0),
        returnAcceleration: Math.max(
          0,
          Number(shuriken.returnAcceleration) || 0,
        ),
        returnStartSpeedFactor: Math.max(
          0,
          Number(shuriken.returnStartSpeedFactor) || 0,
        ),
        maxLifetimeMs: Math.max(250, Number(shuriken.maxLifetimeMs) || 7000),
        hitArmMs: Math.max(0, Number(shuriken.hitArmMs) || 60),
        defaultForwardDistance: Math.max(
          1,
          Number(shuriken.forwardDistance) || 500,
        ),
        defaultOutwardDurationMs: Math.max(
          1,
          Number(shuriken.outwardDuration) || 380,
        ),
        defaultReturnSpeed: Math.max(1, Number(shuriken.returnSpeed) || 900),
        defaultEndYOffset: Number(shuriken.endYOffset) || 0,
        defaultCtrl1YOffset: Number(shuriken.ctrl1YOffset) || 20,
        defaultCtrl2YOffset: Number(shuriken.ctrl2YOffset) || -40,
      },
    };
  }

  if (key === "huntress-arrow" || key === "huntress-arrow-release") {
    const arrows =
      getResolvedCharacterAttackConfig("huntress", "arrowSpread") || {};
    const runtime = {
      speed: Number(arrows.speed) || 980,
      range: Number(arrows.range) || 900,
      collisionRadius: Number(arrows.collisionRadius) || 16,
      playerCollisionRadius:
        Number(arrows.playerCollisionRadius) ||
        Number(arrows.collisionRadius) ||
        16,
      forwardOffsetWidthFactor: Number(arrows.forwardOffset) || 0.28,
      verticalOffsetHeightFactor: Number(arrows.verticalOffset) || 0.12,
      count: Math.max(1, Number(arrows.count) || 3),
      spreadDeg: Number(arrows.spreadDeg) || 9,
      damagePerProjectile: Math.max(1, Number(arrows.damagePerArrow) || 1000),
      destroyOnHit: true,
    };
    if (key === "huntress-arrow") {
      return {
        actionFlow: {
          startupMs: Math.max(0, Number(arrows.castDelayMs) || 0),
        },
      };
    }
    return { runtime };
  }

  if (key === "huntress-burning-arrow") {
    const volley =
      getResolvedCharacterSpecialConfig("huntress", "burningVolley") || {};
    return {
      runtime: {
        speed: Number(volley.speed) || 930,
        range: Number(volley.range) || 960,
        collisionRadius: Number(volley.collisionRadius) || 18,
        playerCollisionRadius:
          Number(volley.playerCollisionRadius) ||
          Number(volley.collisionRadius) ||
          18,
        count: Math.max(1, Number(volley.count) || 6),
        spreadDeg: Number(volley.spreadDeg) || 26,
        damagePerProjectile: Math.max(1, Number(volley.damagePerArrow) || 1000),
        destroyOnHit: true,
      },
      events: {
        onHitEffect: {
          type: "huntressBurn",
          durationMs: Math.max(1, Number(volley.burnDurationMs) || 5000),
          totalDamage: Math.max(0, Number(volley.burnTotalDamage) || 500),
        },
      },
    };
  }

  if (key === "gloop-slimeball" || key === "gloop-slimeball-release") {
    const slimeball =
      getResolvedCharacterAttackConfig("gloop", "slimeball") || {};
    const slowDurationMs = Math.max(
      1,
      Number(slimeball.slowDurationMs) || 2000,
    );
    const slowSpeedMult = Math.max(0.1, Number(slimeball.slowSpeedMult) || 0.7);
    const slowJumpMult = Math.max(0.1, Number(slimeball.slowJumpMult) || 0.7);
    const runtime = {
      collisionRadius: Math.max(1, Number(slimeball.collisionRadius) || 28),
      speed: Math.max(1, Number(slimeball.speed) || 390),
      range: Math.max(1, Number(slimeball.range) || 930),
      forwardOffsetWidthFactor: Number(slimeball.forwardOffset) || 0.32,
      verticalOffsetHeightFactor: Number(slimeball.verticalOffset) || 0.1,
      gravity: Math.max(0, Number(slimeball.gravity) || 380),
      airDrag: Math.max(0, Number(slimeball.airDrag) || 0),
      initialVy: Number(slimeball.initialVy) || -70,
      maxBounces: Math.max(0, Number(slimeball.maxBounces) || 2),
      bounceDampingY: Math.max(0.1, Number(slimeball.bounceDampingY) || 0.74),
      bounceDampingX: Math.max(0.1, Number(slimeball.bounceDampingX) || 0.92),
      minBounceSpeed: Math.max(0, Number(slimeball.minBounceSpeed) || 0),
      bounceFloorOffsetY: Number(slimeball.bounceFloorOffsetY) || 185,
      maxLifetimeMs: Math.max(250, Number(slimeball.maxLifetimeMs) || 4200),
      destroyOnHit: false,
      slowDurationMs,
      slowSpeedMult,
      slowJumpMult,
    };
    if (key === "gloop-slimeball") {
      return {
        actionFlow: {
          startupMs: Math.max(0, Number(slimeball.castDelayMs) || 0),
        },
      };
    }
    return { runtime };
  }

  if (key === "gloop-hook-release") {
    const hook = getResolvedCharacterSpecialConfig("gloop", "hook") || {};
    return {
      runtime: {
        speed: Math.max(1, Number(hook.speed) || 900),
        range: Math.max(1, Number(hook.range) || 780),
        collisionRadius: Math.max(1, Number(hook.collisionRadius) || 34),
        maxLifetimeMs: Math.max(
          200,
          Math.ceil(
            ((Number(hook.range) || 780) /
              Math.max(1, Number(hook.speed) || 900)) *
              1000 *
              1.5,
          ),
        ),
        pullDurationMs: Math.max(120, Number(hook.pullDurationMs) || 640),
        pullLockPaddingMs: Math.max(0, Number(hook.pullLockPaddingMs) || 120),
        pulledStopDistance: Math.max(1, Number(hook.pulledStopDistance) || 54),
        slowDurationMs: Math.max(1, Number(hook.slowDurationMs) || 2200),
        slowSpeedMult: Math.max(0.1, Number(hook.slowSpeedMult) || 0.5),
        slowJumpMult: Math.max(0.1, Number(hook.slowJumpMult) || 0.5),
      },
    };
  }

  return null;
}

function getResolvedAttackDescriptor(actionType) {
  const key = String(actionType || "").toLowerCase();
  const base = key ? attackDescriptors?.[key] || null : null;
  if (!base) return null;
  const overrides = getRuntimeOverrides(key);
  return mergeObjects(base, overrides);
}

module.exports = {
  getResolvedAttackDescriptor,
};
