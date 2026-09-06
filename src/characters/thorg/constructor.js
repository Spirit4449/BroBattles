import { setThorgRageVisual } from "./rageVisual";
// src/characters/thorg/thorg.js
import socket from "../../socket";
import { characterStats } from "../../lib/characterStats.js";
import { getResolvedCharacterAttackConfig } from "../../lib/characterTuning.js";
import { animations } from "./anim";
import { executeDefaultAttack } from "../shared/attackFlow";
import { performThorgFallAttack, THORG_FALL_DURATION_MS, changeDebugState } from "./attack";
import { ensureThorgWeapon, startThorgSweep } from "./weapon";
import CharacterEntityBase from "../shared/characterEntityBase";
import {
  chooseRemoteAnimationState,
  playSpriteAnimation,
} from "../shared/animationState";

// Single source of truth for this character's name/key
const NAME = "thorg";
const FALL = getResolvedCharacterAttackConfig(NAME, "fall");

class Thorg extends CharacterEntityBase {
  static key = NAME;
  static WEAPON_FORWARD_OFFSET = FALL.spriteForwardOffset;
  // Main texture key used for this character's sprite
  static textureKey = NAME;

  static sounds = {
    attack: { key: "thorg-throw", volume: 0.6 },
    hit: { key: "thorg-hit", volume: 0.8 },
    special: { key: "thorg-throw", volume: 0.5, rate: 0.85 },
  };

  static preload(scene, staticPath = "/assets", options = {}) {
    const includeBaseAtlas = options?.includeBaseAtlas !== false;
    // Load atlas and projectile/sounds
    if (includeBaseAtlas) {
      scene.load.atlas(
        NAME,
        this.characterAssetPath(staticPath, "spritesheet.webp"),
        this.characterAssetPath(staticPath, "animations.json"),
      );
    }
    scene.load.image(
      `${NAME}-weapon`,
      this.characterAssetPath(staticPath, "weapon.webp"),
    );

    scene.load.audio(
      "thorg-throw",
      this.characterAssetPath(staticPath, "swoosh.mp3"),
    );
    scene.load.audio("thorg-sweep", this.characterAssetPath(staticPath, "sweep.wav"));
    if (!scene.sound.get("thorg-hit")) {
      scene.load.audio(
        "thorg-hit",
        this.characterAssetPath(staticPath, "hit.mp3"),
      );
    }
  }

  static setupAnimations(scene) {
    animations(scene);
  }

  static setDebugState(enabled) {
    changeDebugState(enabled);
  }

  // Remote attack visualization for Thorg: supports slash and falling rectangle
  static handleRemoteAttack(scene, data, ownerWrapper) {
    const ownerSprite = ownerWrapper ? ownerWrapper.opponent : null;
    if (!ownerSprite) return true; // nothing to show
    if (data.type === `${NAME}-slash`) {
      Thorg._spawnSlashEffect(
        scene,
        ownerSprite,
        data.direction,
        data.range,
        data.duration,
      );
      return true;
    }
    if (data.type === `${NAME}-fall`) {
      startThorgSweep(scene, ownerSprite, { direction: data.direction });
      return true;
    }
    return false;
  }

  // Shared helper to render the slash effect (graphics stroke arc)
  static _spawnSlashEffect(
    scene,
    sprite,
    direction = 1,
    range = 20,
    duration = 300,
  ) {
    // If we have an image, animate it along an overhead oval path. Otherwise, fallback to vector band.
    const spriteTextureKey =
      sprite?._bbSkinTextureKey || sprite?.texture?.key || "";
    const skinWeaponKey =
      spriteTextureKey && scene.textures.exists(`${spriteTextureKey}-weapon`)
        ? `${spriteTextureKey}-weapon`
        : null;
    const weaponKey = skinWeaponKey || `${NAME}-weapon`;
    const hasTex = scene.textures.exists(weaponKey);
    const originOffsetY = sprite.height * 0.1;
    const cx = () => sprite.x + (direction >= 0 ? 10 : -10);
    const cy = () => sprite.y - originOffsetY;
    const rx = range;
    const ry = Math.round(range * 0.6);
    const startRad = Phaser.Math.DegToRad(-90);
    const endRad = Phaser.Math.DegToRad(90);

    if (hasTex) {
      const eff = scene.add.image(cx(), cy(), weaponKey);
      eff.setDepth(6);
      eff.setScale(0.9);
      eff.setOrigin(direction >= 0 ? 0.1 : 0.9, 0.5); // pivot near the sword
      eff.setFlipX(direction < 0);

      const proxy = { t: 0 };
      const tween = scene.tweens.add({
        targets: proxy,
        t: 1,
        duration,
        ease: "Sine.easeOut",
        onUpdate: () => {
          const a = Phaser.Math.Linear(startRad, endRad, proxy.t);
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          eff.x = cx() + direction * rx * cos;
          eff.y = cy() + ry * sin;
          // Face along tangent of the path
          const tangent = Math.atan2(
            ry * Math.cos(a),
            -direction * rx * Math.sin(a),
          );
          eff.rotation = tangent;
        },
        onComplete: () => {
          eff.destroy();
        },
      });
      return tween;
    }

    // Fallback: draw an additive oval band (previous implementation)
    const g = scene.add.graphics();
    g.setDepth(5);
    g.setBlendMode(Phaser.BlendModes.ADD);
    const mainColor = 0x9ed1ff;
    const outlineColor = 0xe4f5ff;
    const thickness = Math.max(14, Math.round(range * 0.22));
    const rxInner = Math.max(6, rx - thickness);
    const ryInner = Math.max(4, ry - Math.round(thickness * 0.75));

    const ept = (theta, rx0, ry0) => ({
      x: cx() + direction * rx0 * Math.cos(theta),
      y: cy() + ry0 * Math.sin(theta),
    });

    const proxy = { t: 0 };
    const steps = 18;
    return scene.tweens.add({
      targets: proxy,
      t: 1,
      duration,
      ease: "Sine.easeOut",
      onUpdate: () => {
        const now = Phaser.Math.Linear(startRad, endRad, proxy.t);
        const t0 = Phaser.Math.Linear(
          startRad,
          now,
          Math.max(0, proxy.t - 0.25),
        );
        g.clear();
        g.fillStyle(mainColor, 0.85);
        g.beginPath();
        for (let i = 0; i <= steps; i++) {
          const a = Phaser.Math.Linear(t0, now, i / steps);
          const p = ept(a, rx, ry);
          if (i === 0) g.moveTo(p.x, p.y);
          else g.lineTo(p.x, p.y);
        }
        for (let i = steps; i >= 0; i--) {
          const a = Phaser.Math.Linear(t0, now, i / steps);
          const p = ept(a, rxInner, ryInner);
          g.lineTo(p.x, p.y);
        }
        g.closePath();
        g.fillPath();
        g.lineStyle(
          Math.max(2, Math.floor(thickness * 0.3)),
          outlineColor,
          0.9,
        );
        g.beginPath();
        for (let i = 0; i <= steps; i++) {
          const a = Phaser.Math.Linear(
            Math.max(t0, now - 0.25),
            now,
            i / steps,
          );
          const p = ept(a, rx + 2, ry + 1);
          if (i === 0) g.moveTo(p.x, p.y);
          else g.lineTo(p.x, p.y);
        }
        g.strokePath();
      },
      onComplete: () => g.destroy(),
    });
  }

  // Per-character gameplay and presentation stats
  static getStats() {
    return characterStats.thorg;
  }

  static chooseRemoteAnimation({
    animation = "idle",
    previousPosition,
    currentPosition,
    sprite,
  } = {}) {
    if (sprite?.scene) ensureThorgWeapon(sprite.scene, sprite);
    return chooseRemoteAnimationState({
      animation,
      previousPosition,
      currentPosition,
      sprite,
      character: NAME,
    });
  }

  static applyPowerupFx({
    scene,
    sprite,
    effects,
    nowSec,
    colors,
    spawnTrailParticle,
  } = {}) {
    if (!scene || !sprite || !effects)
      return { handled: false, rageLike: false };
    const thorgRageOn = (effects.thorgRage || 0) > 0;
    setThorgRageVisual(scene, sprite, thorgRageOn);
    if (!thorgRageOn) return { handled: false, rageLike: false };

    const pulse = 0.5 + 0.5 * Math.sin(nowSec * 10 + (sprite.x || 0) * 0.012);
    sprite.setTint(pulse > 0.52 ? 0xc084fc : 0x7e22ce);

    if (typeof spawnTrailParticle === "function" && Math.random() < 0.72) {
      spawnTrailParticle(
        sprite.x + Phaser.Math.Between(-18, 18),
        sprite.y + Phaser.Math.Between(-34, 14),
        colors?.thorgRage || 0x9333ea,
        Phaser.Math.FloatBetween(3.6, 6.2),
        340,
      );
    }
    if (typeof spawnTrailParticle === "function" && Math.random() < 0.28) {
      spawnTrailParticle(
        sprite.x + Phaser.Math.Between(-12, 12),
        sprite.y + Phaser.Math.Between(-38, 4),
        0xffffff,
        Phaser.Math.FloatBetween(2.6, 4.2),
        260,
      );
    }

    return { handled: true, rageLike: true };
  }

  static drawPowerupAura({ graphics, frame, effects, nowSec, colors } = {}) {
    if (!graphics || !frame || !effects) return false;
    if ((effects.thorgRage || 0) <= 0) return false;
    const x = frame.x;
    const y = frame.y;
    const r = frame.radius;
    const pulse = 0.75 + 0.25 * Math.sin(nowSec * 8 + x * 0.01);

    graphics.fillStyle(colors?.thorgRage || 0x9333ea, 0.22 + 0.08 * pulse);
    graphics.fillCircle(x, y, r + 6 + 5 * pulse);
    graphics.lineStyle(4.5, colors?.thorgRage || 0x9333ea, 0.88 * pulse);
    graphics.strokeCircle(x, y, r + 12 + 5 * pulse);
    graphics.lineStyle(
      3,
      0xffffff,
      0.28 + 0.18 * Math.abs(Math.sin(nowSec * 18 + y * 0.02)),
    );
    graphics.strokeCircle(x, y, r + 18 + 2.5 * pulse);
    return true;
  }

  static getPowerupMobilityModifier(effects = {}) {
    if ((effects.thorgRage || 0) > 0) {
      return { speedMult: 1.12, jumpMult: 1.12 };
    }
    return { speedMult: 1, jumpMult: 1 };
  }

  static getEffectTickSounds() {
    return {
      thorgRage: {
        key: "pu-tick-rage",
        options: { volume: 0.24, rate: 0.78 },
      },
    };
  }

  constructor(deps) {
    super(deps);
    ensureThorgWeapon(this.scene, this.player);
  }

  // Common default behavior for firing attacks
  performDefaultAttack(payloadBuilder, onAfterFire) {
    const result = executeDefaultAttack({
      scene: this.scene,
      ammo: this.ammo,
      emitAction: (payload) => socket.emit("game:action", payload),
      payloadBuilder,
      onAfterFire,
      attackResetMs: THORG_FALL_DURATION_MS,
    });
    return !!result.fired;
  }

  handlePointerDown(attackContext = null) {
    const context = attackContext || this.consumeAttackContext();
    // Use the shared Thorg fall attack implementation (owner-side hits + payload)
    return this.performDefaultAttack(() =>
      performThorgFallAttack(this, context),
    );
  }

}

export default Thorg;
