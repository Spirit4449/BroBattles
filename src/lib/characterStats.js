// Character stats without dependencies on Phaser or character classes
// Single source of truth for all character stats and constants

// Default character for new users
export const DEFAULT_CHARACTER = "ninja";
export const LEVEL_CAP = 10;

// Levels 1–5 retain the original progression. Mastery levels (6–10) are
// deliberately gentler so reaching the new cap is rewarding without
// invalidating the balance players already know.
const STANDARD_LEVEL_STAT_GAINS = {
  health: 500,
  damage: 100,
  specialDamage: 200,
};
const MASTERY_LEVEL_STAT_GAINS = {
  health: 400,
  damage: 80,
  specialDamage: 100,
};

// Indexed by the character's current level; each value buys the next level.
// The first four entries preserve the existing economy exactly.
const UPGRADE_PRICES = [
  null,
  200,
  400,
  800,
  1600,
  2400,
  3300,
  4500,
  6100,
  8200,
];

export const characterStats = {
  ninja: {
    baseHealth: 6000,
    attackDescription: "Unleashes a shuriken that boomerangs back.",
    baseDamage: 1200,
    ammoCooldownMs: 200,
    ammoReloadMs: 1000,
    ammoCapacity: 1,
    specialDescription: "Releases a staggered swarm of returning shurikens.",
    specialBaseDamage: 2000,
    specialChargeHits: 6,
    specialChargePerHit: 0.25,
    spriteScale: 0.9,
    body: {
      widthShrink: 42,
      heightShrink: 15,
      offsetXFromHalf: 0,
      offsetY: 10,
    },
    tuning: {
      attack: {
        aim: {
          kind: "line",
          attackKey: "returningShuriken",
          defaultRange: 500,
          anchorForwardOffset: 30,
          anchorOffsetY: -8,
          reticleThickness: 18,
          angleMode: "free",
        },
        returningShuriken: {
          rotationSpeed: 2000,
          forwardDistance: 500,
          arcHeight: 160,
          outwardDuration: 380,
          returnSpeed: 900,
          scale: 0.1,
          collisionSizeScale: 0.52,
          collisionRadiusScale: 0.26,
          collisionRadius: 18,
          hoverDurationMs: 100,
          returnAcceleration: 800,
          returnStartSpeedFactor: 0.08,
          maxLifetimeMs: 7000,
          hitCooldownMs: 0,
          endYOffset: 0,
          ctrl1YOffset: 20,
          ctrl2YOffset: -40,
        },
      },
      special: {
        aim: {
          kind: "line",
          specialKey: "swarm",
          defaultRange: 430,
          anchorForwardOffset: 34,
          anchorOffsetY: -10,
          reticleThickness: 124,
          angleMode: "horizontal-only",
        },
        swarm: {
          count: 15,
          releaseMs: 36,
          lockPaddingMs: 180,
          damage: 300,
          yOffsetPerShard: 5.5,
          fanStrengthPerShard: 14,
          spawnForwardBase: 28,
          spawnForwardPerShard: 1.6,
          spawnYBase: -12,
          scale: 0.135,
          glowScale: 1.35,
          rotationSpeedBase: 2200,
          rotationSpeedPerShard: 35,
          forwardDistanceBase: 440,
          forwardDistancePerShard: 6,
          outwardDurationBase: 330,
          outwardDurationPerShard: 8,
          returnSpeed: 960,
          hitCooldownMs: 320,
          ctrl1YOffsetBase: 16,
          ctrl1YOffsetScale: 0.25,
          ctrl2YOffsetBase: 52,
          ctrl2YOffsetScale: 0.45,
          maxLifetimeMs: 5200,
        },
      },
    },
    description: "A swift and agile fighter.",
    free: true,
  },

  thorg: {
    baseHealth: 13000,
    attackDescription: "Revolves his heavy weapon around his body, striking both sides with light knockback.",
    baseDamage: 1500,
    ammoCooldownMs: 700,
    ammoReloadMs: 800,
    ammoCapacity: 3,
    specialDescription:
      "Enters a purple rage that buffs damage and strengthens knockback.",
    specialBaseDamage: 2800,
    specialChargeHits: 3,
    specialChargePerHit: 0,
    spriteScale: 0.7,
    body: {
      widthShrink: 40,
      heightShrink: 14,
      offsetXFromHalf: -18,
      offsetY: 8,
      flipOffset: 14,
    },
    tuning: {
      attack: {
        aim: {
          kind: "round",
          attackKey: "fall",
          minRange: 102,
          defaultRange: 102,
          maxRange: 102,
          radius: 102,
          radiusY: 46,
          reticleOffsetY: 13,
          anchorForwardOffset: 0,
          anchorOffsetY: 13,
          minSpeedScale: 1,
          maxSpeedScale: 1,
        },
        fall: {
          rectWidth: 54,
          rectHeight: 40,
          windupMs: 70,
          strikeMs: 400,
          followAfterWindupMs: 400,
          originOffsetX: 0,
          originHeightFactor: 0,
          startOffsetX: 0,
          startOffsetY: 13,
          range: 75,
          arcHeight: 26,
          curveMagnitude: 0,
          endYOffset: 13,
          damageTickMs: 16,
          hitboxInflate: 0,
          spriteForwardOffset: -Math.PI / 2,
        },
      },
      special: {
        aim: {
          kind: "round",
          radius: 72,
          defaultRange: 72,
          anchorForwardOffset: 0,
          anchorOffsetY: -8,
        },
        rageDurationMs: 8000,
      },
    },
    description: "A sturdy frontline bruiser with crushing blows.",
    free: true,
  },

  draven: {
    baseHealth: 6500,
    attackDescription:
      "Puffs out a magical smoke that deals splash damage to everyone in the path.",
    baseDamage: 2500,
    ammoCooldownMs: 450,
    ammoReloadMs: 1600,
    ammoCapacity: 3,
    specialDescription: "Unleashes a staff nova that expands outward.",
    specialBaseDamage: 2400,
    specialChargeHits: 4,
    specialChargePerHit: 0.25,
    spriteScale: 1.2,
    body: {
      widthShrink: 230,
      heightShrink: 194,
      offsetXFromHalf: 0,
      offsetY: 111,
      // Shift body to the right when facing left to cover staff
      flipOffset: 5,
    },
    tuning: {
      attack: {
        aim: {
          kind: "splash",
          attackKey: "splash",
          defaultRange: 175,
          anchorForwardOffset: 8,
          anchorOffsetY: -8,
          coneRadius: 132,
          coneSpreadDeg: 60,
          coneInnerRadius: 6,
          angleMode: "horizontal-only",
        },
        splash: {
          width: 150,
          height: 108,
          activeWindowMs: 450,
          flipUnlockMs: 530,
          damageTickMs: 90,
          damageStartMs: 100,
          tipOffset: 78,
          minHeight: 20,
          growDurationMs: 220,
          centerYFactor: 0.06,
          hitboxInflate: 2,
          remoteExplosionDelayMs: 500,
          remoteExplosionTipOffset: 78,
        },
      },
      special: {
        aim: {
          kind: "round",
          radius: 245,
          defaultRange: 245,
          anchorForwardOffset: 0,
          anchorOffsetY: -6,
        },
        inferno: {
          durationMs: 5000,
          riseMs: 650,
          liftPx: 125,
          bobPx: 8,
          fireRingRadius: 215,
          firePulseMs: 120,
          explosionPulseMs: 260,
        },
      },
      effects: {
        fireTrail: {
          intervalMs: 45,
          poolMax: 60,
          baseSizeMin: 5,
          baseSizeMax: 9,
          outerColor: 0x312841,
          outerAlpha: 0.35,
          midColor: 0xba5d22,
          midAlpha: 0.55,
          innerColorMin: 30,
          innerColorMax: 60,
          innerAlpha: 0.9,
          jitterMin: -3,
          jitterMax: 3,
          driftXMin: -12,
          driftXMax: 12,
          driftYMin: -18,
          driftYMax: -4,
          scaleTargetMin: 0.15,
          scaleTargetMax: 0.35,
          durationMinMs: 260,
          durationMaxMs: 420,
          spawnOffsetX: 14,
          spawnOffsetY: 8,
          spawnCountMin: 1,
          spawnCountMax: 2,
        },
      },
    },
    description: "A dark sorcerer who manipulates shadows.",
    unlockPrice: 280,
  },

  wizard: {
    baseHealth: 5000,
    attackDescription:
      "Releases a fireball that deals splash damage to everyone in the path.",
    baseDamage: 3000,
    ammoCooldownMs: 800,
    ammoReloadMs: 3000,
    ammoCapacity: 3,
    specialDescription: "Empowers the whole team with random powerups.",
    specialBaseDamage: 0,
    specialChargeHits: 5,
    specialChargePerHit: 0,
    spriteScale: 0.92,
    body: {
      widthShrink: 200,
      heightShrink: 115,
      offsetXFromHalf: 0,
      offsetY: 62,
      // Shift body to the right when facing left to cover staff
      flipOffset: 0,
    },
    tuning: {
      attack: {
        aim: {
          kind: "line",
          attackKey: "fireball",
          defaultRange: 1050,
          anchorForwardOffset: 38,
          anchorOffsetY: -6,
          reticleThickness: 55,
          angleMode: "free",
        },
        fireball: {
          speed: 450,
          range: 1050,
          visualRadius: 14,
          collisionRadius: 38,
          initialScale: 0.1,
          activeScale: 0.5,
          glowRadiusMultiplier: 1.35,
          bobAmplitude: 5,
          verticalOffset: 0.12,
          castDelayMs: 520,
          flipLockMs: 650,
          bobTweenMs: 220,
          forwardOffset: 0.23,
          bobFreqMs: 120,
          depth: 100,
          baseAngleDeg: -90,
        },
      },
      special: {
        aim: {
          kind: "round",
          radius: 67,
          defaultRange: 55,
          anchorForwardOffset: 0,
          anchorOffsetY: 4,
        },
      },
    },
    description: "Master of the fireball, wielder of the powerups.",
    unlockPrice: 200,
  },

  huntress: {
    baseHealth: 5500,
    attackDescription:
      "Fires three arrows in a slight spread, each dealing damage on impact.",
    baseDamage: 3000,
    ammoCooldownMs: 300,
    ammoReloadMs: 1667,
    ammoCapacity: 3,
    specialDescription:
      "Unleashes a wide volley of burning arrows that ignite enemies.",
    specialBaseDamage: 9000,
    specialChargeHits: 6,
    specialChargePerHit: 1,
    spriteScale: 1.5,
    body: {
      widthShrink: 80,
      heightShrink: 65,
      offsetXFromHalf: 5,
      offsetY: 63,
    },
    tuning: {
      attack: {
        aim: {
          kind: "throw",
          attackKey: "arrowSpread",
          minRange: 160,
          defaultRange: 500,
          maxRange: 500,
          anchorForwardOffset: 20,
          anchorOffsetY: 40,
          reticlePathOffsetY: 14,
          reticleThickness: 18,
          angleMode: "free",
          minSpeedScale: 459.2 / 900,
          maxSpeedScale: 1,
          trajectorySamples: 32,
          previewStartBackOffset: 4,
          previewStartLiftY: -6,
          previewEndDropY: 84,
          previewArcHeight: 72,
          previewCurveMagnitude: -10,
          previewCurveMode: "facing",
          previewCurveUpwardScale: 1.05,
          previewCurveMidBoost: 1.1,
          previewCurveVerticalScale: 0,
          previewArcHeightMinScale: 0.5,
          previewArcHeightUpwardScale: 0.62,
          previewEndDropMinScale: 0.7,
          previewEndDropUpwardScale: 0.68,
          throwMinOffsetX: -900,
          throwMaxOffsetX: 900,
          throwMinOffsetY: -430,
          throwMaxOffsetY: 300,
          quickTargetOffsetX: 760,
          quickTargetOffsetY: -24,
        },
        arrowSpread: {
          count: 3,
          spreadDeg: 6,
          speed: 900,
          range: 1000,
          collisionRadius: 16,
          damagePerArrow: 1000,
          visualScale: 0.22,
          castDelayMs: 100,
          flipLockMs: 600,
          forwardOffset: 0.12,
          verticalOffset: -0.16,
          embedMs: 2000,
          gravity: 460,
          maxLifetimeMs: 5000,
        },
      },
      special: {
        aim: {
          kind: "throw",
          specialKey: "burningVolley",
          minRange: 180,
          defaultRange: 820,
          maxRange: 1050,
          anchorForwardOffset: 34,
          anchorOffsetY: 14,
          reticlePathOffsetY: 14,
          reticleThickness: 42,
          angleMode: "free",
          minSpeedScale: 0.84,
          maxSpeedScale: 1.2,
          trajectorySamples: 36,
          previewStartBackOffset: 4,
          previewStartLiftY: -8,
          previewEndDropY: 96,
          previewArcHeight: 84,
          previewCurveMagnitude: -13,
          previewCurveMode: "facing",
          previewCurveUpwardScale: 1.1,
          previewCurveMidBoost: 1.2,
          previewCurveVerticalScale: 0,
          previewArcHeightMinScale: 0.52,
          previewArcHeightUpwardScale: 0.64,
          previewEndDropMinScale: 0.72,
          previewEndDropUpwardScale: 0.7,
          throwMinOffsetX: -980,
          throwMaxOffsetX: 980,
          throwMinOffsetY: -460,
          throwMaxOffsetY: 320,
          quickTargetOffsetX: 820,
          quickTargetOffsetY: -32,
          projectileAngleOffsetDeg: 0,
        },
        burningVolley: {
          count: 6,
          spreadDeg: 20,
          speed: 960,
          range: 960,
          collisionRadius: 18,
          damagePerArrow: 1000,
          visualScale: 0.24,
          castDelayMs: 230,
          releaseMs: 0,
          burnDurationMs: 5000,
          burnTotalDamage: 500,
          groundBurnMs: 2200,
          gravity: 360,
          maxLifetimeMs: 6000,
          embedMs: 2200,
        },
      },
    },
    description: "A precise ranged fighter who pins enemies down with arrows.",
    unlockPrice: 50,
  },

  gloop: {
    baseHealth: 7000,
    attackDescription:
      "Lobs a heavy slimeball that bounces twice and splats on the first enemy, coating them in slowing slime.",
    baseDamage: 2000,
    ammoCooldownMs: 400,
    ammoReloadMs: 1500,
    ammoCapacity: 1,
    specialDescription:
      "Launches a slime hand that catches an enemy, pulls them close, and leaves them heavily slowed.",
    specialBaseDamage: 500,
    specialChargeHits: 6,
    specialChargePerHit: 0,
    spriteScale: 1.2,
    body: {
      widthShrink: 100,
      heightShrink: 90,
      offsetXFromHalf: 1,
      offsetY: 86,
    },
    tuning: {
      attack: {
        aim: {
          kind: "throw",
          attackKey: "slimeball",
          defaultRange: 320,
          minRange: 60,
          maxRange: 400,
          anchorForwardOffset: 0,
          anchorOffsetY: 0,
          reticlePathOffsetY: 22,
          previewBounceThreshold: 120,
          reticleThickness: 8,
          angleMode: "free",
        },
        slimeball: {
          maxThrowRange: 400,
          maxLaunchSpeed: 330,
          maxUpwardSpeed: 270,
          speed: 390,
          range: 900,
          collisionRadius: 18,
          visualScale: 1.5,
          castDelayMs: 300,
          flipLockMs: 520,
          forwardOffset: 0.22,
          verticalOffset: -0.16,
          initialVy: -45,
          gravity: 340,
          maxBounces: 2,
          bounceDampingY: 0.66,
          bounceDampingX: 0.68,
          airDrag: 0.2,
          minBounceSpeed: 25,
          bounceFloorOffsetY: 80,
          maxLifetimeMs: 4200,
          slowDurationMs: 2000,
          slowSpeedMult: 0.7,
          slowJumpMult: 0.7,
          trailIntervalMs: 42,
          trailColor: 0x55c7ff,
        },
      },
      special: {
        aim: {
          kind: "line",
          specialKey: "hook",
          anchorKind: "gloop-hook",
          defaultRange: 760,
          anchorForwardOffset: 10,
          anchorOffsetY: 16,
          reticleThickness: 56,
          showFullReticleRange: true,
          angleMode: "free",
        },
        hook: {
          speed: 700,
          range: 780,
          collisionRadius: 44,
          damage: 500,
          pullDurationMs: 1000,
          pullLockPaddingMs: 120,
          pulledStopDistance: 10,
          slowDurationMs: 2200,
          slowSpeedMult: 0.5,
          slowJumpMult: 0.5,
          visualScale: 0.28,
          trailIntervalMs: 28,
        },
      },
    },
    description:
      "A sticky control fighter who slows enemies and reels them in.",
    unlockPrice: 100,
  },
};

export function getCharacterStats(character) {
  return characterStats[character] || undefined;
}

export function getCharacterTuning(character) {
  const stats = getCharacterStats(character);
  return (stats && stats.tuning) || {};
}

export function getAllCharacters() {
  return Object.keys(characterStats);
}

export function getFreeCharacters() {
  return Object.keys(characterStats).filter(
    (char) => characterStats[char].free,
  );
}

export function defaultCharacterList() {
  return Object.fromEntries(
    Object.keys(characterStats).map((char) => [
      char,
      characterStats[char].free ? 1 : 0,
    ]),
  );
}

export function getHealth(character, level) {
  const safeLevel = Math.max(1, Number(level) || 1);
  const standardLevels = Math.min(safeLevel, 5) - 1;
  const masteryLevels = Math.max(0, safeLevel - 5);
  return (
    characterStats[character].baseHealth +
    standardLevels * STANDARD_LEVEL_STAT_GAINS.health +
    masteryLevels * MASTERY_LEVEL_STAT_GAINS.health
  );
}

export function getDamage(character, level) {
  const safeLevel = Math.max(1, Number(level) || 1);
  const standardLevels = Math.min(safeLevel, 5) - 1;
  const masteryLevels = Math.max(0, safeLevel - 5);
  return (
    characterStats[character].baseDamage +
    standardLevels * STANDARD_LEVEL_STAT_GAINS.damage +
    masteryLevels * MASTERY_LEVEL_STAT_GAINS.damage
  );
}

// Charge is measured in landed hits, independent of level and damage modifiers.
export function getSuperChargeHits(character) {
  return Math.max(1, Number(characterStats[character]?.specialChargeHits) || 1);
}

// Each accepted projectile contact counts separately. Supers can contribute a
// fraction of a normal hit; unconfigured attack types never grant charge.
export function getSuperChargePerHit(character, attackType = "basic") {
  const stats = characterStats[character];
  if (!stats) return 0;
  if (attackType === "basic" ||
      (character === "huntress" && attackType === "huntress-arrow")) return 1;
  if (attackType === "special" ||
      (character === "ninja" && attackType === "ninja-special-swarm") ||
      (character === "huntress" && attackType === "huntress-burning-arrow")) {
    return Math.max(0, Number(stats.specialChargePerHit) || 0);
  }
  return 0;
}

export function getSpecialDamage(character, level) {
  const safeLevel = Math.max(1, Number(level) || 1);
  const standardLevels = Math.min(safeLevel, 5) - 1;
  const masteryLevels = Math.max(0, safeLevel - 5);
  return (
    characterStats[character].specialBaseDamage +
    standardLevels * STANDARD_LEVEL_STAT_GAINS.specialDamage +
    masteryLevels * MASTERY_LEVEL_STAT_GAINS.specialDamage
  );
}

// The level upgrade price reflects the current level the character is at
// If the character was at level 1 it would cost 200 to go to level 2
export function upgradePrice(level) {
  return UPGRADE_PRICES[Math.floor(Number(level))] ?? undefined;
}

export function unlockPrice(character) {
  return characterStats[character].unlockPrice || undefined;
}

// CommonJS export for server-side compatibility
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_CHARACTER,
    LEVEL_CAP,
    characterStats,
    getCharacterStats,
    getCharacterTuning,
    getAllCharacters,
    getFreeCharacters,
    defaultCharacterList,
    getHealth,
    getDamage,
    getSuperChargeHits,
    getSuperChargePerHit,
    getSpecialDamage,
    upgradePrice,
    unlockPrice,
  };
}
