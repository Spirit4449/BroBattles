import { RENDER_LAYERS } from '../../gameScene/renderLayers';

// The supplied 320 × 576 sheet has five 64px frames per color; row 5 is white.
export function createShurikenEffects(scene, sprite, { x, y, angle = 0, special = false, launch = true } = {}) {
  const particles = new Set();
  const color = special ? 0xc7efff : 0xeaf6ff;
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
  const aura = graphics();
  aura.fillStyle(color, 0.08).fillCircle(0, 0, 22);
  aura.fillStyle(color, 0.16).fillCircle(0, 0, 13);
  aura.lineStyle(1.5, color, 0.65);
  aura.beginPath(); aura.arc(0, 0, 16, 0.2, 2.2); aura.strokePath();
  aura.beginPath(); aura.arc(0, 0, 16, Math.PI + 0.2, Math.PI + 2.2); aura.strokePath();
  aura.lineStyle(1.5, 0xffffff, 0.9);
  aura.lineBetween(12, -4, 12, 4); aura.lineBetween(8, 0, 16, 0);
  let lastX = sprite.x, lastY = sprite.y, lastTrail = -Infinity;
  return {
    update(now, visible = true) {
      aura.setVisible(visible).setPosition(sprite.x, sprite.y).setRotation(now * 0.012);
      aura.setScale((special ? 1.15 : 1) * (1 + Math.sin(now * 0.016) * 0.1));
      if (!visible || now - lastTrail < 30) return;
      lastTrail = now;
      const dx = sprite.x - lastX, dy = sprite.y - lastY;
      if (particles.size < 36 && Math.hypot(dx, dy) > 1) {
        const length = Math.min(44, Math.hypot(dx, dy));
        const trail = graphics().setPosition(sprite.x, sprite.y).setRotation(Math.atan2(dy, dx));
        trail.lineStyle(5, color, 0.16).lineBetween(-length, 0, 0, 0);
        trail.lineStyle(1.5, 0xffffff, 0.75).lineBetween(-length, 0, 0, 0);
        trail.fillStyle(color, 0.9).fillCircle(-length * 0.5, Math.sin(now * 0.07) * 8, 1.6);
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
