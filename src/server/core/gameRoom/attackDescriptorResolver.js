const attackDescriptors = require("../../../shared/attackDescriptors.json");
const { getCharacterTuning } = require("../../../lib/characterStats.js");

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
    const fireball = getCharacterTuning("wizard")?.attack?.fireball || {};
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
    const splash = getCharacterTuning("draven")?.attack?.splash || {};
    return {
      runtime: {
        width: Number(splash.width) || 150,
        height: Number(splash.height) || 108,
        activeWindowMs: Math.max(1, Number(splash.activeWindowMs) || 450),
        damageStartMs: Math.max(0, Number(splash.damageStartMs) || 0),
        damageTickMs: Math.max(1, Number(splash.damageTickMs) || 90),
        tipOffset: Number(splash.tipOffset) || 50,
        minHeight: Math.max(1, Number(splash.minHeight) || 20),
        growDurationMs: Math.max(1, Number(splash.growDurationMs) || 220),
        centerYFactor: Number(splash.centerYFactor) || 0.15,
      },
    };
  }

  if (key === "thorg-fall") {
    const fall = getCharacterTuning("thorg")?.attack?.fall || {};
    return {
      runtime: {
        width: Number(fall.rectWidth) || 94,
        height: Number(fall.rectHeight) || 46,
        windupMs: Math.max(0, Number(fall.windupMs) || 180),
        activeWindowMs: Math.max(1, Number(fall.strikeMs) || 290),
        followAfterWindupMs: Math.max(
          0,
          Number(fall.followAfterWindupMs) || 0,
        ),
        damageTickMs: Math.max(1, Number(fall.damageTickMs) || 90),
        range: Math.max(1, Number(fall.range) || 120),
        endYOffset: Number(fall.endYOffset) || 300,
        arcHeight: Number(fall.arcHeight) || 120,
        curveMagnitude: Number(fall.curveMagnitude) || 20,
      },
    };
  }

  if (key === "ninja-shuriken") {
    const shuriken =
      getCharacterTuning("ninja")?.attack?.returningShuriken || {};
    return {
      runtime: {
        defaultForwardDistance:
          Math.max(1, Number(shuriken.forwardDistance) || 500),
        defaultOutwardDurationMs:
          Math.max(1, Number(shuriken.outwardDuration) || 380),
        defaultReturnSpeed: Math.max(1, Number(shuriken.returnSpeed) || 900),
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
