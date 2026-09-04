import { RENDER_LAYERS } from "../gameScene/renderLayers";

const GLOW_TEXTURE = "death-loot-soft-glow";

// Arcade has already applied restitution when the collision callback runs.
export function handleDeathLootContact(visual, now, onImpact) {
  const body = visual?.sprite?.body;
  if (!body || visual.settled || visual.despawning) return;
  if (!body.blocked.down && !body.touching.down) return;
  if (now - (visual.lastImpactAt ?? -Infinity) < 60) return;
  visual.lastImpactAt = now;
  visual.bounces = (visual.bounces || 0) + 1;
  onImpact?.(visual);
  if (Math.abs(body.velocity.y) > 45 && visual.bounces < 3) {
    body.velocity.x *= 0.62;
    return;
  }
  visual.settled = true;
  visual.settledAt = now;
  visual.settledX = visual.sprite.x;
  visual.settledY = visual.sprite.y;
  visual.sprite.setVelocity(0, 0);
  body.setAllowGravity(false);
  body.moves = false;
  body.immovable = true;
}

export function createDeathLootEffects(scene, Phaser) {
  function glow(x, y, size, tint, alpha, depth = RENDER_LAYERS.POWERUPS) {
    if (!scene.textures.exists(GLOW_TEXTURE)) {
      const texture = scene.textures.createCanvas(GLOW_TEXTURE, 64, 64);
      const context = texture.context;
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.2, "rgba(255,255,255,0.65)");
      gradient.addColorStop(0.5, "rgba(255,255,255,0.18)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
      texture.refresh();
    }
    return scene.add.image(x, y, GLOW_TEXTURE)
      .setDisplaySize(size, size).setTint(tint).setAlpha(alpha)
      .setDepth(depth).setBlendMode(Phaser.BlendModes.ADD);
  }

  function fade(object, duration, properties = {}) {
    scene.tweens.add({
      targets: object, alpha: 0, duration, ease: "Quad.easeOut",
      ...properties, onComplete: () => object.destroy(),
    });
  }

  function ring(x, y, tint, radius, duration) {
    const object = scene.add.circle(x, y, 8)
      .setStrokeStyle(2, tint, 0.8).setDepth(RENDER_LAYERS.PLAYER + 1)
      .setBlendMode(Phaser.BlendModes.ADD);
    fade(object, duration, { scaleX: radius / 8, scaleY: radius / 8 });
  }

  function burst(x, y) {
    const flash = glow(x, y, 90, 0xfff3c4, 1, RENDER_LAYERS.PLAYER + 1);
    fade(flash, 260, { displayWidth: 170, displayHeight: 170 });
    ring(x, y, 0xffe5a3, 82, 420);
    const pool = glow(x, y + 5, 130, 0xffbb44, 0.6);
    pool.setScale(pool.scaleX, pool.scaleY * 0.35);
    fade(pool, 650);
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.1, 0.1);
      const distance = Phaser.Math.Between(35, 100);
      const spark = glow(x, y, Phaser.Math.Between(7, 13),
        i % 4 === 0 ? 0x67e8f9 : 0xffd76a, 0.95, RENDER_LAYERS.PLAYER + 1);
      fade(spark, Phaser.Math.Between(280, 520), {
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance - 18,
        scaleX: 0.02, scaleY: 0.02,
      });
    }
  }

  function trail(visual, tint) {
    const sprite = visual.sprite;
    const speed = Math.hypot(sprite.body.velocity.x, sprite.body.velocity.y);
    if (speed < 65) return;
    const spark = glow(sprite.x, sprite.y, 13, tint, 0.65);
    fade(spark, 220, { displayWidth: 3, displayHeight: 3, y: sprite.y - 5 });
  }

  function impact(visual, tint) {
    if (visual.bounces > 2) return;
    const sprite = visual.sprite;
    const puff = glow(sprite.x, sprite.y + sprite.displayHeight / 2, 32, tint, 0.65);
    fade(puff, 180, { displayWidth: 48, displayHeight: 10 });
  }

  return { glow, burst, trail, impact };
}
