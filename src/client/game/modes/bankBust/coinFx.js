import { RENDER_LAYERS } from "../../scene/renderLayers";
import {
  COIN_FRAME_SCALE,
  COIN_SPIN_FRAMES,
  coinSpinFrame,
  homingPoint,
  settleCoinSpin,
  stepLooseCoin,
} from "./coinMotion.mjs";

const COIN_TEXTURE = "coin-spin";
const SPARKLE_TEXTURE = "coin-sparkle";
const SPARKLE_FRAMES = 4;
const DEBRIS_TEXTURE = "bank-bust-center-crate-debris";
// Coins are dropped past this rather than slowing the match down: a vault
// emptying under three attackers can ask for hundreds.
const MAX_PARTICLES = 160;
const POP_TIME = [0.16, 0.3]; // seconds a collected coin hangs before homing
const HOME_TIME = [0.42, 0.62];
const BLINK_OUT_SECONDS = 0.24;

const between = (min, max) => min + Math.random() * (max - min);

/**
 * Every loose coin in the mode, simulated together each frame.
 *
 * Coins are real objects here rather than a tween to somewhere: they have
 * gravity, bounce off the surface they land on and spin through a turn of their
 * own artwork, which is most of the difference between gold and a confetti of
 * yellow circles. Sprites are pooled, because a big payout is exactly when a
 * burst of allocations would show.
 */
export function createCoinFx({ scene, Phaser, reducedMotion = false }) {
  const live = [];
  const pool = [];
  const texts = [];

  function acquire(texture, frame) {
    if (live.length >= MAX_PARTICLES) return null;
    const sprite = pool.pop() || scene.add.image(0, 0, texture, frame);
    sprite.setTexture(texture, frame);
    sprite.setActive(true).setVisible(true).setAlpha(1).setAngle(0).setScale(1).clearTint();
    sprite.setBlendMode(Phaser.BlendModes.NORMAL);
    return sprite;
  }

  function release(index) {
    const { sprite } = live[index];
    sprite.setActive(false).setVisible(false);
    pool.push(sprite);
    live[index] = live[live.length - 1];
    live.pop();
  }

  /** Coins thrown out of a point, landing on `floorY` if they are given one. */
  function burst(x, y, {
    count = 10,
    speed = [160, 360],
    spread = Math.PI * 1.2,
    direction = -Math.PI / 2,
    scale = 1,
    life = [0.9, 1.4],
    floorY,
    floorLeft,
    floorRight,
    jitter = 6,
    depth = RENDER_LAYERS.POWERUPS + 1,
  } = {}) {
    if (reducedMotion) return;
    for (let i = 0; i < count; i++) {
      const sprite = acquire(COIN_TEXTURE, 0);
      if (!sprite) return;
      const angle = direction + (Math.random() - 0.5) * spread;
      const v = between(speed[0], speed[1]);
      sprite.setDepth(depth);
      sprite.setScale(COIN_FRAME_SCALE * scale * between(0.72, 1));
      live.push({
        kind: "coin",
        sprite,
        x: x + between(-jitter, jitter),
        y: y + between(-jitter, jitter),
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        floorY,
        floorLeft,
        floorRight,
        age: 0,
        life: between(life[0], life[1]),
        spin: Math.random() * COIN_SPIN_FRAMES,
        spinRate: between(8, 13) * (Math.random() < 0.5 ? -1 : 1),
      });
    }
  }

  /**
   * Coins that pop out of a point, hang for a moment and then stream to a
   * target. `getTarget` is asked every frame, because the camera moves while
   * they travel and a coin bound for the HUD has to arrive at the HUD.
   */
  function flyTo(x, y, getTarget, {
    count = 6,
    scale = 1,
    popSpeed = [150, 300],
    stagger = 0.035,
    depth = RENDER_LAYERS.PLAYER_HUD,
    onArrive = null,
  } = {}) {
    if (reducedMotion) {
      onArrive?.(0);
      return;
    }
    for (let i = 0; i < count; i++) {
      const sprite = acquire(COIN_TEXTURE, 0);
      if (!sprite) return;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const v = between(popSpeed[0], popSpeed[1]);
      sprite.setDepth(depth);
      sprite.setScale(COIN_FRAME_SCALE * scale * between(0.85, 1.05));
      sprite.setVisible(false);
      live.push({
        kind: "homing",
        sprite,
        x: x + between(-8, 8),
        y: y + between(-6, 6),
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        age: -i * stagger,
        popFor: between(POP_TIME[0], POP_TIME[1]),
        homeFor: between(HOME_TIME[0], HOME_TIME[1]),
        spin: Math.random() * COIN_SPIN_FRAMES,
        spinRate: between(10, 15),
        getTarget,
        from: null,
        bow: null,
        lastTrailAt: 0,
        index: i,
        onArrive,
      });
    }
  }

  /** The little four-point glints gold throws off. */
  function sparkle(x, y, { count = 1, radius = 0, depth = RENDER_LAYERS.ATTACKS, scale = 1 } = {}) {
    if (reducedMotion) return;
    for (let i = 0; i < count; i++) {
      const sprite = acquire(SPARKLE_TEXTURE, 0);
      if (!sprite) return;
      sprite.setDepth(depth);
      sprite.setScale(scale * between(0.9, 1.5));
      const angle = Math.random() * Math.PI * 2;
      const reach = Math.random() * radius;
      live.push({
        kind: "sparkle",
        sprite,
        x: x + Math.cos(angle) * reach,
        y: y + Math.sin(angle) * reach,
        vx: Math.cos(angle) * radius * 0.5,
        vy: Math.sin(angle) * radius * 0.5 - 12,
        age: -i * 0.02,
        life: between(0.22, 0.38),
      });
    }
  }

  /** Bits of something thrown clear: a crate frame, or a tinted chip if none. */
  function debris(x, y, {
    frame = null,
    tint = 0x7a4a26,
    width = 6,
    height = 3,
    speed = [160, 360],
    spread = Math.PI * 1.3,
    direction = -Math.PI / 2,
    count = 1,
    life = [0.6, 1],
    floorY,
    floorLeft,
    floorRight,
    depth = RENDER_LAYERS.ATTACKS,
  } = {}) {
    if (reducedMotion) return;
    for (let i = 0; i < count; i++) {
      const hasFrame = frame !== null && scene.textures?.exists?.(DEBRIS_TEXTURE);
      const sprite = acquire(hasFrame ? DEBRIS_TEXTURE : "__WHITE", hasFrame ? frame : undefined);
      if (!sprite) return;
      if (!hasFrame) {
        sprite.setTint(tint);
        sprite.setDisplaySize(width, height);
      }
      sprite.setDepth(depth);
      const angle = direction + (Math.random() - 0.5) * spread;
      const v = between(speed[0], speed[1]);
      live.push({
        kind: "debris",
        sprite,
        x, y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        floorY,
        floorLeft,
        floorRight,
        age: 0,
        life: between(life[0], life[1]),
        tumble: between(5, 12) * (Math.random() < 0.5 ? -1 : 1),
      });
    }
  }

  /** A number that lifts off the coins it describes, in the level's own font. */
  function floatText(x, y, message, { color = "#ffe27a", size = 14 } = {}) {
    const text = scene.add.text(x, y, message, {
      fontFamily: "'Press Start 2P', monospace",
      fontSize: `${size}px`,
      color,
      stroke: "#1a1006",
      strokeThickness: 5,
    });
    text.setOrigin(0.5).setDepth(RENDER_LAYERS.PLAYER_HUD + 1).setScale(0.4);
    texts.push(text);
    scene.tweens.add({
      targets: text, scale: 1, duration: 170, ease: "Back.easeOut",
    });
    scene.tweens.add({
      targets: text,
      y: y - (reducedMotion ? 0 : 54),
      alpha: 0,
      duration: 620,
      delay: 340,
      ease: "Quad.easeIn",
      onComplete: () => {
        const index = texts.indexOf(text);
        if (index >= 0) texts.splice(index, 1);
        text.destroy();
      },
    });
  }

  function updateCoin(entry, dt) {
    entry.age += dt;
    const struck = stepLooseCoin(entry, dt);
    if (struck) {
      // Each bounce takes speed out of the spin as well as the fall.
      entry.spinRate *= 0.7;
      if (!entry.resting && Math.abs(entry.vy) > 120) sparkle(entry.x, entry.y + 8, { scale: 0.7 });
    }
    entry.spin = entry.resting ? settleCoinSpin(entry.spin, dt) : entry.spin + entry.spinRate * dt;
    entry.sprite.setFrame(coinSpinFrame(entry.spin));
    entry.sprite.setPosition(entry.x, entry.y);
    // Gone by flickering, the way everything else in this game disappears, and
    // not by slowly turning translucent in mid-air.
    const left = entry.life - entry.age;
    if (left < BLINK_OUT_SECONDS) entry.sprite.setVisible(Math.floor(left * 30) % 2 === 0);
    return left <= 0;
  }

  function updateHoming(entry, dt) {
    entry.age += dt;
    if (entry.age < 0) return false;
    entry.sprite.setVisible(true);
    entry.spin += entry.spinRate * dt;
    entry.sprite.setFrame(coinSpinFrame(entry.spin));
    if (entry.age < entry.popFor) {
      stepLooseCoin(entry, dt);
      entry.sprite.setPosition(entry.x, entry.y);
      return false;
    }
    const target = entry.getTarget?.() || entry.lastTarget;
    if (!target) return true;
    entry.lastTarget = target;
    if (!entry.from) {
      entry.from = { x: entry.x, y: entry.y };
      // Alternating sides, so a payout fans out and closes back in.
      const side = entry.index % 2 === 0 ? 1 : -1;
      entry.bow = { x: side * between(40, 120), y: between(-90, -20) };
    }
    const progress = (entry.age - entry.popFor) / entry.homeFor;
    const point = homingPoint(entry.from, entry.bow, target, progress);
    entry.x = point.x;
    entry.y = point.y;
    entry.sprite.setPosition(point.x, point.y);
    if (entry.age - entry.lastTrailAt > 0.07 && progress > 0.2) {
      entry.lastTrailAt = entry.age;
      sparkle(point.x, point.y, { scale: 0.75, depth: entry.sprite.depth });
    }
    if (progress < 1) return false;
    sparkle(target.x, target.y, { count: 2, radius: 14, depth: entry.sprite.depth });
    entry.onArrive?.(entry.index);
    return true;
  }

  function updateSparkle(entry, dt) {
    entry.age += dt;
    if (entry.age < 0) {
      entry.sprite.setVisible(false);
      return false;
    }
    entry.sprite.setVisible(true);
    entry.x += entry.vx * dt;
    entry.y += entry.vy * dt;
    entry.sprite.setPosition(entry.x, entry.y);
    const progress = entry.age / entry.life;
    entry.sprite.setFrame(Math.min(SPARKLE_FRAMES - 1, Math.floor(progress * SPARKLE_FRAMES)));
    return progress >= 1;
  }

  function updateDebris(entry, dt) {
    entry.age += dt;
    const wasResting = entry.resting;
    stepLooseCoin(entry, dt);
    if (!entry.resting) entry.sprite.rotation += entry.tumble * dt;
    else if (!wasResting) entry.sprite.rotation = Math.round(entry.sprite.rotation / Math.PI) * Math.PI;
    entry.sprite.setPosition(entry.x, entry.y);
    const left = entry.life - entry.age;
    if (left < BLINK_OUT_SECONDS) entry.sprite.setVisible(Math.floor(left * 30) % 2 === 0);
    return left <= 0;
  }

  const UPDATERS = {
    coin: updateCoin,
    homing: updateHoming,
    sparkle: updateSparkle,
    debris: updateDebris,
  };

  function update(deltaMs) {
    // Capped, so a backgrounded tab does not resume with every coin teleported.
    const dt = Math.min(0.05, Math.max(0, Number(deltaMs) || 0) / 1000);
    // Backwards, because finishing swaps the last entry into this slot. Entries
    // added during the pass are picked up on the next frame.
    for (let i = live.length - 1; i >= 0; i--) {
      const entry = live[i];
      if (UPDATERS[entry.kind](entry, dt)) release(live.indexOf(entry));
    }
  }

  function destroy() {
    for (const { sprite } of live) sprite.destroy();
    for (const sprite of pool) sprite.destroy();
    for (const text of texts) text.destroy();
    live.length = 0;
    pool.length = 0;
    texts.length = 0;
  }

  return { burst, flyTo, sparkle, debris, floatText, update, destroy };
}
