import { RENDER_LAYERS } from "../scene/renderLayers";

const GLOW_TEXTURE = "death-loot-soft-glow";

export function handleDeathLootContact(visual, now, onImpact) {
  const body = visual?.sprite?.body;
  if (!body || visual.settled || visual.despawning) return;
  if (!body.blocked.down && !body.touching.down) return;
  onImpact?.(visual);
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
  function pixel(x, y, size, tint, alpha = 1) {
    return scene.add.rectangle(Math.round(x), Math.round(y), size, size, tint, alpha)
      .setDepth(RENDER_LAYERS.PLAYER + 1);
  }

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

  // A tall oval of soft light, for a coin appearing: bright down its middle and
  // gone by every edge, so it reads as a glow with no visible box around it.
  function glowImage(textureKey, x, y, tint) {
    if (!scene.textures.exists(textureKey)) {
      const width = 32;
      const height = 96;
      const texture = scene.textures.createCanvas(textureKey, width, height);
      const pixels = texture.context.createImageData(width, height);
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          const across = 1 - Math.abs((px + 0.5) / width - 0.5) * 2;
          const along = 1 - Math.abs((py + 0.5) / height - 0.5) * 2;
          const i = (py * width + px) * 4;
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
          pixels.data[i + 3] = Math.round(255 * across ** 2 * along ** 1.5);
        }
      }
      texture.context.putImageData(pixels, 0, 0);
      texture.refresh();
    }
    return scene.add.image(x, y, textureKey)
      .setTint(tint).setAlpha(0).setDepth(RENDER_LAYERS.POWERUPS - 1)
      .setBlendMode(Phaser.BlendModes.ADD);
  }

  function fade(object, duration, properties = {}) {
    scene.tweens.add({
      targets: object, alpha: 0, duration, ease: "Quad.easeOut",
      ...properties, onComplete: () => object.destroy(),
    });
  }

  function burst(x, y) {
    // Small square glints follow the same fan as the launched loot.
    for (let i = 0; i < 12; i++) {
      const angle = Math.PI + (i / 11) * Math.PI;
      const distance = Phaser.Math.Between(22, 58);
      const spark = pixel(x, y, i % 3 === 0 ? 6 : 4,
        i % 4 === 0 ? 0x67e8f9 : 0xffd76a);
      fade(spark, Phaser.Math.Between(240, 390), {
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
      });
    }
  }

  function trail(visual, tint) {
    const sprite = visual.sprite;
    const speed = Math.hypot(sprite.body.velocity.x, sprite.body.velocity.y);
    if (speed < 65) return;
    const spark = pixel(sprite.x, sprite.y, 4, tint, 0.7);
    fade(spark, 180, { y: sprite.y - 5 });
  }

  function impact(visual, tint) {
    const sprite = visual.sprite;
    const y = sprite.y + sprite.displayHeight / 2;
    for (const direction of [-1, 1]) {
      const chip = pixel(sprite.x, y, 4, tint, 0.75);
      fade(chip, 150, { x: sprite.x + direction * 12, y: y - 4 });
    }
  }

  function pickup(x, y, tint) {
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const chip = pixel(x, y, i % 2 ? 3 : 5, tint);
      fade(chip, 170, {
        x: x + Math.cos(angle) * 20,
        y: y + Math.sin(angle) * 20,
      });
    }
  }

  return { glow, glowImage, burst, trail, impact, pickup };
}
