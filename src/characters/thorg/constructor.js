// src/characters/thorg/thorg.js
import socket from "../../socket";
import { characterStats } from "../../lib/characterStats.js";
import { animations } from "./anim";
import { performThorgFallAttack } from "./attack";

// Single source of truth for this character's name/key
const NAME = "thorg";

class Thorg {
  static WEAPON_FORWARD_OFFSET = -Math.PI / 2; // weapon art points downward at rotation=0
  // Main texture key used for this character's sprite
  static textureKey = NAME;
  static getTextureKey() {
    return Thorg.textureKey;
  }
  static preload(scene, staticPath = "/assets") {
    // Load atlas and projectile/sounds
    scene.load.atlas(
      NAME,
      `${staticPath}/${NAME}/spritesheet.webp`,
      `${staticPath}/${NAME}/animations.json`,
    );

    scene.load.audio("thorg-throw", `${staticPath}/${NAME}/swoosh.mp3`);
    if (!scene.sound.get("thorg-hit")) {
      scene.load.audio("thorg-hit", `${staticPath}/${NAME}/hit.mp3`);
    }
  }

  static setupAnimations(scene) {
    animations(scene);
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
      Thorg._spawnFallEffect(scene, ownerSprite, data.direction);
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

  constructor({
    scene,
    player,
    username,
    gameId,
    opponentPlayersRef,
    mapObjects,
    ammoHooks,
  }) {
    this.scene = scene;
    this.player = player;
    this.username = username;
    this.gameId = gameId;
    this.opponentPlayersRef = opponentPlayersRef;
    this.mapObjects = mapObjects;
    this.ammo = ammoHooks;
  }

  attachInput() {
    this.scene.input.on("pointerdown", () => this.handlePointerDown());
  }

  // Common default behavior for firing attacks
  performDefaultAttack(payloadBuilder, onAfterFire) {
    const {
      getAmmoCooldownMs,
      tryConsume,
      setCanAttack,
      setIsAttacking,
      drawAmmoBar,
    } = this.ammo;

    if (!tryConsume()) return false;
    setIsAttacking(true);
    setCanAttack(false);

    const cooldown = getAmmoCooldownMs();
    this.scene.time.delayedCall(cooldown, () => setCanAttack(true));
    setTimeout(() => setIsAttacking(false), 250);

    const payload =
      typeof payloadBuilder === "function" ? payloadBuilder() : null;
    if (payload) socket.emit("game:action", payload);
    drawAmmoBar();
    if (typeof onAfterFire === "function") onAfterFire();
    return true;
  }

  handlePointerDown() {
    // Use the shared Thorg fall attack implementation (owner-side hits + payload)
    return this.performDefaultAttack(() => performThorgFallAttack(this));
  }

  // Spawn a simple rectangle visual attached to owner that mimics the falling arc
  static _spawnFallEffect(scene, sprite, direction = 1) {
    const WINDUP_MS = 180;
    const STRIKE_MS = 290;
    const FOLLOW_AFTER_WINDUP_MS = 70;
    const getAnchor = () => ({
      x: sprite.x + (direction >= 0 ? 10 : -10),
      y: sprite.y - sprite.height * 0.5,
    });
    let strikeStartX = 0;
    let strikeStartY = 0;
    const range = 140;
    let endX = 0;
    let endY = 0;
    const arcHeight = 90;
    const curveMagnitude = 14;
    const resolveStrikePath = () => {
      const a = getAnchor();
      strikeStartX = a.x - direction * 14;
      strikeStartY = a.y - 8;
      endX = strikeStartX + direction * range;
      endY = a.y + 110;
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
      eff.setScale(0.9);
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
        scale: 1.25,
        duration: STRIKE_MS,
        delay: WINDUP_MS,
        ease: "Sine.easeOut",
      });

      const bornAt = scene.time.now;
      const renderVis = () => {
        if (!eff.active) return;
        const elapsed = scene.time.now - bornAt;
        if (elapsed < WINDUP_MS) {
          const windupT = Phaser.Math.Clamp(elapsed / WINDUP_MS, 0, 1);
          const followAnchor = getAnchor();
          const windupBackX = followAnchor.x - direction * 18;
          const windupBackY = followAnchor.y - 12;
          eff.x = Phaser.Math.Linear(followAnchor.x, windupBackX, windupT);
          eff.y = Phaser.Math.Linear(followAnchor.y, windupBackY, windupT);
          eff.rotation = Phaser.Math.Linear(baseRot, windupRot, windupT);
          return;
        }

        const strikeElapsed = Math.max(0, elapsed - WINDUP_MS);
        const tNow = Phaser.Math.Clamp(strikeElapsed / STRIKE_MS, 0, 1);
        if (elapsed <= WINDUP_MS + FOLLOW_AFTER_WINDUP_MS) {
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
      };

      scene.events.on("update", renderVis);
      scene.time.delayedCall(WINDUP_MS + STRIKE_MS + 30, () => {
        scene.events.off("update", renderVis);
        if (eff.active) eff.destroy();
      });
      return eff;
    } catch (e) {
      return null;
    }
  }
}

export default Thorg;
