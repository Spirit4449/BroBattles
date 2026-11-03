import { teamColor, TEAM_RED } from "../../../../shared/projectilePresentation";
import { RENDER_LAYERS } from '../../scene/renderLayers';

// The supplied 320 × 576 sheet has five 64px frames per color; row 5 is white.
export function createShurikenEffects(scene, sprite, { x, y, angle = 0, special = false, launch = true } = {}) {
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
      .setOrigin(0.25, 0.5).setRotation(angle).setScale(special ? 1.5 : 1.2)
      .setDepth(RENDER_LAYERS.ATTACKS + 1).setBlendMode('ADD');
    flash.play(key);
    fade(flash, 220);
    const burst = graphics().setPosition(x, y).setRotation(angle);
    burst.lineStyle(2, 0xffffff, 0.9);
    for (let i = -2; i <= 2; i++) {
      const a = i * 0.48;
      burst.lineBetween(Math.cos(a) * 8, Math.sin(a) * 8, Math.cos(a) * 30, Math.sin(a) * 30);
    }
    fade(burst, 180, { scaleX: 1.8, scaleY: 1.8 });
  }
  // Two spinning arcs stamped on a coarse grid so they read as pixel art, not a vector halo.
  const aura = graphics();
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
    aura.clear().fillStyle(color, 0.14);
    for (const [x, y] of fillCells) aura.fillRect(x, y, pixel, pixel);
    aura.fillStyle(color, 0.9);
    for (const [x, y, a] of ringCells) {
      const t = (((a - spin) % Math.PI) + Math.PI) % Math.PI;
      if (t > 0.2 && t < 2.2) aura.fillRect(x, y, pixel, pixel);
    }
  };
  let lastX = sprite.x, lastY = sprite.y, lastTrail = -Infinity;
  return {
    update(now, visible = true) {
      aura.setVisible(visible).setPosition(Math.round(sprite.x), Math.round(sprite.y));
      if (visible) drawAura(now * 0.012);
      if (!visible || now - lastTrail < 30) return;
      lastTrail = now;
      const dx = sprite.x - lastX, dy = sprite.y - lastY;
      if (particles.size < 36 && Math.hypot(dx, dy) > 1) {
        const length = Math.min(44, Math.hypot(dx, dy));
        const trail = graphics().setPosition(sprite.x, sprite.y).setRotation(Math.atan2(dy, dx));
        trail.lineStyle(5, 0xeaf6ff, 0.16).lineBetween(-length, 0, 0, 0);
        trail.lineStyle(1.5, 0xffffff, 0.75).lineBetween(-length, 0, 0, 0);
        const starX = -length * 0.5, starY = Math.sin(now * 0.07) * 9;
        trail.lineStyle(2, color, 0.95);
        trail.lineBetween(starX - 3, starY, starX + 3, starY);
        trail.lineBetween(starX, starY - 3, starX, starY + 3);
        fade(trail, 210);
      }
      lastX = sprite.x; lastY = sprite.y;
    },
    destroy() {
      aura.destroy();
      for (const object of particles) { scene.tweens.killTweensOf(object); object.destroy(); }
      particles.clear();
    },
  };
}
