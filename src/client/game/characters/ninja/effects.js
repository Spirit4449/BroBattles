import { teamColor, TEAM_RED } from "../../../../shared/projectilePresentation";
import { RENDER_LAYERS } from '../../scene/renderLayers';
import { createSwarmAura } from './swarmFx';
import { combatSoundVolume, playerSoundVolume } from '../../audio/playerAudio';

export const FLIGHT_SOUND = 'ninja-shuriken-flight';
// Any shuriken hit, on a wall or a player (the character's `hit` sound too).
export const HIT_SOUND = 'ninja-shuriken-hit';
// The whoop-whoop of a shuriken spinning through the air (scripts/art/
// ninja-pixel/swarm-sfx.cjs), looped while it flies and following it: it fades
// with distance from the listener like any player sound.
function createFlightSound(scene, sprite) {
  const base = combatSoundVolume(FLIGHT_SOUND);
  let sound;
  let failed = false;
  const stop = () => {
    if (sound?.manager) sound.destroy();
    sound = null;
  };
  return {
    update(visible) {
      if (!visible) return stop();
      const manager = scene.sound;
      if (failed || !manager || manager.locked) return;
      const volume = playerSoundVolume(scene, sprite, base);
      if (sound?.manager) {
        sound.volume = volume;
        return;
      }
      // The match can already be running while Phaser downloads and decodes audio.
      if (!scene.cache.audio.exists(FLIGHT_SOUND)) return;
      try {
        sound = manager.add(FLIGHT_SOUND, { loop: true });
        if (sound.play({ volume, rate: 0.94 + Math.random() * 0.12 })) return;
      } catch (_) {}
      failed = true;
      stop();
    },
    stop,
  };
}

// The supplied 320 × 576 sheet has five 64px frames per color; row 5 is white.
export function createShurikenEffects(scene, sprite, { x, y, angle = 0, special = false, launch = true, flightSound = true } = {}) {
  const particles = new Set();
  const color = teamColor(sprite) === TEAM_RED ? 0xff625b : 0x60eaa0;
  const fade = (object, duration, values = {}) => {
    particles.add(object);
    scene.tweens.add({ targets: object, alpha: 0, duration, ...values,
      onComplete: () => { particles.delete(object); object.destroy(); } });
    return object;
  };
  const graphics = () => scene.add.graphics().setDepth(RENDER_LAYERS.ATTACKS - 1).setBlendMode('ADD');
  if (launch && scene.textures.exists('ninja-throw-effects')) {
    const key = 'ninja-white-release';
    if (!scene.anims.exists(key)) scene.anims.create({ key,
      frames: scene.anims.generateFrameNumbers('ninja-throw-effects', { start: 25, end: 29 }),
      frameRate: 24, repeat: 0 });
    const flash = scene.add.sprite(x, y, 'ninja-throw-effects', 25)
      .setOrigin(0.25, 0.5).setRotation(angle).setScale(special ? 1.15 : 0.9)
      .setDepth(RENDER_LAYERS.ATTACKS + 1).setBlendMode('ADD');
    flash.setAlpha(0.55).play(key);
    fade(flash, 160);
    const burst = graphics().setPosition(x, y).setRotation(angle);
    burst.lineStyle(1.5, 0xffffff, 0.45);
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.48;
      burst.lineBetween(Math.cos(a) * 8, Math.sin(a) * 8, Math.cos(a) * 20, Math.sin(a) * 20);
    }
    fade(burst, 180, { scaleX: 1.4, scaleY: 1.4 });
  }
  // Swarm shuriken spin in the super's spirit ring (swarmFx.js) when its art is loaded.
  const spirit = special ? createSwarmAura(scene, sprite) : null;
  const flight = flightSound ? createFlightSound(scene, sprite) : null;
  // Two spinning arcs stamped on a coarse grid so they read as pixel art, not a vector halo.
  const aura = graphics().setVisible(!spirit);
  const pixel = 2, radius = special ? 19 : 16, cells = Math.ceil((radius + pixel) / pixel);
  const ringCells = [], fillCells = [];
  for (let gx = -cells; gx < cells; gx++) {
    for (let gy = -cells; gy < cells; gy++) {
      const cx = (gx + 0.5) * pixel, cy = (gy + 0.5) * pixel, d = Math.hypot(cx, cy);
      if (Math.abs(d - radius) < pixel * 0.5) ringCells.push([gx * pixel, gy * pixel, Math.atan2(cy, cx)]);
      else if (d < radius - pixel) fillCells.push([gx * pixel, gy * pixel]);
    }
  }
  const drawAura = (spin) => {
    aura.clear().fillStyle(color, 0.06);
    for (const [x, y] of fillCells) aura.fillRect(x, y, pixel, pixel);
    aura.fillStyle(color, 0.5);
    for (const [x, y, a] of ringCells) {
      const t = (((a - spin) % Math.PI) + Math.PI) % Math.PI;
      if (t > 0.2 && t < 2.2) aura.fillRect(x, y, pixel, pixel);
    }
  };
  let lastX = sprite.x, lastY = sprite.y, lastTrail = -Infinity;
  return {
    update(now, visible = true) {
      flight?.update(visible);
      if (spirit) spirit.update(visible);
      else {
        aura.setVisible(visible).setPosition(Math.round(sprite.x), Math.round(sprite.y));
        if (visible) drawAura(now * 0.012);
      }
      if (!visible || now - lastTrail < 50) return;
      lastTrail = now;
      const dx = sprite.x - lastX, dy = sprite.y - lastY;
      if (particles.size < 20 && Math.hypot(dx, dy) > 1) {
        const length = Math.min(28, Math.hypot(dx, dy));
        const trail = graphics().setPosition(sprite.x, sprite.y).setRotation(Math.atan2(dy, dx));
        trail.lineStyle(4, 0xeaf6ff, 0.08).lineBetween(-length, 0, 0, 0);
        trail.lineStyle(1, 0xffffff, 0.4).lineBetween(-length, 0, 0, 0);
        const starX = -length * 0.5, starY = Math.sin(now * 0.07) * 5;
        trail.lineStyle(1.5, color, 0.5);
        trail.lineBetween(starX - 3, starY, starX + 3, starY);
        trail.lineBetween(starX, starY - 3, starX, starY + 3);
        fade(trail, 150);
      }
      lastX = sprite.x; lastY = sprite.y;
    },
    destroy() {
      aura.destroy();
      spirit?.destroy();
      flight?.stop();
      for (const object of particles) { scene.tweens.killTweensOf(object); object.destroy(); }
      particles.clear();
    },
  };
}
