// Draven-specific per-player effects (fire trail)
import { getCharacterTuning } from "../../lib/characterStats.js";

const DRAVEN_TUNING = getCharacterTuning("draven");
const FIRE_TRAIL = DRAVEN_TUNING.effects?.fireTrail || {};

export default class DravenEffects {
  constructor(scene, sprite) {
    this.scene = scene;
    this.sprite = sprite;
    this._timer = 0;
    this._interval = FIRE_TRAIL.intervalMs ?? 45;
    this._pool = [];
    this._poolMax = FIRE_TRAIL.poolMax ?? 60;
  }

  // Internal: get a pooled graphics object
  _acquire() {
    let g = this._pool.find((o) => !o.active);
    if (!g) {
      g = this.scene.add.graphics();
      this._pool.push(g);
    }
    g.active = true;
    g.clear();
    g.setDepth(0); // behind player
    return g;
  }

  _release(g) {
    g.active = false;
    g.alpha = 1;
    g.scale = 1;
    g.clear();
    if (this._pool.length > this._poolMax) {
      const old = this._pool.find((o) => !o.active);
      if (old) {
        old.destroy();
        const idx = this._pool.indexOf(old);
        if (idx >= 0) this._pool.splice(idx, 1);
      }
    }
  }

  _spawnFlame(x, y) {
    const g = this._acquire();
    const baseSize = Phaser.Math.Between(
      FIRE_TRAIL.baseSizeMin ?? 5,
      FIRE_TRAIL.baseSizeMax ?? 9,
    );
    // Glow layers
    g.fillStyle(
      FIRE_TRAIL.outerColor ?? 0x312841,
      FIRE_TRAIL.outerAlpha ?? 0.35,
    );
    g.fillCircle(0, 0, baseSize);
    g.fillStyle(FIRE_TRAIL.midColor ?? 0xba5d22, FIRE_TRAIL.midAlpha ?? 0.55);
    g.fillCircle(0, 0, baseSize * 0.65);
    g.fillStyle(
      Phaser.Display.Color.GetColor(
        49,
        Phaser.Math.Between(
          FIRE_TRAIL.innerColorMin ?? 30,
          FIRE_TRAIL.innerColorMax ?? 60,
        ),
        60,
      ),
      FIRE_TRAIL.innerAlpha ?? 0.9,
    );
    g.fillCircle(0, 0, baseSize * 0.35);
    g.x =
      x +
      Phaser.Math.Between(
        FIRE_TRAIL.jitterMin ?? -3,
        FIRE_TRAIL.jitterMax ?? 3,
      );
    g.y =
      y +
      Phaser.Math.Between(
        FIRE_TRAIL.jitterMin ?? -3,
        FIRE_TRAIL.jitterMax ?? 3,
      );
    const driftX = Phaser.Math.Between(
      FIRE_TRAIL.driftXMin ?? -12,
      FIRE_TRAIL.driftXMax ?? 12,
    );
    const driftY = Phaser.Math.Between(
      FIRE_TRAIL.driftYMin ?? -18,
      FIRE_TRAIL.driftYMax ?? -4,
    );
    const scaleTarget = Phaser.Math.FloatBetween(
      FIRE_TRAIL.scaleTargetMin ?? 0.15,
      FIRE_TRAIL.scaleTargetMax ?? 0.35,
    );
    const duration = Phaser.Math.Between(
      FIRE_TRAIL.durationMinMs ?? 260,
      FIRE_TRAIL.durationMaxMs ?? 420,
    );
    g.scale = 1;
    this.scene.tweens.add({
      targets: g,
      x: g.x + driftX,
      y: g.y + driftY,
      scale: scaleTarget,
      alpha: 0,
      duration,
      ease: "Cubic.easeOut",
      onComplete: () => this._release(g),
    });
  }

  // Update per-frame. isMoving: boolean, dead: boolean
  update(deltaMs, isMoving, dead) {
    if (!this.sprite || dead) return;
    if (!isMoving) return;
    this._timer += deltaMs;
    if (this._timer >= this._interval) {
      this._timer = 0;
      const offsetX = FIRE_TRAIL.spawnOffsetX ?? 14;
      const baseX = this.sprite.x - (this.sprite.flipX ? -offsetX : offsetX);
      const baseY = this.sprite.y + (FIRE_TRAIL.spawnOffsetY ?? 8);
      const count = Phaser.Math.Between(
        FIRE_TRAIL.spawnCountMin ?? 1,
        FIRE_TRAIL.spawnCountMax ?? 2,
      );
      for (let i = 0; i < count; i++) this._spawnFlame(baseX, baseY);
    }
  }
}
