const attackDescriptors = require("../../../shared/characters/index.js").attackDescriptors;
const {
  getResolvedCharacterAttackConfig,
  getResolvedCharacterAimConfig,
  getResolvedCharacterSpecialConfig,
} = require("../../../shared/characterTuning.js");

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
      collisionRadius: Number(fireball.collisionRadius),
      speed: Number(fireball.speed),
      range: Number(fireball.range),
      forwardOffsetWidthFactor: Number(fireball.forwardOffset),
      verticalOffsetHeightFactor: Number(fireball.verticalOffset),
      bobAmplitude: Number(fireball.bobAmplitude),
      bobFreqMs: Number(fireball.bobFreqMs),
    };
    if (key === "wizard-fireball") {
      return {
        actionFlow: {
          startupMs: Math.max(0, Number(fireball.castDelayMs)),
        },
      };
    }
    return { runtime };
  }

  if (key === "draven-splash") {
    const splash = getResolvedCharacterAttackConfig("draven", "splash") || {};
    return {
      runtime: {
        activeWindowMs: Math.max(1, Number(splash.activeWindowMs)),
        damageStartMs: Math.max(0, Number(splash.damageStartMs)),
        damageTickMs: Math.max(1, Number(splash.damageTickMs)),
        width: Math.max(1, Number(splash.width)),
        height: Math.max(1, Number(splash.height)),
        tipOffset: Number(splash.tipOffset),
        minHeight: Math.max(1, Number(splash.minHeight)),
        growDurationMs: Math.max(1, Number(splash.growDurationMs)),
        centerYFactor: Number(splash.centerYFactor),
      },
    };
  }

  if (key === "thorg-fall") {
    const sweep = getResolvedCharacterAttackConfig("thorg", "sweep");
    return {
      runtime: {
        width: sweep.headWidth,
        height: sweep.headHeight,
        windupMs: sweep.windupMs,
        activeWindowMs: sweep.strikeMs,
        range: sweep.radiusX,
      },
    };
  }

  if (key === "ninja-shuriken") {
    const shuriken =
      getResolvedCharacterAttackConfig("ninja", "returningShuriken") || {};
    return {
      runtime: {
        collisionRadius: Math.max(1, Number(shuriken.collisionRadius)),
        hoverDurationMs: Math.max(0, Number(shuriken.hoverDurationMs)),
        returnAcceleration: Math.max(
          0,
          Number(shuriken.returnAcceleration),
        ),
        returnStartSpeedFactor: Math.max(
          0,
          Number(shuriken.returnStartSpeedFactor),
        ),
        maxLifetimeMs: Math.max(250, Number(shuriken.maxLifetimeMs)),
        hitArmMs: Math.max(0, Number(shuriken.hitArmMs)),
        defaultForwardDistance: Math.max(
          1,
          Number(shuriken.forwardDistance),
        ),
        defaultOutwardDurationMs: Math.max(
          1,
          Number(shuriken.outwardDuration),
        ),
        defaultReturnSpeed: Math.max(1, Number(shuriken.returnSpeed)),
        defaultEndYOffset: Number(shuriken.endYOffset),
        defaultCtrl1YOffset: Number(shuriken.ctrl1YOffset),
        defaultCtrl2YOffset: Number(shuriken.ctrl2YOffset),
      },
    };
  }

  if (key === "huntress-arrow") {
    const arrows = getResolvedCharacterAttackConfig("huntress", "arrowSpread");
    return { actionFlow: { startupMs: arrows.castDelayMs } };
  }

  if (key === "gloop-slimeball" || key === "gloop-slimeball-release") {
    const slimeball =
      getResolvedCharacterAttackConfig("gloop", "slimeball") || {};
    const slowDurationMs = Math.max(
      1,
      Number(slimeball.slowDurationMs),
    );
    const slowSpeedMult = Math.max(0, Number(slimeball.slowSpeedMult));
    const slowJumpMult = Math.max(0, Number(slimeball.slowJumpMult));
    const runtime = {
      collisionRadius: Math.max(1, Number(slimeball.collisionRadius)),
      speed: Math.max(1, Number(slimeball.speed)),
      range: Math.max(1, Number(slimeball.range)),
      forwardOffsetWidthFactor: Number(slimeball.forwardOffset),
      verticalOffsetHeightFactor: Number(slimeball.verticalOffset),
      gravity: Math.max(0, Number(slimeball.gravity)),
      airDrag: Math.max(0, Number(slimeball.airDrag)),
      initialVy: Number(slimeball.initialVy),
      maxBounces: Math.max(0, Number(slimeball.maxBounces)),
      bounceDampingY: Math.max(0.1, Number(slimeball.bounceDampingY)),
      bounceDampingX: Math.max(0.1, Number(slimeball.bounceDampingX)),
      successiveBounceMultiplier: Math.max(
        0,
        Number(slimeball.successiveBounceMultiplier),
      ),
      minBounceSpeed: Math.max(0, Number(slimeball.minBounceSpeed)),
      bounceFloorOffsetY: Number(slimeball.bounceFloorOffsetY),
      maxLifetimeMs: Math.max(250, Number(slimeball.maxLifetimeMs)),
      destroyOnHit: true,
      slowDurationMs,
      slowSpeedMult,
      slowJumpMult,
    };
    if (key === "gloop-slimeball") {
      return {
        actionFlow: {
          startupMs: Math.max(0, Number(slimeball.castDelayMs)),
        },
      };
    }
    return { runtime };
  }

  if (key === "gloop-hook-release") {
    const hook = getResolvedCharacterSpecialConfig("gloop", "hook") || {};
    return {
      runtime: {
        speed: Math.max(1, Number(hook.speed)),
        range: Math.max(1, Number(hook.range)),
        collisionRadius: Math.max(1, Number(hook.collisionRadius)),
        maxLifetimeMs: Math.max(
          200,
          Math.ceil(
            ((Number(hook.range)) /
              Math.max(1, Number(hook.speed))) *
              1000 *
              1.5,
          ),
        ),
        pullDurationMs: Math.max(120, Number(hook.pullDurationMs)),
        pullLockPaddingMs: Math.max(0, Number(hook.pullLockPaddingMs)),
        pulledStopDistance: Math.max(1, Number(hook.pulledStopDistance)),
        slowDurationMs: Math.max(1, Number(hook.slowDurationMs)),
        slowSpeedMult: Math.max(0, Number(hook.slowSpeedMult)),
        slowJumpMult: Math.max(0, Number(hook.slowJumpMult)),
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
