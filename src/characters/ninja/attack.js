// ReturningShuriken.js
// Curved, returning, piercing shuriken with deterministic local simulation.

import socket from "../../socket"; // owner-only hit events

export default class ReturningShuriken extends Phaser.Physics.Arcade.Image {
  /**
   * @param {Phaser.Scene} scene
   * @param {{x:number,y:number}} startPos
   * @param {Phaser.Physics.Arcade.Sprite} ownerSprite
   * @param {Object} config
   */
  constructor(scene, startPos, ownerSprite, config) {
    // Create image and guard against missing texture; make invisible until ready
    super(scene, startPos.x, startPos.y, "shuriken");
    this.ownerSprite = ownerSprite;
    this.cfg = Object.assign(
      {
        direction: 1,
        forwardDistance: 520,
        endYOffset: 0,
        outwardDuration: 600, // ms
        returnSpeed: 580, // px/s (cap)
        rotationSpeed: 950, // deg/s
        scale: 0.1,
        damage: 1000,
        glowScale: 1,
        attackType: "basic",
        instanceId: null,
        username: "",
        gameId: "",
        isOwner: false,
        maxLifetime: 7000,
        hitCooldown: 300,
        ctrl1YOffset: 20,
        ctrl2YOffset: -40,
      },
      config || {}
    );

    // Phase state
    this.phase = "outward"; // outward -> hover -> return
    this.elapsed = 0; // ms in current phase
    this.totalElapsed = 0; // ms total life
    this.hoverDuration = 100; // ms to hover before returning
    this.returnAcceleration = 800; // px/s^2
    this.currentReturnSpeed = this.cfg.returnSpeed * 0.08; // ramp up
    this.hitTimestamps = {}; // username -> last hit ms

    // Trail state
    this.trailInterval = 30; // ms
    this.trailAccum = 0;
    this.trails = [];
    this.maxTrails = 40;

    // If texture isn't ready yet (edge case), keep invisible and set once available
    try {
      const hasTex = scene.textures?.exists("shuriken");
      if (!hasTex) {
        this.setVisible(false);
        const tryBind = () => {
          try {
            if (scene.textures?.exists("shuriken")) {
              this.setTexture("shuriken");
              this.setVisible(true);
            }
          } catch (_) {}
        };
        scene.load?.once(Phaser.Loader.Events.COMPLETE, tryBind);
        scene.textures?.once(Phaser.Textures.Events.ADD, (key) => {
          if (key === "shuriken") tryBind();
        });
      }
    } catch (_) {}

    // Add to scene / physics
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setScale(this.cfg.scale);
    this.body.allowGravity = false;
    this.setDepth(5);
    this.setAngularVelocity(this.cfg.rotationSpeed * this.cfg.direction);

    // Path control points (slight dip then bulge)
    this.startX = startPos.x;
    this.startY = startPos.y;
    this.endX = this.startX + this.cfg.direction * this.cfg.forwardDistance;
    this.endY = this.startY + (this.cfg.endYOffset || 0);
    const dipDown = Number.isFinite(this.cfg.ctrl1YOffset)
      ? this.cfg.ctrl1YOffset
      : 20;
    const bulgeUp = Number.isFinite(this.cfg.ctrl2YOffset)
      ? Math.abs(this.cfg.ctrl2YOffset)
      : 40;
    this.ctrl1X =
      this.startX + this.cfg.direction * this.cfg.forwardDistance * 0.25;
    this.ctrl1Y = this.startY + dipDown;
    this.ctrl2X =
      this.startX + this.cfg.direction * this.cfg.forwardDistance * 0.6;
    this.ctrl2Y = this.startY - bulgeUp + (this.cfg.endYOffset || 0) * 0.45;

    // Unified subtle glow (blue if owner, red otherwise)
    const glowColor = this.cfg.isOwner ? 0x2e9bff : 0xff3a2e;
    this.glow = scene.add.graphics();
    this.glow.setDepth(this.depth - 1);
    this.glow.setBlendMode(Phaser.BlendModes.ADD);
    this._drawGlow(glowColor);
    scene.tweens.add({
      targets: this.glow,
      scale: { from: 0.95, to: 1.15 },
      alpha: { from: 0.9, to: 0.55 },
      duration: 600,
      repeat: -1,
      yoyo: true,
      ease: "Sine.easeInOut",
    });

    this.scene.events.on("update", this.updateShuriken, this);
  }

  _drawGlow(colorInt) {
    const glowScale = Math.max(0.8, Number(this.cfg.glowScale) || 1);
    const baseRadius = 85 * this.cfg.scale * glowScale;
    const innerRadius = baseRadius * 0.42;
    const midRadius = baseRadius * 0.9;
    const outerRadius = baseRadius * 1.2;
    const c = Phaser.Display.Color.IntegerToColor(colorInt);
    this.glow.clear();
    this.glow.x = this.x;
    this.glow.y = this.y;
    this.glow.fillStyle(c.color, 0.42);
    this.glow.fillCircle(0, 0, outerRadius);
    this.glow.fillStyle(c.color, 0.72);
    this.glow.fillCircle(0, 0, midRadius);
    this.glow.fillStyle(c.color, 0.95);
    this.glow.fillCircle(0, 0, innerRadius);
  }

  // Cubic Bezier interpolation helper
  cubic(t, p0, p1, p2, p3) {
    const it = 1 - t;
    return (
      it * it * it * p0 +
      3 * it * it * t * p1 +
      3 * it * t * t * p2 +
      t * t * t * p3
    );
  }

  tryDamage(targetWrapper) {
    if (!this.cfg.isOwner) return false; // only owner reports hits
    if (!targetWrapper) return false;
    const targetUsername =
      targetWrapper.username ||
      targetWrapper._username ||
      targetWrapper.name ||
      "unknown";
    const now = this.scene.time.now;
    const last = this.hitTimestamps[targetUsername] || 0;
    if (now - last < this.cfg.hitCooldown) return false;
    this.hitTimestamps[targetUsername] = now;
    // Emit server-authoritative damage event
    socket.emit("hit", {
      attacker: this.cfg.username,
      target: targetUsername,
      damage: this.cfg.damage,
      attackType: this.cfg.attackType || "basic",
      instanceId: this.cfg.instanceId,
      gameId: this.cfg.gameId,
    });
    // Play hit SFX locally for the owner
    try {
      this.scene.sound.play("shurikenHit", { volume: 1, rate: 1.0 });
    } catch (e) {}
    return true;
  }

  attachEnemyOverlap(objects) {
    objects.forEach((obj) => {
      if (!obj) return;
      const sprite = obj.opponent || obj;
      this.scene.physics.add.overlap(this, sprite, () => {
        this.tryDamage(obj.opponent ? obj : sprite);
      });
    });
  }

  attachMapOverlap() {
    // Intentionally blank (projectile ignores map now)
  }

  spawnTrail() {
    if (!this.scene.textures.exists("shuriken")) return;
    const s = this.scene.add.image(this.x, this.y, "shuriken");
    s.setScale(this.cfg.scale * 0.48);
    s.setDepth(4);
    s.alpha = 0.35;
    this.scene.tweens.add({
      targets: s,
      alpha: 0,
      scale: { from: s.scale, to: s.scale * 0.15 },
      duration: 300,
      ease: "Cubic.easeOut",
      onComplete: () => s.destroy(),
    });
    this.trails.push(s);
    if (this.trails.length > this.maxTrails) {
      const old = this.trails.shift();
      if (old && old.destroy) old.destroy();
    }
  }

  destroyShuriken() {
    if (!this.scene) return;
    this.scene.events.off("update", this.updateShuriken, this);
    this.trails.forEach((t) => t && t.destroy && t.destroy());
    this.trails.length = 0;
    if (this.glow && this.glow.destroy) this.glow.destroy();
    this.destroy();
  }

  updateShuriken(_, delta) {
    if (!this.active) return;
    this.elapsed += delta;
    this.totalElapsed += delta;
    this.trailAccum += delta;
    if (this.trailAccum >= this.trailInterval) {
      this.spawnTrail();
      this.trailAccum = 0;
    }
    if (this.totalElapsed > this.cfg.maxLifetime) {
      this.destroyShuriken();
      return;
    }

    if (this.phase === "outward") {
      const rawT = Phaser.Math.Clamp(
        this.elapsed / this.cfg.outwardDuration,
        0,
        1
      );
      const t = (1 - Math.cos(Math.PI * rawT)) / 2; // ease in-out
      const nx = this.cubic(
        t,
        this.startX,
        this.ctrl1X,
        this.ctrl2X,
        this.endX
      );
      const ny = this.cubic(
        t,
        this.startY,
        this.ctrl1Y,
        this.ctrl2Y,
        this.endY
      );
      this.setPosition(nx, ny);
      if (rawT >= 1) {
        this.phase = "hover";
        this.elapsed = 0;
        this.setAngularVelocity(
          this.cfg.rotationSpeed * 0.55 * this.cfg.direction
        );
      }
    } else if (this.phase === "hover") {
      if (this.elapsed >= this.hoverDuration) {
        this.phase = "return";
        this.elapsed = 0;
        this.setAngularVelocity(
          this.cfg.rotationSpeed * 1.15 * this.cfg.direction
        );
      }
    } else if (this.phase === "return") {
      if (!this.ownerSprite || !this.ownerSprite.active) {
        this.x +=
          this.cfg.direction * (this.currentReturnSpeed * (delta / 1000));
      } else {
        const dx = this.ownerSprite.x - this.x;
        const dy = this.ownerSprite.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        this.currentReturnSpeed = Math.min(
          this.cfg.returnSpeed,
          this.currentReturnSpeed + this.returnAcceleration * (delta / 1000)
        );
        const spd = this.currentReturnSpeed * (delta / 1000);
        this.setPosition(
          this.x + (dx / dist) * spd,
          this.y + (dy / dist) * spd
        );
        if (dist < 30) {
          if (
            this.cfg.isOwner &&
            this.onReturn &&
            typeof this.onReturn === "function"
          ) {
            try {
              this.onReturn();
            } catch (e) {
              /* silent */
            }
          }
          this.destroyShuriken();
          return;
        }
      }
    }

    // Update glow position
    if (this.glow) {
      this.glow.x = this.x;
      this.glow.y = this.y;
    }
  }
}
