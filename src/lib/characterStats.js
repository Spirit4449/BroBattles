// Character stats without dependencies on Phaser or character classes
// Single source of truth for all character stats and constants

// Default character for new users
export const DEFAULT_CHARACTER = "ninja";
export const LEVEL_CAP = 5;

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
    specialChargeHits: 4,
    specialChargeDamage: 4500,
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
    attackDescription:
      "Swings a heavy axe in a short arc, pushing back nearby enemies.",
    baseDamage: 1500,
    ammoCooldownMs: 400,
    ammoReloadMs: 800,
    ammoCapacity: 3,
    specialDescription:
      "Enters a purple rage that buffs weapon strikes and mobility.",
    specialBaseDamage: 2800,
    specialChargeHits: 5,
    specialChargeDamage: 6000,
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
          kind: "throw",
          attackKey: "fall",
          minRange: 50,
          defaultRange: 132,
          maxRange: 250,
          anchorForwardOffset: 26,
          anchorOffsetY: -10,
          minSpeedScale: 1.7,
          maxSpeedScale: 2.6,
          trajectorySamples: 32,
          previewStartBackOffset: 10,
          previewStartLiftY: -8,
          previewEndDropY: 0,
          previewArcHeight: 90,
          previewCurveMagnitude: 0,
          throwMinOffsetX: -220,
          throwMaxOffsetX: 190,
          throwMinOffsetY: -125,
          throwMaxOffsetY: 60,
          quickTargetOffsetX: 80,
          quickTargetOffsetY: 10,
        },
        fall: {
          rectWidth: 94,
          rectHeight: 46,
          windupMs: 180,
          strikeMs: 1000,
          followAfterWindupMs: 70,
          originOffsetX: 10,
          originHeightFactor: 0.5,
          startOffsetX: -10,
          startOffsetY: -8,
          range: 200,
          arcHeight: 90,
          curveMagnitude: 0,
          endYOffset: 320,
          damageTickMs: 90,
          hitboxInflate: 2,
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
      "Puffs out a magical smoke that deals splash baseDamage to everyone in the path.",
    baseDamage: 2500,
    ammoCooldownMs: 450,
    ammoReloadMs: 1600,
    ammoCapacity: 3,
    specialDescription: "Unleashes a staff nova that expands outward.",
    specialBaseDamage: 2400,
    specialChargeHits: 5,
    specialChargeDamage: 10000,
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
          radius: 215,
          defaultRange: 215,
          anchorForwardOffset: 0,
          anchorOffsetY: -6,
        },
        inferno: {
          durationMs: 3000,
          riseMs: 320,
          liftPx: 125,
          bobPx: 8,
          fireRingRadius: 185,
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
      "Puffs out a magical smoke that deals splash baseDamage to everyone in the path.",
    baseDamage: 3000,
    ammoCooldownMs: 800,
    ammoReloadMs: 3000,
    ammoCapacity: 3,
    specialDescription:
      "Empowers the whole team with random powerups.",
    specialBaseDamage: 0,
    specialChargeHits: 5,
    specialChargeDamage: 16000,
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
          castDelayMs: 300,
          flipLockMs: 500,
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
    description:
      "Master of the fireball, wielder of the powerups.",
    unlockPrice: 200,
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
  return characterStats[character].baseHealth + (level - 1) * 500;
}

export function getDamage(character, level) {
  return characterStats[character].baseDamage + (level - 1) * 100;
}

export function getSpecialDamage(character, level) {
  return characterStats[character].specialBaseDamage + (level - 1) * 200;
}

// The level upgrade price reflects the current level the character is at
// If the character was at level 1 it would cost 200 to go to level 2
export function upgradePrice(level) {
  return 200 * 2 ** (level - 1); // Doubles every level
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
    getSpecialDamage,
    upgradePrice,
    unlockPrice,
  };
}
