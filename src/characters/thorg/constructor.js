// src/characters/thorg/thorg.js
import socket from "../../socket";
import {
  characterStats,
} from "../../lib/characterStats.js";
import { getResolvedCharacterAttackConfig } from "../../lib/characterTuning.js";
import { animations } from "./anim";
import { executeDefaultAttack } from "../shared/attackFlow";
import {
  performThorgFallAttack,
  THORG_FALL_WINDUP_MS,
  THORG_FALL_STRIKE_MS,
  THORG_FALL_DURATION_MS,
  THORG_FALL_FOLLOW_AFTER_WINDUP_MS,
  THORG_FALL_RANGE,
  THORG_FALL_ARC_HEIGHT,
  THORG_FALL_CURVE_MAGNITUDE,
  THORG_FALL_END_Y_OFFSET,
  changeDebugState,
} from "./attack";
import CharacterEntityBase from "../shared/characterEntityBase";

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

  static preload(scene, staticPath = "/assets") {
    // Load atlas and projectile/sounds
    scene.load.atlas(
      NAME,
      this.characterAssetPath(staticPath, "spritesheet.webp"),
      this.characterAssetPath(staticPath, "animations.json"),
    );
    scene.load.image(
      `${NAME}-weapon`,
      this.characterAssetPath(staticPath, "weapon.webp"),
    );

    scene.load.audio(
      "thorg-throw",
      this.characterAssetPath(staticPath, "swoosh.mp3"),
    );
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
      try {
        if (scene.anims?.exists(`${NAME}-throw`)) {
          ownerSprite.anims.play(`${NAME}-throw`, true);
        }
      } catch (_) {}
      Thorg._spawnFallEffect(
        scene,
        ownerSprite,
        data.direction,
        Number(data.range) || THORG_FALL_RANGE,
      );
      // Play attack sound for remote players (lower volume)
      try {
        scene.sound?.play("thorg-throw", { volume: 0.25 });
      } catch (_) {}
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
    const hasTex = scene.textures.exists(`${NAME}-weapon`);
    const originOffsetY = sprite.height * 0.1;
    const cx = () => sprite.x + (direction >= 0 ? 10 : -10);
    const cy = () => sprite.y - originOffsetY;
    const rx = range;
    const ry = Math.round(range * 0.6);
    const startRad = Phaser.Math.DegToRad(-90);
    const endRad = Phaser.Math.DegToRad(90);

    if (hasTex) {
      const eff = scene.add.image(cx(), cy(), `${NAME}-weapon`);
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
    let chosenAnim = animation || "idle";
    const currentX =
      currentPosition?.x ?? previousPosition?.x ?? sprite?.x ?? 0;
    const previousX =
      previousPosition?.x ?? currentPosition?.x ?? sprite?.x ?? 0;
    const currentY =
      currentPosition?.y ?? previousPosition?.y ?? sprite?.y ?? 0;
    const previousY =
      previousPosition?.y ?? currentPosition?.y ?? sprite?.y ?? 0;
    const dx = currentX - previousX;
    const dy = currentY - previousY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const vx = Number(currentPosition?.vx);
    const vy = Number(currentPosition?.vy);
    const absVx = Math.abs(vx);
    const grounded =
      typeof currentPosition?.grounded === "boolean"
        ? currentPosition.grounded
        : undefined;
    const currentAnimKey = String(sprite?.anims?.currentAnim?.key || "");
    const attackLike =
      typeof chosenAnim === "string" && /throw|attack|slash/i.test(chosenAnim);
    const slideLike =
      typeof chosenAnim === "string" && /slide/i.test(chosenAnim);
    const alreadyThrowing = /thorg-throw$/i.test(currentAnimKey);
    const alreadySliding = /thorg-sliding$/i.test(currentAnimKey);

    if (slideLike || (alreadySliding && grounded === false)) {
      return grounded === false ? "sliding" : "idle";
    }

    if (attackLike) {
      if (grounded === false || absDy > 1.8 || Math.abs(vy) > 70) {
        chosenAnim = dy < 0 ? "jumping" : "falling";
      } else if (absDx > 1.2 || absVx > 35) {
        chosenAnim = "running";
      } else {
        // Keep the attack presentation stable instead of dropping back to idle
        // on low-motion snapshots between throw frames.
        chosenAnim = alreadyThrowing ? "throw" : "idle";
      }
      return chosenAnim;
    }

    if (grounded === false || absDy > 2.2 || Math.abs(vy) > 85) {
      return dy < 0 || vy < -20 ? "jumping" : "falling";
    }
    if (absDx <= 0.7 && absVx <= 20) {
      return "idle";
    }
    if (chosenAnim === "idle" && (absDx > 0.7 || absVx > 20)) {
      return "running";
    }
    return chosenAnim;
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
    if (!thorgRageOn) return { handled: false, rageLike: false };

    const pulse = 0.5 + 0.5 * Math.sin(nowSec * 10 + (sprite.x || 0) * 0.012);
    sprite.setTint(pulse > 0.52 ? 0xc084fc : 0x7e22ce);

    const baseX = sprite._puBaseScaleX || 1;
    const baseY = sprite._puBaseScaleY || 1;
    const baseOriginX = sprite._puBaseOriginX ?? 0.5;
    const baseOriginY = sprite._puBaseOriginY ?? 0.5;
    sprite.setScale(baseX * 1.14, baseY * 1.14);
    sprite.setOrigin(baseOriginX, baseOriginY);

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
      thorgRage: { key: "pu-tick-rage", options: { volume: 0.22, rate: 0.9 } },
    };
  }

  constructor(deps) {
    super(deps);
  }

  // Common default behavior for firing attacks
  performDefaultAttack(payloadBuilder, onAfterFire) {
    const result = executeDefaultAttack({
      scene: this.scene,
      ammo: this.ammo,
      emitAction: (payload) => socket.emit("game:action", payload),
      payloadBuilder,
      onAfterFire,
      attackResetMs: 250,
    });
    return !!result.fired;
  }

  handlePointerDown(attackContext) {
    const context = attackContext || this.consumeAttackContext();
    // Use the shared Thorg fall attack implementation (owner-side hits + payload)
    return this.performDefaultAttack(() =>
      performThorgFallAttack(this, context),
    );
  }

  // Spawn a simple rectangle visual attached to owner that mimics the falling arc
  static _spawnFallEffect(
    scene,
    sprite,
    direction = 1,
    rangeScale = THORG_FALL_RANGE,
  ) {
    const baseAngle = 0;
    const getAnchor = () => ({
      x: sprite.x + direction * FALL.originOffsetX,
      y: sprite.y - sprite.height * FALL.originHeightFactor,
    });
    let strikeStartX = 0;
    let strikeStartY = 0;
    const range = rangeScale;
    let endX = 0;
    let endY = 0;
    const arcHeight = THORG_FALL_ARC_HEIGHT;
    const curveMagnitude = THORG_FALL_CURVE_MAGNITUDE;
    const resolveStrikePath = () => {
      const a = getAnchor();
      strikeStartX = a.x + direction * FALL.startOffsetX;
      strikeStartY = a.y + FALL.startOffsetY;
      endX = strikeStartX + direction * range;
      endY = a.y + THORG_FALL_END_Y_OFFSET;
    };
    const samplePath = (t) => {
      const clamped = Phaser.Math.Clamp(t, 0, 1);
      const curve = Math.sin(Math.PI * clamped) * (curveMagnitude * direction);
      const x = Phaser.Math.Linear(strikeStartX, endX, clamped) + curve;
      const y =
        Phaser.Math.Linear(strikeStartY, endY, clamped) -
        arcHeight * Math.sin(Math.PI * clamped);
      return { x, y };
    };

    // Prefer an animated texture for the bat; if not available, create no visible hitbox
    try {
      const texKey = scene.textures.exists(`${NAME}-bat`)
        ? `${NAME}-bat`
        : scene.textures.exists(`${NAME}-weapon`)
          ? `${NAME}-weapon`
          : null;
      if (!texKey) {
        // Invisible placeholder (no visible hitbox)
        return null;
      }
      const startAnchor = getAnchor();
      const eff = scene.add.sprite(startAnchor.x, startAnchor.y, texKey);
      eff.setDepth(7);
      eff.setScale(0.72);
      eff.setFlipX(false);
      const baseAim = direction >= 0 ? 0 : Math.PI;
      const baseRot = baseAim + Thorg.WEAPON_FORWARD_OFFSET + direction * 0.08;
      const windupRot = baseRot - direction * 0.35;
      eff.rotation = baseRot;
      const animName = `${texKey}-fly`;
      if (scene.anims && scene.anims.exists(animName)) {
        eff.anims.play(animName);
      }
      scene.tweens.add({
        targets: eff,
        scale: 1.16,
        duration: THORG_FALL_STRIKE_MS,
        delay: THORG_FALL_WINDUP_MS,
        ease: "Sine.easeOut",
      });

      let elapsed = 0;
      let strikeStarted = false;
      const renderVis = () => {
        if (!eff.active) return;

        const dt = scene.game?.loop?.delta || 16;
        elapsed += dt;

        if (!strikeStarted) {
          const windupT = Phaser.Math.Clamp(
            elapsed / THORG_FALL_WINDUP_MS,
            0,
            1,
          );
          if (sprite?.active) {
            const leanDeg = Phaser.Math.Linear(0, -8 * direction, windupT);
            sprite.setAngle(baseAngle + leanDeg);
          }
          const followAnchor = getAnchor();
          const windupBackX = followAnchor.x - direction * 18;
          const windupBackY = followAnchor.y - 12;
          eff.x = Phaser.Math.Linear(followAnchor.x, windupBackX, windupT);
          eff.y = Phaser.Math.Linear(followAnchor.y, windupBackY, windupT);
          eff.rotation = Phaser.Math.Linear(baseRot, windupRot, windupT);
          if (elapsed < THORG_FALL_WINDUP_MS) return;
          strikeStarted = true;
          if (sprite?.active) sprite.setAngle(baseAngle + 4 * direction);
          resolveStrikePath();
        }

        const strikeElapsed = Math.max(0, elapsed - THORG_FALL_WINDUP_MS);
        const tNow = Phaser.Math.Clamp(
          strikeElapsed / THORG_FALL_STRIKE_MS,
          0,
          1,
        );
        if (
          elapsed <=
          THORG_FALL_WINDUP_MS + THORG_FALL_FOLLOW_AFTER_WINDUP_MS
        ) {
          resolveStrikePath();
        }
        const pt = samplePath(tNow);
        const nextPt = samplePath(Math.min(1, tNow + 0.035));
        eff.x = pt.x;
        eff.y = pt.y;
        const targetRot =
          Math.atan2(nextPt.y - pt.y, nextPt.x - pt.x) +
          direction * 0.1 +
          Thorg.WEAPON_FORWARD_OFFSET;
        const delta = Phaser.Math.Angle.Wrap(targetRot - baseRot);
        eff.rotation = baseRot + delta * 0.5;

        if (elapsed >= THORG_FALL_DURATION_MS) {
          scene.events.off("update", renderVis);
          if (sprite?.active) sprite.setAngle(0);
          if (eff.active) eff.destroy();
        }
      };

      scene.events.on("update", renderVis);
      scene.time.delayedCall(THORG_FALL_DURATION_MS + 30, () => {
        scene.events.off("update", renderVis);
        if (sprite?.active) sprite.setAngle(0);
        if (eff.active) eff.destroy();
      });
      return eff;
    } catch (e) {
      return null;
    }
  }
}

export default Thorg;
