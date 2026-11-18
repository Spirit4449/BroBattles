import { BANK_BUST_GOLD_ARRIVAL_MS } from "../../../../shared/bankBustSettings.js";
import { RENDER_LAYERS } from "../../scene/renderLayers";
import { COIN_FRAME_SCALE, coinSpinFrame } from "./coinMotion.mjs";

export function createGoldPickups({ lootFx, scene, Phaser, reducedMotion, pickupSprites, coinFx }) {
  // A pickup's point sits this far above the surface under it, up where a
  // fighter's body reaches it. The coin is drawn lower, hovering just off the
  // floor, with its shadow on the floor itself.
  const PICKUP_FLOOR_DROP = 40;

  const PICKUP_HOVER_DROP = 14;

  const HALO_TEXTURE = "bb-coin-spawn-halo";

  function createPickupVisual(pickup) {
    const x = Number(pickup.x) || 0;
    const y = Number(pickup.y) || 0;
    const spilled = pickup.reason === "centerGold";
    const glow = lootFx.glow(x, y, spilled ? 78 : 54, 0xffc34a, 0.3);
    const sprite = scene.add.image(x, y, "coin-spin", 0);
    sprite.setDepth(RENDER_LAYERS.POWERUPS);
    sprite.setScale((spilled ? 1.4 : 1) * COIN_FRAME_SCALE);
    const shadow = scene.add.ellipse(x, y + PICKUP_FLOOR_DROP, 22, 6, 0x000000, 0.3);
    shadow.setDepth(RENDER_LAYERS.POWERUPS - 1);
    // Thrown out of the crate, or dropping in from above.
    const fromX = Number.isFinite(pickup.fromX) ? pickup.fromX : x;
    const fromY = Number.isFinite(pickup.fromY) ? pickup.fromY : y - 90;
    // Older snapshots may omit the server-provided arrival time.
    const arrivalMs = Number(pickup.arrivalMs) || BANK_BUST_GOLD_ARRIVAL_MS;
    // Fraction of the arrival at which the coin first touches the floor.
    const touch = Phaser.Math.Clamp(
      (Number(pickup.claimableMs) || arrivalMs * BOUNCE_FIRST_TOUCH) / arrivalMs,
      0.05,
      1,
    );
    const halo = reducedMotion ? null : lootFx.glowImage(HALO_TEXTURE, x, y, 0xffd264);
    halo?.setDisplaySize(spilled ? 56 : 44, spilled ? 120 : 96);
    return {
      sprite,
      glow,
      shadow,
      halo,
      arrivalMs,
      touch,
      fromX,
      fromY,
      arc: Number.isFinite(pickup.fromX) ? 90 : 0,
      bornAt: scene.time.now,
      landed: reducedMotion,
      phase: Math.random() * Math.PI * 2,
      nextGlintAt: scene.time.now + 500 + Math.random() * 1400,
    };
  }

  const BOUNCE_FIRST_TOUCH = 1 / 2.75;

  const HALO_PEAK_ALPHA = 0.6;

  const HALO_RISE = 0.2;

  const HALO_LINGER = 0.3;

  function renderPickups(modeState) {
    const used = new Set();
    const nowSec = scene.time.now / 1000;
    for (const pickup of Array.isArray(modeState?.randomGoldPickups)
      ? modeState.randomGoldPickups
      : []) {
      used.add(pickup.id);
      let visual = pickupSprites.get(pickup.id) || null;
      if (!visual?.sprite?.scene) {
        visual = createPickupVisual(pickup);
        pickupSprites.set(pickup.id, visual);
      }
      const x = Number(pickup.x) || 0;
      const y = Number(pickup.y) || 0;
      const bob = reducedMotion ? 0 : Math.sin(nowSec * 2.8 + visual.phase) * 4;
      let drawX = x;
      const restY = y + PICKUP_HOVER_DROP;
      let drawY = restY + bob;
      let spinRate = 6;
      const age = scene.time.now - visual.bornAt;
      if (!visual.landed) {
        const t = Phaser.Math.Clamp(age / visual.arrivalMs, 0, 1);
        // The throw and the first drop end together at the first floor touch,
        // when the server lets the coin be collected; the bounces follow.
        const thrown = Math.min(1, t / visual.touch);
        const eased =
          t < visual.touch
            ? thrown * BOUNCE_FIRST_TOUCH
            : BOUNCE_FIRST_TOUCH +
              ((t - visual.touch) / (1 - visual.touch || 1)) * (1 - BOUNCE_FIRST_TOUCH);
        const fall = Phaser.Math.Easing.Bounce.Out(eased);
        drawX = Phaser.Math.Linear(visual.fromX, x, thrown);
        drawY =
          Phaser.Math.Linear(visual.fromY, restY, fall) - Math.sin(thrown * Math.PI) * visual.arc;
        spinRate = 10;
        visual.sprite.setAlpha(Math.min(1, t / 0.15));
        if (t >= 1) {
          visual.landed = true;
          visual.landedAt = scene.time.now;
          coinFx.sparkle(x, y + PICKUP_FLOOR_DROP - 6, { count: 3, radius: 18, scale: 0.8 });
        }
      } else if (visual.landedAt) {
        // The bob eases in from a standstill rather than snapping in.
        drawY = restY + bob * Math.min(1, (scene.time.now - visual.landedAt) / 480);
      }
      visual.sprite.setPosition(drawX, drawY);
      if (!reducedMotion) {
        visual.sprite.setFrame(coinSpinFrame(nowSec * spinRate + visual.phase));
      }
      const pulse = 0.5 + 0.5 * Math.sin(nowSec * 3.5 + visual.phase);
      visual.glow.setPosition(drawX, drawY);
      if (visual.halo) {
        const progress = age / visual.arrivalMs;
        if (progress >= 1 + HALO_LINGER) {
          visual.halo.destroy();
          visual.halo = null;
        } else {
          const brightness =
            progress < HALO_RISE
              ? progress / HALO_RISE
              : Math.min(1, (1 + HALO_LINGER - progress) / HALO_LINGER);
          // A short column of light on the coin, not a beam from the ceiling.
          visual.halo.setPosition(drawX, drawY - 16);
          visual.halo.setAlpha(HALO_PEAK_ALPHA * brightness);
        }
      }
      visual.glow.setAlpha(0.2 + 0.18 * pulse);
      visual.shadow.setPosition(x, y + PICKUP_FLOOR_DROP);
      visual.shadow.setScale(visual.landed ? 1 - 0.14 * (bob / 4) : 0.6);
      // Now and then, a glint off the edge of the coin.
      if (!reducedMotion && visual.landed && scene.time.now >= visual.nextGlintAt) {
        visual.nextGlintAt = scene.time.now + 900 + Math.random() * 1800;
        coinFx.sparkle(drawX + Phaser.Math.Between(-9, 9), drawY + Phaser.Math.Between(-9, 9), {
          scale: 0.9,
          depth: RENDER_LAYERS.POWERUPS + 1,
        });
      }
    }
    for (const [id, visual] of pickupSprites.entries()) {
      if (used.has(id)) continue;
      destroyPickupVisual(visual);
      pickupSprites.delete(id);
    }
  }

  function destroyPickupVisual(visual) {
    try {
      visual?.sprite?.destroy?.();
      visual?.glow?.destroy?.();
      visual?.shadow?.destroy?.();
      visual?.halo?.destroy?.();
    } catch (_) {}
  }

  return { renderPickups, destroyPickupVisual };
}
