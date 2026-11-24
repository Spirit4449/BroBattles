import { characterDefinitions } from "../../../../shared/characters/index.js";
import { getResolvedCharacterEffectConfig } from "../../../../shared/characters/characterTuning.js";
import { RENDER_LAYERS } from "../../scene/renderLayers";
import { paintStaffSmoke, snapSmoke, staffSmokePalette, staffTip } from "./staffSmoke";

const { key: NAME } = characterDefinitions.draven;

// Tuning lives in draven.json `presentation.effects.staffSmoke`.
const SMOKE = getResolvedCharacterEffectConfig(NAME, "staffSmoke");

const between = (min, max) => min + Math.random() * (max - min);

// Draven's per-player effect: while he moves (runs, jumps, falls, dashes), his staff head leaves a trail of
// pixel smoke. Puffs stay where they were let go (in world space), so the
// trail hangs behind him, rises, swells and thins out. The player classes call
// update() each frame they are visible; the smoke keeps fading on its own when
// they stop calling it.
export default class DravenEffects {
  constructor(scene, sprite) {
    this.scene = scene;
    this.sprite = sprite;
    this.puffs = [];
    this._sinceEmit = 0;
    this._lastTip = null;
    this._wantsAt = -Infinity;
    this._lastAt = scene?.time?.now ?? 0;
    this.layer = scene?.add?.graphics?.() || null;
    // Behind him, like the flame on the staff in his own art.
    this.layer?.setDepth?.(RENDER_LAYERS.PLAYER - 1);
    // A small detail: see-through so it never competes with the fight.
    this.layer?.setAlpha?.(SMOKE.alpha);
    this._onUpdate = (time) => this._step(time);
    this._onShutdown = () => this.destroy();
    scene?.events?.on?.("update", this._onUpdate);
    scene?.events?.once?.("shutdown", this._onShutdown);
  }

  // Per frame from the player classes (deltaMs, isMoving, dead). Movement is
  // measured from the sprite itself: remote sprites are interpolated, so their
  // body velocity (what isMoving reads) stays near zero.
  update(deltaMs, _isMoving, dead) {
    const sprite = this.sprite;
    const last = this._lastPos;
    this._lastPos = sprite ? { x: sprite.x, y: sprite.y } : null;
    const seconds = Math.max(1, deltaMs || 0) / 1000;
    const speed = last && sprite ? Math.hypot(sprite.x - last.x, sprite.y - last.y) / seconds : 0;
    if (!sprite || dead || !sprite.visible || sprite._dravenInfernoToken || speed < SMOKE.minSpeedPx) {
      this._lastTip = null;
      return;
    }
    this._wantsAt = this.scene?.time?.now ?? 0;
    const tip = staffTip(sprite);
    const from = this._lastTip || tip;
    this._sinceEmit += Math.max(0, deltaMs || 0);
    // Fill in between frames so a fast staff leaves an unbroken trail.
    const steps = Math.floor(this._sinceEmit / SMOKE.intervalMs);
    if (steps > 0) {
      this._sinceEmit -= steps * SMOKE.intervalMs;
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        const jitter = SMOKE.radiusMinPx * 0.6;
        this._emit({ x: from.x + (tip.x - from.x) * k + between(-jitter, jitter),
          y: from.y + (tip.y - from.y) * k + between(-jitter, jitter) });
      }
    }
    this._lastTip = tip;
  }

  _emit(at) {
    if (this.puffs.length >= SMOKE.maxPuffs) this.puffs.shift();
    this.puffs.push({
      x: at.x, y: at.y, age: 0, life: between(SMOKE.lifeMinMs, SMOKE.lifeMaxMs),
      vx: between(-SMOKE.spreadPx, SMOKE.spreadPx), vy: -between(SMOKE.riseMinPx, SMOKE.riseMaxPx),
      r0: between(SMOKE.radiusMinPx, SMOKE.radiusMaxPx), r: 0, h: 1, warm: SMOKE.warmth,
      wobble: between(0, Math.PI * 2),
    });
  }

  _step(now) {
    const layer = this.layer;
    if (!layer?.active || !this.sprite) return;
    const dt = Math.min(50, Math.max(0, now - this._lastAt)) / 1000;
    this._lastAt = now;
    // The player stopped calling update() (hidden or invisible): stop emitting.
    if (now - this._wantsAt > 100) this._lastTip = null;
    const puffs = this.puffs;
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.age += dt * 1000;
      const life = p.age / p.life;
      if (life >= 1) { puffs.splice(i, 1); continue; }
      const drag = Math.exp(-dt * 3);
      // Curls side to side as it rises.
      p.vx = p.vx * drag + Math.sin(p.wobble + p.age / 90) * SMOKE.spreadPx * 4 * dt;
      p.vy = p.vy * drag - 20 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Swells out of the staff, then thins away.
      p.r = p.r0 * (0.6 + life * 1.2);
      p.h = 1 - life ** 1.5;
      p.warm = Math.max(0, p.warm - dt * 3);
    }
    // An invisible Draven (powerup) shows no trail.
    layer.setVisible(!!this.sprite.visible);
    if (!puffs.length && !this._painted) return;
    // Snap centres to the smoke grid so puffs step instead of sliding.
    paintStaffSmoke(layer, puffs.map((p) => ({ ...p, x: snapSmoke(p.x), y: snapSmoke(p.y) })),
      staffSmokePalette(this.sprite));
    this._painted = puffs.length > 0;
  }

  destroy() {
    this.scene?.events?.off?.("update", this._onUpdate);
    this.scene?.events?.off?.("shutdown", this._onShutdown);
    this.layer?.destroy?.();
    this.layer = null;
    this.puffs.length = 0;
    this.sprite = null;
  }
}
