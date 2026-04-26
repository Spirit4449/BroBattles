// powerups/powerupRenderer.js
import { RENDER_LAYERS } from "../gameScene/renderLayers";

export function createPowerupRenderer({
  scene,
  Phaser,
  colors,
  getUsername,
  getGameData,
  getLocalPlayer,
  getOpponentPlayers,
  getTeamPlayers,
  getLatestPowerups,
  getLatestDeathDrops,
  getLatestPlayerEffects,
  powerupCollectQueue,
  deathdropCollectQueue,
  shieldImpactQueue,
  socket,
  getMapObjects,
  getDead,
  setPowerupMobility,
  applyCharacterPowerupFx,
  drawCharacterPowerupAura,
  getCharacterPowerupMobilityModifier,
}) {
  function powerupTextureFor(type) {
    const webpKey = `pu-icon-${type}-webp`;
    const pngKey = `pu-icon-${type}-png`;
    if (scene.textures.exists(webpKey)) return webpKey;
    if (scene.textures.exists(pngKey)) return pngKey;
    return null;
  }

  function powerupLabelFor(type) {
    if (type === "gravityBoots") return "B";
    if (type === "shield") return "S";
    return String(type || "?")
      .charAt(0)
      .toUpperCase();
  }

  function deathDropTextureFor(type) {
    return type === "gem" ? "deathdrop-gem" : "deathdrop-coin";
  }

  function deathDropColorFor(type) {
    return type === "gem" ? 0x67e8f9 : 0xfacc15;
  }

  function cleanupDeathDropVisual(id, visual) {
    if (!visual) return;
    try {
      visual.colliders?.forEach((collider) => collider?.destroy?.());
    } catch (_) {}
    try {
      visual.glow?.destroy?.();
      visual.glowOuter?.destroy?.();
      visual.glowCore?.destroy?.();
    } catch (_) {}
    try {
      visual.sprite?.destroy?.();
    } catch (_) {}
    delete scene._deathDropVisuals[id];
    try {
      scene._pendingDeathDropPickups?.delete?.(id);
    } catch (_) {}
  }

  function markDeathDropLanded(visual) {
    if (!visual || visual.settled || !visual.sprite?.body) return;
    const body = visual.sprite.body;
    if (!body.blocked.down && !body.touching.down) return;
    visual.settled = true;
    visual.settledX = visual.sprite.x;
    visual.settledY = visual.sprite.y;
    try {
      visual.sprite.setVelocity(0, 0);
      visual.sprite.body.setAllowGravity(false);
      visual.sprite.body.moves = false;
      visual.sprite.body.immovable = true;
    } catch (_) {}
  }

  function spawnTrailParticle(x, y, color, r = 5, life = 260) {
    const c = scene.add.circle(x, y, r, color, 0.75);
    c.setDepth(RENDER_LAYERS.PLAYER_HUD);
    scene.tweens.add({
      targets: c,
      y: y - Phaser.Math.Between(10, 24),
      x: x + Phaser.Math.Between(-8, 8),
      alpha: 0,
      scaleX: Phaser.Math.FloatBetween(1.2, 1.8),
      scaleY: Phaser.Math.FloatBetween(1.2, 1.8),
      duration: life,
      ease: "Quad.easeOut",
      onComplete: () => c.destroy(),
    });
  }

  function getSpriteByUsername(name) {
    if (!name) return null;
    if (name === getUsername()) return getLocalPlayer();
    const w = getOpponentPlayers()[name] || getTeamPlayers()[name];
    return w?.opponent || null;
  }

  function spawnPlusParticle(x, y, color, size = 7, life = 380) {
    const g = scene.add.graphics();
    g.setDepth(RENDER_LAYERS.PLAYER_HUD);
    g.fillStyle(color, 0.88);
    g.fillRect(-size * 0.5, -size * 0.18, size, size * 0.36);
    g.fillRect(-size * 0.18, -size * 0.5, size * 0.36, size);
    g.x = x;
    g.y = y;
    scene.tweens.add({
      targets: g,
      y: y - Phaser.Math.Between(22, 42),
      x: x + Phaser.Math.Between(-10, 10),
      alpha: 0,
      angle: Phaser.Math.Between(-25, 25),
      scaleX: Phaser.Math.FloatBetween(1.1, 1.7),
      scaleY: Phaser.Math.FloatBetween(1.1, 1.7),
      duration: life,
      ease: "Quad.easeOut",
      onComplete: () => g.destroy(),
    });
  }

  function spawnArrowParticle(
    x,
    y,
    color,
    angle = -Math.PI / 2,
    size = 11,
    life = 260,
  ) {
    const g = scene.add.graphics();
    g.setDepth(RENDER_LAYERS.PLAYER_HUD);
    g.fillStyle(color, 0.9);
    g.fillRect(-size * 0.5, -size * 0.12, size * 0.62, size * 0.24);
    g.beginPath();
    g.moveTo(size * 0.12, -size * 0.32);
    g.lineTo(size * 0.52, 0);
    g.lineTo(size * 0.12, size * 0.32);
    g.closePath();
    g.fillPath();
    g.fillStyle(0xffffff, 0.72);
    g.fillRect(-size * 0.34, -size * 0.06, size * 0.24, size * 0.12);

    g.x = x;
    g.y = y;
    g.rotation = angle;
    scene.tweens.add({
      targets: g,
      x: x - Math.cos(angle) * Phaser.Math.Between(18, 30),
      y: y - Math.sin(angle) * Phaser.Math.Between(18, 30),
      alpha: 0,
      scaleX: Phaser.Math.FloatBetween(0.9, 1.25),
      scaleY: Phaser.Math.FloatBetween(0.9, 1.25),
      duration: life,
      ease: "Cubic.easeOut",
      onComplete: () => g.destroy(),
    });
  }

  function applyPowerupCharacterFX(spr, fx, nowSec, characterKey = null) {
    if (!spr || !spr.active) return;
    if (typeof spr._puBaseScaleX !== "number") {
      spr._puBaseScaleX = spr.scaleX || 1;
      spr._puBaseScaleY = spr.scaleY || 1;
    }
    if (typeof spr._puBaseOriginX !== "number") {
      spr._puBaseOriginX = typeof spr.originX === "number" ? spr.originX : 0.5;
      spr._puBaseOriginY = typeof spr.originY === "number" ? spr.originY : 0.5;
    }
    const baseX = spr._puBaseScaleX || 1;
    const baseY = spr._puBaseScaleY || 1;
    const baseOriginX = spr._puBaseOriginX ?? 0.5;
    const baseOriginY = spr._puBaseOriginY ?? 0.5;
    const rageOn = (fx?.rage || 0) > 0;
    const healthOn = (fx?.health || 0) > 0;
    const poisonOn = (fx?.poison || 0) > 0;
    const bootsOn = (fx?.gravityBoots || 0) > 0;
    const burnOn = (fx?.huntressBurn || 0) > 0;
    const custom = applyCharacterPowerupFx(characterKey, {
      scene,
      sprite: spr,
      effects: fx,
      nowSec,
      colors,
      spawnTrailParticle,
    });
    const rageLikeOn = rageOn || !!custom?.rageLike;
    if (!rageLikeOn && spr._rageLiftApplied) {
      spr._rageLiftApplied = false;
    }

    if (custom?.handled) {
      return;
    }

    if (rageOn) {
      const pulse = Math.sin(nowSec * 8 + (spr.x || 0) * 0.01);
      spr.setTint(pulse > 0 ? 0xc084fc : 0x9333ea);
      spr.setScale(baseX, baseY);
      spr.setOrigin(baseOriginX, baseOriginY);
      if (Math.random() < 0.32) {
        spawnTrailParticle(
          spr.x + Phaser.Math.Between(-14, 14),
          spr.y + Phaser.Math.Between(-26, 18),
          colors.rage,
          3.5,
          300,
        );
      }
    } else if (healthOn) {
      const healthPulse = Math.sin(nowSec * 5 + (spr.x || 0) * 0.01);
      spr.setTint(healthPulse > 0 ? 0x86efac : 0x34d399);
      spr.setScale(baseX, baseY);
      spr.setOrigin(baseOriginX, baseOriginY);
      if (Math.random() < 0.55) {
        spawnPlusParticle(
          spr.x + Phaser.Math.Between(-16, 16),
          spr.y + Phaser.Math.Between(-30, 8),
          colors.health,
          9,
          430,
        );
      }
    } else if (poisonOn) {
      spr.clearTint();
      spr.setScale(baseX, baseY);
      spr.setOrigin(baseOriginX, baseOriginY);
      if (Math.random() < 0.42) {
        spawnTrailParticle(
          spr.x + Phaser.Math.Between(-12, 12),
          spr.y + Phaser.Math.Between(-18, 18),
          colors.poison,
          4.3,
          300,
        );
      }
    } else if (burnOn) {
      const burnPulse = 0.5 + 0.5 * Math.sin(nowSec * 12 + (spr.x || 0) * 0.01);
      const burnColor = colors.huntressBurn || 0xff7a1f;
      spr.setScale(baseX, baseY);
      spr.setOrigin(baseOriginX, baseOriginY);
      spr.setTint(burnPulse > 0.5 ? 0xffb46d : 0xff6a1f);
      if (Math.random() < 0.72) {
        spawnTrailParticle(
          spr.x + Phaser.Math.Between(-14, 14),
          spr.y + Phaser.Math.Between(-28, 4),
          burnColor,
          Phaser.Math.FloatBetween(3.2, 5.4),
          290,
        );
      }
      if (Math.random() < 0.38) {
        spawnTrailParticle(
          spr.x + Phaser.Math.Between(-18, 18),
          (spr.body?.bottom || spr.y + 24) + Phaser.Math.Between(-4, 3),
          0xffe090,
          Phaser.Math.FloatBetween(2.4, 4.4),
          250,
        );
      }
    } else if (bootsOn) {
      spr.clearTint();
      spr.setScale(baseX, baseY);
      spr.setOrigin(baseOriginX, baseOriginY);
      spr.setTint(0xfca5a5);
      const vy = spr.body?.velocity?.y || 0;
      const vx = spr.body?.velocity?.x || 0;
      if (vy < -35 && Math.random() < 0.72) {
        const moveAngle = Math.atan2(
          vy || -140,
          Math.abs(vx) > 8 ? vx : spr.flipX ? -24 : 24,
        );
        spawnArrowParticle(
          spr.x + Phaser.Math.Between(-12, 12),
          spr.y + Phaser.Math.Between(8, 20),
          colors.gravityBoots,
          moveAngle + Phaser.Math.FloatBetween(-0.24, 0.24),
          Phaser.Math.Between(9, 13),
          280,
        );
      }
    } else {
      spr.clearTint();
      spr.setScale(baseX, baseY);
      spr.setOrigin(baseOriginX, baseOriginY);
    }
  }

  function consumeCollectedPowerupQueue() {
    while (powerupCollectQueue.length > 0) {
      const evt = powerupCollectQueue.shift();
      if (!evt) continue;
      const id = String(evt.id);
      const visual = scene._powerupVisuals[id];
      try {
        scene.sound.play(`pu-touch-${evt.type}`, { volume: 0.45 });
      } catch (_) {}
      if (visual && !visual.despawning) {
        visual.despawning = true;
        scene.tweens.add({
          targets: [
            visual.container,
            visual.glow,
            visual.glowOuter,
            visual.glowCore,
            visual.omenBase,
            visual.omenRing,
            visual.omenEcho,
          ].filter(Boolean),
          alpha: 0,
          scaleX: 0.2,
          scaleY: 0.2,
          angle: 180,
          duration: 220,
          ease: "Back.easeIn",
          onComplete: () => {
            try {
              visual.omenBase?.destroy?.();
              visual.omenRing?.destroy?.();
              visual.omenEcho?.destroy?.();
              visual.glow.destroy();
              visual.glowOuter.destroy();
              visual.glowCore.destroy();
              visual.container.destroy();
            } catch (_) {}
            delete scene._powerupVisuals[id];
          },
        });
      } else if (typeof evt.x === "number" && typeof evt.y === "number") {
        const puff = scene.add.circle(
          evt.x,
          evt.y,
          14,
          colors[evt.type] || 0xffffff,
          0.9,
        );
        puff.setDepth(RENDER_LAYERS.PLAYER_HUD);
        scene.tweens.add({
          targets: puff,
          alpha: 0,
          scaleX: 1.9,
          scaleY: 1.9,
          duration: 220,
          ease: "Quad.easeOut",
          onComplete: () => puff.destroy(),
        });
      }
    }
  }

  function consumeCollectedDeathDropQueue() {
    while (deathdropCollectQueue.length > 0) {
      const evt = deathdropCollectQueue.shift();
      if (!evt) continue;
      const id = String(evt.id);
      scene._pendingDeathDropPickups?.delete?.(id);
      try {
        scene.sound.play(
          evt.type === "gem" ? "sfx-gem-pickup" : "sfx-coin-pickup",
          { volume: 0.42 },
        );
      } catch (_) {}
      const visual = scene._deathDropVisuals[id];
      if (visual && !visual.despawning) {
        visual.despawning = true;
        try {
          visual.sprite.body.enable = false;
        } catch (_) {}
        scene.tweens.add({
          targets: [
            visual.sprite,
            visual.glow,
            visual.glowOuter,
            visual.glowCore,
          ],
          alpha: 0,
          scaleX: 0.2,
          scaleY: 0.2,
          angle: 220,
          duration: 190,
          ease: "Back.easeIn",
          onComplete: () => cleanupDeathDropVisual(id, visual),
        });
      } else if (typeof evt.x === "number" && typeof evt.y === "number") {
        const puff = scene.add.circle(
          evt.x,
          evt.y,
          13,
          deathDropColorFor(evt.type),
          0.88,
        );
        puff.setDepth(RENDER_LAYERS.PLAYER_HUD);
        puff.setBlendMode(Phaser.BlendModes.ADD);
        scene.tweens.add({
          targets: puff,
          alpha: 0,
          scaleX: 1.9,
          scaleY: 1.9,
          duration: 180,
          ease: "Quad.easeOut",
          onComplete: () => puff.destroy(),
        });
      }
    }
  }

  function renderDeathDrops(nowSec) {
    const seenIds = new Set();
    const latestDrops = getLatestDeathDrops() || [];

    for (const drop of latestDrops) {
      if (!drop || typeof drop.id === "undefined") continue;
      const id = String(drop.id);
      seenIds.add(id);
      let visual = scene._deathDropVisuals[id];

      if (!visual) {
        const tint = deathDropColorFor(drop.type);
        const glow = scene.add.circle(drop.spawnX, drop.spawnY, 14, tint, 0.22);
        glow.setDepth(RENDER_LAYERS.POWERUPS);
        glow.setBlendMode(Phaser.BlendModes.ADD);
        const glowOuter = scene.add.circle(
          drop.spawnX,
          drop.spawnY,
          22,
          tint,
          0.1,
        );
        glowOuter.setDepth(RENDER_LAYERS.POWERUPS - 1);
        glowOuter.setBlendMode(Phaser.BlendModes.ADD);
        const glowCore = scene.add.circle(
          drop.spawnX,
          drop.spawnY,
          8,
          0xffffff,
          0.14,
        );
        glowCore.setDepth(RENDER_LAYERS.POWERUPS);
        glowCore.setBlendMode(Phaser.BlendModes.ADD);

        const sprite = scene.physics.add.image(
          drop.spawnX,
          drop.spawnY,
          deathDropTextureFor(drop.type),
        );
        sprite.setDepth(RENDER_LAYERS.POWERUPS);
        sprite.setCollideWorldBounds(false);
        sprite.setBounce(0.16, 0.08);
        sprite.setDrag(0, 0);
        sprite.setVelocity(Number(drop.vx) || 0, Number(drop.vy) || 0);
        const maxDim = Math.max(sprite.width || 1, sprite.height || 1);
        const targetSize = drop.type === "gem" ? 26 : 24;
        const baseScale = maxDim > 0 ? targetSize / maxDim : 1;
        sprite.setScale(baseScale);
        sprite._baseDeathDropScale = baseScale;

        const colliders = [];
        for (const mapObject of getMapObjects?.() || []) {
          if (!mapObject) continue;
          colliders.push(
            scene.physics.add.collider(sprite, mapObject, () => {
              markDeathDropLanded(visual);
            }),
          );
        }

        visual = {
          id,
          type: drop.type,
          sprite,
          glow,
          glowOuter,
          glowCore,
          colliders,
          phase: Math.random() * Math.PI * 2,
          spawnedAt: Number(drop.spawnedAt) || Date.now(),
          blinkAt: Number(drop.blinkAt) || 0,
          expiresAt: Number(drop.expiresAt) || 0,
          settled: false,
          settledX: drop.spawnX,
          settledY: drop.spawnY,
          despawning: false,
        };

        scene._deathDropVisuals[id] = visual;
      }

      if (visual.despawning) continue;

      visual.spawnedAt = Number(drop.spawnedAt) || visual.spawnedAt;
      visual.blinkAt = Number(drop.blinkAt) || visual.blinkAt;
      visual.expiresAt = Number(drop.expiresAt) || visual.expiresAt;
      if (
        scene._pendingDeathDropPickups?.has(id) &&
        Date.now() - Number(visual.pickupRequestedAt || 0) > 120
      ) {
        scene._pendingDeathDropPickups.delete(id);
      }

      if (!visual.settled) {
        markDeathDropLanded(visual);
      }

      const baseScale = Number(visual.sprite?._baseDeathDropScale) || 1;
      const remainingMs =
        visual.expiresAt > 0 ? visual.expiresAt - Date.now() : 9999;
      const pulseWindowMs = Math.max(
        1,
        Number(visual.expiresAt || 0) - Number(visual.blinkAt || 0) || 3000,
      );
      const pulseT = Phaser.Math.Clamp(1 - remainingMs / pulseWindowMs, 0, 1);
      const pulseSpeed = 8 + pulseT * 26;
      const pulseWave = Math.abs(
        Math.sin(nowSec * pulseSpeed + visual.phase * 1.7),
      );
      const blinkAlpha =
        pulseT > 0 ? 0.26 + (0.74 - pulseT * 0.08) * pulseWave : 1;

      if (visual.settled) {
        const bob = Math.sin(nowSec * 2.8 + visual.phase) * 5;
        visual.sprite.x = visual.settledX;
        visual.sprite.y = visual.settledY - 6 + bob;
      }

      const x = visual.sprite.x;
      const y = visual.sprite.y;
      visual.glow.x = x;
      visual.glow.y = y + 1;
      visual.glowOuter.x = x;
      visual.glowOuter.y = y + 1;
      visual.glowCore.x = x;
      visual.glowCore.y = y + 1;

      const glowPulse = Math.abs(Math.sin(nowSec * 3.5 + visual.phase));
      visual.glow.alpha =
        (0.22 + 0.18 * glowPulse + pulseT * 0.08) * blinkAlpha;
      visual.glow.radius = 15 + 4 * glowPulse + pulseT * 2;
      visual.glowOuter.alpha =
        (0.1 + 0.1 * glowPulse + pulseT * 0.06) * blinkAlpha;
      visual.glowOuter.radius = visual.glow.radius + 7 + pulseT * 2;
      visual.glowCore.alpha =
        (0.12 + 0.08 * glowPulse + pulseT * 0.05) * blinkAlpha;
      visual.glowCore.radius = 7 + 2 * glowPulse + pulseT;
      visual.sprite.alpha = blinkAlpha;

      if (visual.type === "coin") {
        visual.sprite.scaleX =
          baseScale * (0.88 + 0.12 * Math.sin(nowSec * 7.2 + visual.phase));
        visual.sprite.scaleY = baseScale;
        visual.sprite.rotation = 0.08 * Math.sin(nowSec * 3.1 + visual.phase);
      } else {
        const scalePulse = 0.94 + 0.08 * Math.sin(nowSec * 3.6 + visual.phase);
        visual.sprite.setScale(baseScale * scalePulse);
        visual.sprite.rotation = 0.06 * Math.sin(nowSec * 2.4 + visual.phase);
      }

      if (
        visual.settled &&
        !getDead?.() &&
        !scene._pendingDeathDropPickups?.has(id) &&
        !visual.despawning
      ) {
        const local = getLocalPlayer?.();
        const localBody = local?.body;
        const localX = Number(localBody?.center?.x) || Number(local?.x);
        const localY = Number(localBody?.center?.y) || Number(local?.y);
        if (
          Number.isFinite(localX) &&
          Number.isFinite(localY) &&
          Math.hypot(localX - visual.settledX, localY - visual.settledY) <= 110
        ) {
          scene._pendingDeathDropPickups?.add(id);
          visual.pickupRequestedAt = Date.now();
          socket?.emit?.("deathdrop:pickup", {
            id: drop.id,
            x: visual.settledX,
            y: visual.settledY,
          });
        }
      }
    }

    for (const [id, visual] of Object.entries(scene._deathDropVisuals || {})) {
      if (seenIds.has(id) || visual.despawning) continue;
      visual.despawning = true;
      scene.tweens.add({
        targets: [
          visual.sprite,
          visual.glow,
          visual.glowOuter,
          visual.glowCore,
        ],
        alpha: 0,
        scaleX: 0.35,
        scaleY: 0.35,
        duration: 160,
        ease: "Quad.easeIn",
        onComplete: () => cleanupDeathDropVisual(id, visual),
      });
    }
  }

  function spriteFrameForAura(spr) {
    if (!spr) return { x: 0, y: 0, top: 0, bottom: 0, radius: 24 };
    const body = spr.body;
    if (
      body &&
      Number.isFinite(body.center?.x) &&
      Number.isFinite(body.center?.y)
    ) {
      const w = Math.max(14, Number(body.width) || 14);
      const h = Math.max(20, Number(body.height) || 20);
      return {
        x: body.center.x,
        y: body.center.y,
        top: Number(body.top) || body.center.y - h / 2,
        bottom: Number(body.bottom) || body.center.y + h / 2,
        radius: Phaser.Math.Clamp(Math.max(w, h) * 0.58, 18, 46),
      };
    }
    const h = Number(spr.height) || 48;
    return {
      x: spr.x,
      y: spr.y,
      top: spr.y - h / 2,
      bottom: spr.y + h / 2,
      radius: Phaser.Math.Clamp(h * 0.58, 18, 46),
    };
  }

  function renderPowerupAuras(nowSec) {
    const g = scene._powerupAuraGraphics;
    if (!g) return;
    g.clear();

    const username = getUsername();
    const gameData = getGameData();
    const latestPlayerEffects = getLatestPlayerEffects() || {};
    const me = latestPlayerEffects[username] || {};

    const baseSpeedMult = (me.rage || 0) > 0 ? 1.25 : 1;
    const baseJumpMult = (me.gravityBoots || 0) > 0 ? 1.5 : 1;
    const effectSpeedMult =
      (me.freeze || 0) > 0 || (me.stun || 0) > 0
        ? 0
        : (me.gloopHookSlow || 0) > 0
          ? 0.5
          : (me.gloopSlimeSlow || 0) > 0
            ? 0.7
            : (me.slow || 0) > 0
              ? 0.45
              : 1;
    const effectJumpMult =
      (me.freeze || 0) > 0 || (me.stun || 0) > 0
        ? 0
        : (me.gloopHookSlow || 0) > 0
          ? 0.5
          : (me.gloopSlimeSlow || 0) > 0
            ? 0.7
            : (me.slow || 0) > 0
              ? 0.7
              : 1;
    const charMobility = getCharacterPowerupMobilityModifier(
      gameData?.yourCharacter,
      me,
    );
    const speedMult =
      baseSpeedMult * effectSpeedMult * (charMobility?.speedMult || 1);
    const jumpMult =
      baseJumpMult * effectJumpMult * (charMobility?.jumpMult || 1);
    setPowerupMobility(speedMult, jumpMult);

    const drawAura = (spr, fx) => {
      if (!spr || !fx) return;
      const frame = spriteFrameForAura(spr);
      const x = frame.x;
      const y = frame.y;
      const r = frame.radius;
      const pulse = 0.75 + 0.25 * Math.sin(nowSec * 8 + x * 0.01);
      if ((fx.health || 0) > 0) {
        g.fillStyle(colors.health, 0.12 * pulse);
        g.fillCircle(x, y, r + 4 * pulse);
        g.lineStyle(3, colors.health, 0.75 * pulse);
        g.strokeCircle(x, y, r + 4 * pulse);
      }
      if ((fx.shield || 0) > 0) {
        g.fillStyle(colors.shield, 0.22);
        g.fillCircle(x, y, Math.max(16, r - 4 + 4 * pulse));
        g.lineStyle(4, colors.shield, 0.82 * pulse);
        g.strokeCircle(x, y, Math.max(16, r - 4 + 4 * pulse));
        g.fillStyle(0xffedd5, 0.08 + 0.05 * pulse);
        g.fillCircle(x, y, Math.max(12, r - 16 + 2 * pulse));
      }
      if ((fx.respawnShield || 0) > 0) {
        const shieldRadius = Math.max(18, r + 2 + 6 * pulse);
        g.fillStyle(0xffffff, 0.12 + 0.04 * pulse);
        g.fillCircle(x, y, Math.max(14, shieldRadius - 7));
        g.lineStyle(5, 0xffffff, 0.92 * pulse);
        g.strokeCircle(x, y, shieldRadius);
        g.lineStyle(2.5, 0xbfe9ff, 0.78 * pulse);
        g.strokeCircle(x, y, shieldRadius + 8);
        g.fillStyle(0xe0f7ff, 0.08 + 0.06 * pulse);
        g.fillCircle(x, y, Math.max(10, shieldRadius - 16));
      }
      if ((fx.poison || 0) > 0) {
        g.fillStyle(colors.poison, 0.1 * pulse);
        g.fillCircle(x, y, Math.max(16, r - 2 + 3 * pulse));
        g.lineStyle(3, colors.poison, 0.75 * pulse);
        g.strokeCircle(x, y, Math.max(16, r - 2 + 3 * pulse));
      }
      if ((fx.huntressBurn || 0) > 0) {
        const burnColor = colors.huntressBurn || 0xff7a1f;
        g.fillStyle(burnColor, 0.12 + 0.06 * pulse);
        g.fillCircle(x, y, Math.max(16, r - 1 + 4 * pulse));
        g.lineStyle(3, burnColor, 0.72 * pulse);
        g.strokeCircle(x, y, Math.max(16, r + 4 + 3 * pulse));
      }
      if ((fx.gloopHookSlow || 0) > 0 || (fx.gloopSlimeSlow || 0) > 0) {
        const slowColor = 0x54c7ff;
        g.fillStyle(slowColor, 0.16 + 0.06 * pulse);
        g.fillCircle(x, y, Math.max(16, r - 2 + 4 * pulse));
        g.lineStyle(3.5, 0xa6e8ff, 0.8 * pulse);
        g.strokeCircle(x, y, Math.max(16, r + 5 + 4 * pulse));

        const arrowCount = 3;
        const arrowTop = frame.top - 18 - 5 * pulse;
        const spacing = 14;
        for (let i = 0; i < arrowCount; i += 1) {
          const ax = x + (i - 1) * spacing;
          const ay = arrowTop - Math.sin(nowSec * 7 + i * 0.9) * 3;
          const arrowHeight = 15;
          const arrowHalf = 5;
          g.fillStyle(0x7ad9ff, 0.9);
          g.fillTriangle(
            ax - arrowHalf,
            ay,
            ax + arrowHalf,
            ay,
            ax,
            ay + arrowHeight,
          );
          g.fillStyle(0xc9f3ff, 0.75);
          g.fillRect(ax - 1.5, ay - 10, 3, 9);
        }
      }
      if ((fx.rage || 0) > 0) {
        g.fillStyle(colors.rage, 0.2 + 0.08 * pulse);
        g.fillCircle(x, y, Math.max(16, r - 4 + 4 * pulse));
        g.lineStyle(3.5, colors.rage, 0.85 * pulse);
        g.strokeCircle(x, y, r + 3 + 4 * pulse);
        g.lineStyle(
          2.5,
          0xffffff,
          0.3 + 0.25 * Math.abs(Math.sin(nowSec * 16 + y * 0.015)),
        );
        g.strokeCircle(x, y, r + 8 + 2.2 * pulse);
      }
      if ((fx.gravityBoots || 0) > 0) {
        const bootY = frame.bottom - 2;
        g.fillStyle(colors.gravityBoots, 0.22 * pulse);
        g.fillEllipse(x, bootY, Math.max(28, r + 4), 10);
        g.lineStyle(2, colors.gravityBoots, 0.75 * pulse);
        g.strokeEllipse(x, bootY, Math.max(28, r + 4), 10);
      }
    };

    const localPlayer = getLocalPlayer();
    drawAura(localPlayer, latestPlayerEffects[username] || {});
    drawCharacterPowerupAura(gameData?.yourCharacter, {
      graphics: g,
      frame: spriteFrameForAura(localPlayer),
      effects: latestPlayerEffects[username] || {},
      nowSec,
      colors,
    });
    applyPowerupCharacterFX(
      localPlayer,
      latestPlayerEffects[username] || {},
      nowSec,
      gameData?.yourCharacter,
    );

    for (const [name, fx] of Object.entries(latestPlayerEffects || {})) {
      if (name === username) continue;
      const wrapper = getOpponentPlayers()[name] || getTeamPlayers()[name];
      if (!wrapper || !wrapper.opponent) continue;
      drawAura(wrapper.opponent, fx);
      drawCharacterPowerupAura(wrapper.character, {
        graphics: g,
        frame: spriteFrameForAura(wrapper.opponent),
        effects: fx,
        nowSec,
        colors,
      });
      applyPowerupCharacterFX(wrapper.opponent, fx, nowSec, wrapper.character);
    }

    const fxG = scene._powerupFxGraphics;
    while (shieldImpactQueue.length > 0) {
      const impact = shieldImpactQueue.shift();
      const spr = getSpriteByUsername(impact?.username);
      if (!spr || !fxG) continue;
      const frame = spriteFrameForAura(spr);
      const x = frame.x;
      const y = frame.y;
      for (let i = 0; i < 3; i++) {
        const ring = scene.add.circle(
          x,
          y,
          24 + i * 4,
          colors.shield,
          0.22 - i * 0.05,
        );
        ring.setDepth(RENDER_LAYERS.PLAYER_HUD + 1);
        ring.setStrokeStyle(3, 0xffedd5, 0.85);
        scene.tweens.add({
          targets: ring,
          alpha: 0,
          scaleX: 1.45 + i * 0.08,
          scaleY: 1.45 + i * 0.08,
          duration: 220 + i * 40,
          ease: "Cubic.easeOut",
          onComplete: () => ring.destroy(),
        });
      }
    }
  }

  function renderPowerupsAndEffects() {
    consumeCollectedPowerupQueue();
    consumeCollectedDeathDropQueue();
    const nowSec = scene.time.now / 1000;
    const seenIds = new Set();
    const fxG = scene._powerupFxGraphics;
    if (fxG) fxG.clear();

    for (const pu of getLatestPowerups() || []) {
      if (!pu || typeof pu.id === "undefined") continue;
      const id = String(pu.id);
      seenIds.add(id);
      let visual = scene._powerupVisuals[id];
      if (!visual) {
        const glowColor = colors[pu.type] || 0xffffff;
        const glow = scene.add.circle(pu.x, pu.y, 16, glowColor, 0.28);
        glow.setDepth(RENDER_LAYERS.POWERUPS);
        glow.setBlendMode(Phaser.BlendModes.ADD);
        const glowOuter = scene.add.circle(pu.x, pu.y, 24, glowColor, 0.12);
        glowOuter.setDepth(RENDER_LAYERS.POWERUPS - 1);
        glowOuter.setBlendMode(Phaser.BlendModes.ADD);
        const glowCore = scene.add.circle(pu.x, pu.y, 10, 0xffffff, 0.16);
        glowCore.setDepth(RENDER_LAYERS.POWERUPS);
        glowCore.setBlendMode(Phaser.BlendModes.ADD);
        const omenBase = scene.add.circle(pu.x, pu.y + 4, 16, glowColor, 0.34);
        omenBase.setDepth(RENDER_LAYERS.POWERUPS - 1);
        omenBase.setBlendMode(Phaser.BlendModes.ADD);
        const omenRing = scene.add.circle(pu.x, pu.y + 4, 24, glowColor, 0.24);
        omenRing.setDepth(RENDER_LAYERS.POWERUPS);
        omenRing.setStrokeStyle(4, 0xffffff, 0.72);
        omenRing.setBlendMode(Phaser.BlendModes.ADD);
        const omenEcho = scene.add.circle(pu.x, pu.y + 4, 36, glowColor, 0.14);
        omenEcho.setDepth(RENDER_LAYERS.POWERUPS - 2);
        omenEcho.setBlendMode(Phaser.BlendModes.ADD);
        const iconKey = powerupTextureFor(pu.type);
        const children = [];
        let spr = null;
        if (iconKey) {
          spr = scene.add.image(0, 3, iconKey);
          spr.setOrigin(0.5, 0.5);
          const maxDim = Math.max(spr.width || 1, spr.height || 1);
          const targetSize = 42;
          const s = maxDim > 0 ? targetSize / maxDim : 1;
          spr.setScale(s);
          children.push(spr);
        } else {
          const badge = scene.add.circle(
            0,
            0,
            12,
            colors[pu.type] || 0xffffff,
            0.9,
          );
          const lbl = scene.add.text(0, -1, powerupLabelFor(pu.type), {
            fontFamily: "Press Start 2P",
            fontSize: "10px",
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 3,
          });
          lbl.setOrigin(0.5, 0.5);
          children.push(badge, lbl);
        }
        const container = scene.add.container(pu.x, pu.y, children);
        container.setDepth(RENDER_LAYERS.POWERUPS);
        visual = {
          id,
          type: pu.type,
          x: pu.x,
          y: pu.y,
          activeAt: Number(pu.activeAt) || Number(pu.spawnedAt) || Date.now(),
          expiresAt: Number(pu.expiresAt) || 0,
          glow,
          glowOuter,
          glowCore,
          omenBase,
          omenRing,
          omenEcho,
          sprite: spr,
          container,
          phase: Math.random() * Math.PI * 2,
          activated: false,
          despawning: false,
        };
        visual.container.setAlpha(0);
        visual.glow.setAlpha(0);
        visual.glowOuter.setAlpha(0);
        visual.glowCore.setAlpha(0);
        visual.container.setScale(0.55);
        visual.glow.setScale(0.45);
        visual.glowOuter.setScale(0.45);
        visual.glowCore.setScale(0.45);
        scene._powerupVisuals[id] = visual;
      }

      if (!visual.despawning) {
        const nowMs = Date.now();
        visual.activeAt =
          Number(pu.activeAt) ||
          visual.activeAt ||
          Number(pu.spawnedAt) ||
          nowMs;
        visual.expiresAt = Number(pu.expiresAt) || visual.expiresAt || 0;
        visual.x = pu.x;
        visual.y = pu.y;
        const isActive = nowMs >= visual.activeAt;

        if (!visual.activated && isActive) {
          visual.activated = true;
          const activationAge = nowMs - visual.activeAt;
          if (activationAge > 260) {
            visual.container.setPosition(pu.x, pu.y - 6);
            visual.glow.setPosition(pu.x, pu.y - 5);
            visual.glowOuter.setPosition(pu.x, pu.y - 5);
            visual.glowCore.setPosition(pu.x, pu.y - 5);
            visual.container.setScale(1);
            visual.glow.setScale(1);
            visual.glowOuter.setScale(1);
            visual.glowCore.setScale(1);
            visual.container.setAlpha(1);
            visual.glow.setAlpha(1);
            visual.glowOuter.setAlpha(1);
            visual.glowCore.setAlpha(1);
            if (visual.omenBase) visual.omenBase.alpha = 0;
            if (visual.omenRing) visual.omenRing.alpha = 0;
            if (visual.omenEcho) visual.omenEcho.alpha = 0;
          } else {
            visual.container.setPosition(pu.x, pu.y + 16);
            visual.glow.setPosition(pu.x, pu.y + 17);
            visual.glowOuter.setPosition(pu.x, pu.y + 17);
            visual.glowCore.setPosition(pu.x, pu.y + 17);
            visual.container.setScale(0.78);
            visual.glow.setScale(0.72);
            visual.glowOuter.setScale(0.72);
            visual.glowCore.setScale(0.72);
            scene.tweens.add({
              targets: [
                visual.omenBase,
                visual.omenRing,
                visual.omenEcho,
              ].filter(Boolean),
              alpha: 0,
              scaleX: 1.28,
              scaleY: 1.28,
              duration: 220,
              ease: "Quad.easeIn",
            });
            scene.tweens.add({
              targets: [
                visual.container,
                visual.glow,
                visual.glowOuter,
                visual.glowCore,
              ],
              alpha: 1,
              y: "-=22",
              scaleX: 1,
              scaleY: 1,
              duration: 340,
              ease: "Cubic.easeOut",
            });
          }
        }

        if (!isActive) {
          const omenProgress = Phaser.Math.Clamp(
            1 - (visual.activeAt - nowMs) / 2000,
            0,
            1,
          );
          const omenPulse = 0.5 + 0.5 * Math.sin(nowSec * 7 + visual.phase);
          const omenX = pu.x;
          const omenY = pu.y + 4;
          visual.container.setAlpha(0);
          visual.glow.setAlpha(0);
          visual.glowOuter.setAlpha(0);
          visual.glowCore.setAlpha(0);
          visual.omenBase?.setPosition(omenX, omenY);
          visual.omenRing?.setPosition(omenX, omenY);
          visual.omenEcho?.setPosition(omenX, omenY);
          if (visual.omenBase) {
            visual.omenBase.alpha = 0.28 + 0.26 * omenPulse;
            visual.omenBase.radius = 14 + omenProgress * 12 + omenPulse * 4;
          }
          if (visual.omenRing) {
            visual.omenRing.alpha = 0.32 + 0.28 * omenPulse;
            visual.omenRing.radius = 22 + omenProgress * 20 + omenPulse * 7;
          }
          if (visual.omenEcho) {
            visual.omenEcho.alpha = 0.12 + 0.16 * omenPulse;
            visual.omenEcho.radius = 34 + omenProgress * 30 + omenPulse * 10;
          }
          continue;
        }

        const bob = Math.sin(nowSec * 2.8 + visual.phase) * 5;
        let shakeX = 0;
        let shakeY = 0;
        if (visual.expiresAt > 0) {
          const remainingMs = visual.expiresAt - Date.now();
          if (remainingMs <= 2800) {
            const warn = Phaser.Math.Clamp(1 - remainingMs / 2800, 0, 1);
            const speed = 12 + warn * 5;
            const amp = 0.8 + warn * 1.8;
            shakeX = Math.sin(nowSec * speed + visual.phase * 3) * amp;
            shakeY =
              Math.cos(nowSec * (speed * 1.13) + visual.phase * 3) * amp * 0.6;
          }
        }
        if (visual.omenBase) visual.omenBase.alpha = 0;
        if (visual.omenRing) visual.omenRing.alpha = 0;
        if (visual.omenEcho) visual.omenEcho.alpha = 0;
        visual.container.x = pu.x + shakeX;
        visual.container.y = pu.y - 6 + bob + shakeY;
        visual.glow.x = pu.x + shakeX;
        visual.glow.y = pu.y - 6 + bob + shakeY + 1;
        visual.glowOuter.x = visual.glow.x;
        visual.glowOuter.y = visual.glow.y;
        visual.glowCore.x = visual.glow.x;
        visual.glowCore.y = visual.glow.y;
        const glowPulse = Math.abs(Math.sin(nowSec * 3.5 + visual.phase));
        visual.glow.alpha = 0.28 + 0.22 * glowPulse;
        visual.glow.radius =
          17 + 5 * Math.abs(Math.sin(nowSec * 2.7 + visual.phase));
        visual.glowOuter.alpha = 0.14 + 0.12 * glowPulse;
        visual.glowOuter.radius = visual.glow.radius + 8;
        visual.glowCore.alpha =
          0.14 + 0.1 * Math.abs(Math.sin(nowSec * 5.2 + visual.phase));
        visual.glowCore.radius = 9 + 2 * glowPulse;
        if (visual.sprite) {
          const baseS = visual.sprite.scaleY || 1;
          visual.sprite.scaleX =
            baseS * (0.9 + 0.1 * Math.sin(nowSec * 4.1 + visual.phase));
          visual.sprite.scaleY = baseS;
          visual.sprite.rotation = 0.05 * Math.sin(nowSec * 2.1 + visual.phase);
        }

        if (fxG) {
          const c = colors[pu.type] || 0xffffff;
          const ringCy = visual.container.y + 8;
          const r1 = 21 + 4 * Math.sin(nowSec * 3 + visual.phase);
          const r2 = 27 + 3 * Math.sin(nowSec * 2.1 + visual.phase + 0.8);
          if (pu.type === "rage") {
            const shimmer =
              0.28 + 0.22 * Math.abs(Math.sin(nowSec * 14 + visual.phase));
            fxG.fillStyle(colors.rage, 0.22);
            fxG.fillCircle(
              visual.container.x,
              ringCy,
              18 + 2 * Math.sin(nowSec * 5 + visual.phase),
            );
            fxG.lineStyle(3, 0xffffff, shimmer);
            fxG.strokeCircle(visual.container.x, ringCy, r1 + 6);
            for (let i = 0; i < 3; i++) {
              const aa = nowSec * (2.3 + i * 0.2) + visual.phase + i * 2.1;
              fxG.fillStyle(0xffffff, 0.75 - i * 0.15);
              fxG.fillCircle(
                visual.container.x + Math.cos(aa) * (r1 + 4),
                ringCy + Math.sin(aa) * (r1 + 4),
                2.2 - i * 0.35,
              );
            }
          }
          fxG.lineStyle(2.5, c, 0.6);
          fxG.strokeCircle(visual.container.x, ringCy, r1);
          fxG.lineStyle(2.5, c, 0.38);
          fxG.strokeCircle(visual.container.x, ringCy, r2);
          for (let i = 0; i < 4; i++) {
            const a = nowSec * (1.6 + i * 0.15) + visual.phase + i * 1.57;
            const px = visual.container.x + Math.cos(a) * (r1 + 3);
            const py = ringCy + Math.sin(a) * (r1 + 3);
            fxG.fillStyle(c, 0.8);
            fxG.fillCircle(px, py, 3);
          }
        }
      }
    }

    for (const [id, visual] of Object.entries(scene._powerupVisuals)) {
      if (seenIds.has(id) || visual.despawning) continue;
      visual.despawning = true;
      scene.tweens.add({
        targets: [
          visual.container,
          visual.glow,
          visual.glowOuter,
          visual.glowCore,
          visual.omenBase,
          visual.omenRing,
          visual.omenEcho,
        ].filter(Boolean),
        alpha: 0,
        scaleX: 0.35,
        scaleY: 0.35,
        duration: 180,
        ease: "Quad.easeIn",
        onComplete: () => {
          try {
            visual.omenBase?.destroy?.();
            visual.omenRing?.destroy?.();
            visual.omenEcho?.destroy?.();
            visual.glow.destroy();
            visual.glowOuter.destroy();
            visual.glowCore.destroy();
            visual.container.destroy();
          } catch (_) {}
          delete scene._powerupVisuals[id];
        },
      });
    }

    renderDeathDrops(nowSec);
    renderPowerupAuras(nowSec);
  }

  return {
    renderPowerupsAndEffects,
  };
}
