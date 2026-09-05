// powerups/powerupRenderer.js
import { RENDER_LAYERS } from "../gameScene/renderLayers";
import { createDeathLootEffects, handleDeathLootContact } from "./deathLootEffects";

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
  setLocalPowerupInvisible,
  applyCharacterPowerupFx,
  drawCharacterPowerupAura,
  getCharacterPowerupMobilityModifier,
}) {
  const auraBubbleStates = new Map();
  const deathLootFx = createDeathLootEffects(scene, Phaser);
  const deathBursts = new Map();

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

  function primeClaimedBubble(username, spr, color, shouldForm = true) {
    if (!username || !spr?.active) return;
    const frame = spriteFrameForAura(spr);
    const state = auraBubbleStates.get(username) || {
      x: frame.x,
      y: frame.y,
      dx: 0,
      dy: 0,
      lastVx: Number(spr.body?.velocity?.x) || 0,
      lastVy: Number(spr.body?.velocity?.y) || 0,
      grounded: false,
      phase: Math.random() * Math.PI * 2,
    };
    state.color = color;
    state.strength = 1;
    if (!state.styles?.length || shouldForm) {
      state.styles = [{ type: "claim", color, strength: 1 }];
    }
    state.arrivalPendingUntil = 0;
    if (shouldForm) {
      state.alpha = 0.08;
      state.scale = 0.62;
      state.scaleVelocity = 4.8;
      state.wobble = 0.72;
    } else {
      state.wobble = Math.min(1.2, (state.wobble || 0) + 0.42);
    }
    state.claimedUntil = scene.time.now + 520;
    auraBubbleStates.set(username, state);
  }

  function spawnShockwaveExplosion(x, y, scale = 5.2) {
    const textureKey = "pu-shockwave-explosion";
    const animationKey = "pu-shockwave-explosion-burst";
    if (!scene.textures?.exists(textureKey)) return null;

    if (!scene.anims?.exists(animationKey)) {
      const texture = scene.textures.get(textureKey);
      let frameNames = texture?.getFrameNames?.() || [];
      frameNames = frameNames
        .filter((name) => /explosion/i.test(String(name)))
        .sort((a, b) => {
          const aNumber = Number(String(a).match(/\d+/)?.[0]) || 0;
          const bNumber = Number(String(b).match(/\d+/)?.[0]) || 0;
          return aNumber - bNumber;
        });
      if (frameNames.length) {
        scene.anims.create({
          key: animationKey,
          frames: frameNames.map((frame) => ({ key: textureKey, frame })),
          frameRate: 30,
          repeat: 0,
        });
      }
    }

    const explosion = scene.add.sprite(x, y, textureKey);
    explosion.setDepth(RENDER_LAYERS.PLAYER_HUD + 1);
    explosion.setScale(scale);
    explosion.setBlendMode(Phaser.BlendModes.ADD);
    if (scene.anims?.exists(animationKey)) {
      explosion.anims.play(animationKey);
      explosion.once("animationcomplete", () => explosion.destroy());
    } else {
      scene.tweens.add({
        targets: explosion,
        alpha: 0,
        scaleX: scale * 1.35,
        scaleY: scale * 1.35,
        duration: 320,
        onComplete: () => explosion.destroy(),
      });
    }
    return explosion;
  }

  function spawnShockwaveRing(x, y, delay = 0, phase = 0) {
    scene.time.delayedCall(delay, () => {
      const graphics = scene.add.graphics();
      graphics.setDepth(RENDER_LAYERS.PLAYER_HUD + 1);
      graphics.setBlendMode(Phaser.BlendModes.ADD);
      const state = { progress: 0 };
      scene.tweens.add({
        targets: state,
        progress: 1,
        duration: 500,
        ease: "Cubic.easeOut",
        onUpdate: () => {
          const progress = state.progress;
          const radius = 26 + progress * 394;
          const alpha = Math.max(0, 1 - progress);
          const points = [];
          for (let i = 0; i < 42; i += 1) {
            const angle = (i / 42) * Math.PI * 2;
            const ripple =
              Math.sin(angle * 5 + phase + progress * 7) * (8 - progress * 4) +
              Math.sin(angle * 9 - phase) * 3;
            points.push(
              new Phaser.Geom.Point(
                x + Math.cos(angle) * (radius + ripple),
                y + Math.sin(angle) * (radius + ripple) * 0.78,
              ),
            );
          }
          graphics.clear();
          graphics.fillStyle(0xff5a1f, 0.09 * alpha);
          graphics.fillPoints(points, true);
          graphics.lineStyle(12 - progress * 8, 0xff8a00, 0.55 * alpha);
          graphics.strokePoints(points, true);
          graphics.lineStyle(3, 0xfff1b8, 0.95 * alpha);
          graphics.strokePoints(points, true);
        },
        onComplete: () => graphics.destroy(),
      });
    });
  }

  function spawnPowerupClaimFx(evt, visual) {
    const collector = getSpriteByUsername(evt?.username);
    const sx = Number(evt?.x ?? visual?.container?.x);
    const sy = Number(evt?.y ?? visual?.container?.y);
    const color = colors[evt?.type] || 0xffffff;
    if (!collector?.active || !Number.isFinite(sx) || !Number.isFinite(sy)) {
      return false;
    }
    if (evt?.type === "shockwave") {
      const frame = spriteFrameForAura(collector);
      const shockwaveColor = colors.shockwave || 0xff8a00;
      spawnShockwaveExplosion(frame.x, frame.y, 5.4);
      for (let ring = 0; ring < 3; ring += 1) {
        spawnShockwaveRing(frame.x, frame.y, ring * 65, ring * 1.4);
      }
      for (let burst = 0; burst < 5; burst += 1) {
        const angle = (burst / 5) * Math.PI * 2 + 0.28;
        scene.time.delayedCall(35 + burst * 18, () => {
          spawnShockwaveExplosion(
            frame.x + Math.cos(angle) * 72,
            frame.y + Math.sin(angle) * 48,
            2.25,
          );
        });
      }

      const flash = scene.add.circle(frame.x, frame.y, 38, 0xfff7d6, 0.9);
      flash.setDepth(RENDER_LAYERS.PLAYER_HUD + 2);
      flash.setBlendMode(Phaser.BlendModes.ADD);
      scene.tweens.add({
        targets: flash,
        scaleX: 4.5,
        scaleY: 3.2,
        alpha: 0,
        duration: 260,
        ease: "Cubic.easeOut",
        onComplete: () => flash.destroy(),
      });

      for (let i = 0; i < 30; i += 1) {
        const angle = (i / 30) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.08, 0.08);
        const spark = scene.add.circle(
          frame.x,
          frame.y,
          Phaser.Math.FloatBetween(1.8, 4.5),
          i % 4 === 0 ? 0xffffff : i % 2 === 0 ? 0xffd166 : shockwaveColor,
          0.9,
        );
        spark.setDepth(RENDER_LAYERS.PLAYER_HUD + 2);
        spark.setBlendMode(Phaser.BlendModes.ADD);
        const distance = Phaser.Math.Between(170, 430);
        scene.tweens.add({
          targets: spark,
          x: frame.x + Math.cos(angle) * distance,
          y: frame.y + Math.sin(angle) * distance * 0.78,
          alpha: 0,
          scaleX: 0.15,
          scaleY: 0.15,
          duration: Phaser.Math.Between(330, 520),
          ease: "Quad.easeOut",
          onComplete: () => spark.destroy(),
        });
      }

      const localFrame = spriteFrameForAura(getLocalPlayer());
      const distanceToLocal = Math.hypot(localFrame.x - frame.x, localFrame.y - frame.y);
      if (distanceToLocal < 700) {
        scene.cameras?.main?.shake?.(
          250,
          Phaser.Math.Linear(0.003, 0.014, 1 - distanceToLocal / 700),
        );
      }
      return true;
    }
    const existingFx = (getLatestPlayerEffects() || {})[evt?.username] || {};
    const shouldForm = !activeBubbleStyle(existingFx);
    if (shouldForm) {
      const frame = spriteFrameForAura(collector);
      auraBubbleStates.set(evt.username, {
        x: frame.x,
        y: frame.y,
        dx: 0,
        dy: 0,
        lastVx: Number(collector.body?.velocity?.x) || 0,
        lastVy: Number(collector.body?.velocity?.y) || 0,
        grounded: false,
        phase: Math.random() * Math.PI * 2,
        color,
        strength: 1,
        styles: [{ type: evt?.type || "claim", color, strength: 1 }],
        alpha: 0,
        scale: 0.48,
        scaleVelocity: 0,
        wobble: 0.2,
        arrivalPendingUntil: scene.time.now + 270,
        claimedUntil: scene.time.now + 620,
      });
    }

    const stream = [
      scene.add.ellipse(sx, sy, 25, 12, color, 0.68),
      scene.add.ellipse(sx, sy, 19, 8, 0xffffff, 0.42),
      scene.add.ellipse(sx, sy, 13, 6, color, 0.28),
    ];
    stream.forEach((part, i) => {
      part.setBlendMode(Phaser.BlendModes.ADD);
      part.setDepth(RENDER_LAYERS.PLAYER_HUD + 2 - i * 0.01);
    });
    const travel = { t: 0 };
    const side = Phaser.Math.Between(0, 1) === 0 ? -1 : 1;
    scene.tweens.add({
      targets: travel,
      t: 1,
      duration: 235,
      ease: "Cubic.easeIn",
      onUpdate: () => {
        if (!stream[0].active) return;
        const frame = spriteFrameForAura(collector);
        stream.forEach((part, i) => {
          const t = Phaser.Math.Clamp(travel.t - i * 0.035, 0, 1);
          const bend = Math.sin(t * Math.PI) * 22 * side;
          const x = Phaser.Math.Linear(sx, frame.x, t) + bend * (1 - t * 0.5);
          const y = Phaser.Math.Linear(sy, frame.y, t) - Math.sin(t * Math.PI) * 20;
          const nextT = Math.min(1, t + 0.025);
          const nextX =
            Phaser.Math.Linear(sx, frame.x, nextT) +
            Math.sin(nextT * Math.PI) * 22 * side * (1 - nextT * 0.5);
          const nextY =
            Phaser.Math.Linear(sy, frame.y, nextT) -
            Math.sin(nextT * Math.PI) * 20;
          part.setPosition(x, y);
          part.setRotation(Math.atan2(nextY - y, nextX - x));
          part.setScale(1 + Math.sin(t * Math.PI) * 0.7, 0.85 - t * 0.35);
          part.setAlpha((0.68 - i * 0.16) * Math.min(1, t * 8) * (1 - t * 0.45));
        });
      },
      onComplete: () => {
        stream.forEach((part) => part.destroy());
        primeClaimedBubble(evt?.username, collector, color, shouldForm);
      },
    });
    return true;
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
    const invisibleOn = (fx?.invisibility || 0) > 0;
    const freezeOn = (fx?.freeze || 0) > 0;
    if (invisibleOn) {
      spr.clearTint();
      spr.setScale(baseX, baseY);
      spr.setOrigin(baseOriginX, baseOriginY);
      const vx = Number(spr.body?.velocity?.x) || 0;
      const vy = Number(spr.body?.velocity?.y) || 0;
      if ((Math.abs(vx) > 10 || Math.abs(vy) > 18) && Math.random() < 0.12) {
        const mote = scene.add.circle(
          spr.x - Math.sign(vx || (spr.flipX ? -1 : 1)) * Phaser.Math.Between(5, 12),
          (spr.body?.bottom || spr.y + 20) + Phaser.Math.Between(-5, 3),
          Phaser.Math.FloatBetween(1.1, 2.2),
          colors.invisibility || 0x9ca3af,
          0.12,
        );
        mote.setDepth(RENDER_LAYERS.PLAYER_HUD - 1);
        scene.tweens.add({
          targets: mote,
          x: mote.x - vx * 0.055,
          y: mote.y - Phaser.Math.Between(2, 8),
          alpha: 0,
          scaleX: 1.5,
          scaleY: 0.5,
          duration: Phaser.Math.Between(320, 480),
          ease: "Quad.easeOut",
          onComplete: () => mote.destroy(),
        });
      }
      return;
    }
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

    if (freezeOn) {
      const freezePulse = Math.sin(nowSec * 5 + (spr.x || 0) * 0.01);
      spr.setTint(freezePulse > 0 ? 0xdffaff : 0x67e8f9);
      spr.setScale(baseX, baseY);
      spr.setOrigin(baseOriginX, baseOriginY);
      if (Math.random() < 0.24) {
        spawnTrailParticle(
          spr.x + Phaser.Math.Between(-12, 12),
          spr.y + Phaser.Math.Between(-22, 18),
          colors.freeze || 0x67e8f9,
          Phaser.Math.FloatBetween(1.5, 2.8),
          360,
        );
      }
    } else if (rageOn) {
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
      const collector = getSpriteByUsername(evt.username);
      if (collector) {
        collector._recentPowerupEffects ||= Object.create(null);
        // Instant pickups (notably shockwave) still get a readable HUD beat.
        collector._recentPowerupEffects[evt.type] = Date.now() + 900;
      }
      const id = String(evt.id);
      const visual = scene._powerupVisuals[id];
      try {
        scene.sound.play(`pu-touch-${evt.type}`, { volume: 0.45 });
      } catch (_) {}
      const hasClaimFx = spawnPowerupClaimFx(evt, visual);
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
          scaleX: 0.45,
          scaleY: 0.12,
          angle: 70,
          duration: 170,
          ease: "Cubic.easeIn",
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
      } else if (
        !hasClaimFx &&
        typeof evt.x === "number" &&
        typeof evt.y === "number"
      ) {
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
        const burstKey = `${drop.spawnedAt}:${drop.spawnX}:${drop.spawnY}`;
        if (!deathBursts.has(burstKey)) {
          deathBursts.set(burstKey, scene.time.now);
          // Reconnected clients should not replay old death flashes.
          if (Date.now() - Number(drop.spawnedAt) < 1500) {
            deathLootFx.burst(drop.spawnX, drop.spawnY);
          }
        }
        const glow = deathLootFx.glow(drop.spawnX, drop.spawnY, 54, tint, 0.65);
        const glowOuter = deathLootFx.glow(drop.spawnX, drop.spawnY, 86, tint, 0.28,
          RENDER_LAYERS.POWERUPS - 1);
        const glowCore = deathLootFx.glow(drop.spawnX, drop.spawnY, 22, 0xffffff, 0.5);

        const sprite = scene.physics.add.image(
          drop.spawnX,
          drop.spawnY,
          deathDropTextureFor(drop.type),
        );
        sprite.setDepth(RENDER_LAYERS.POWERUPS);
        sprite.setCollideWorldBounds(false);
        sprite.setBounce(0.45, 0.42);
        sprite.setDrag(35, 0);
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
              handleDeathLootContact(visual, scene.time.now, (landed) => {
                deathLootFx.impact(landed, tint);
              });
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
          bounces: 0,
          nextTrailAt: scene.time.now,
          bornAt: scene.time.now,
          spin: (Number(drop.vx) < 0 ? -1 : 1) * (drop.type === "gem" ? 4 : 7),
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

      const deathAgeMs = Math.max(0, Date.now() - visual.spawnedAt);
      if (!visual.settled && deathAgeMs < 650 && scene.time.now >= visual.nextTrailAt) {
        // Bounded cadence; never catch up by emitting a backlog after a slow frame.
        visual.nextTrailAt = scene.time.now + 65;
        deathLootFx.trail(visual, deathDropColorFor(visual.type));
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
        const lift = Math.min(1, (scene.time.now - visual.settledAt) / 220);
        visual.sprite.y = visual.settledY + (-6 + bob) * lift;
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
      // Keep the glow on the initial burst, then fade it out within 850 ms.
      const glowFade = 1 - Phaser.Math.Clamp((deathAgeMs - 150) / 700, 0, 1);
      visual.glow.alpha =
        (0.6 + 0.2 * glowPulse + pulseT * 0.08) * blinkAlpha * glowFade;
      const glowSize = 54 + 10 * glowPulse + pulseT * 4;
      visual.glow.setDisplaySize(glowSize, glowSize);
      visual.glowOuter.alpha =
        (0.24 + 0.1 * glowPulse + pulseT * 0.06) * blinkAlpha * glowFade;
      visual.glowOuter.setDisplaySize(glowSize + 30, glowSize + 30);
      visual.glowCore.alpha =
        (0.35 + 0.12 * glowPulse + pulseT * 0.05) * blinkAlpha * glowFade;
      visual.glowCore.setDisplaySize(20 + 4 * glowPulse, 20 + 4 * glowPulse);
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

      if (!visual.settled) {
        const flightAge = (scene.time.now - visual.bornAt) / 1000;
        visual.sprite.rotation = flightAge * visual.spin / (1 + visual.bounces);
        if (visual.type === "coin") {
          visual.sprite.scaleX = baseScale * (0.3 + 0.7 * Math.abs(Math.cos(flightAge * 10 + visual.phase)));
        }
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

    for (const [key, at] of deathBursts) {
      if (scene.time.now - at > 15000) deathBursts.delete(key);
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

  function activeBubbleStyle(fx) {
    return activeBubbleStyles(fx)[0] || null;
  }

  function activeBubbleStyles(fx) {
    const styles = [];
    if ((fx.shield || 0) > 0) {
      styles.push({ type: "shield", color: colors.shield, strength: 1 });
    }
    if ((fx.rage || 0) > 0) {
      styles.push({ type: "rage", color: colors.rage, strength: 0.92 });
    }
    if ((fx.health || 0) > 0) {
      styles.push({ type: "health", color: colors.health, strength: 0.82 });
    }
    if ((fx.poison || 0) > 0) {
      styles.push({ type: "poison", color: colors.poison, strength: 0.78 });
    }
    return styles;
  }

  function drawBubblyAura(g, key, spr, fx, nowSec) {
    const activeStyles = activeBubbleStyles(fx);
    const activeStyle = activeStyles[0] || null;
    let state = auraBubbleStates.get(key);
    const claimIsArriving = (state?.claimedUntil || 0) > scene.time.now;
    const style =
      activeStyle ||
      (claimIsArriving && state
        ? { color: state.color, strength: state.strength || 1 }
        : null);
    if (!spr?.active || (!style && !state)) {
      auraBubbleStates.delete(key);
      return;
    }

    const frame = spriteFrameForAura(spr);
    const bodyVelocity = spr.body?.velocity || { x: 0, y: 0 };
    const vx = Number(bodyVelocity.x) || 0;
    const vy = Number(bodyVelocity.y) || 0;
    const grounded = !!(spr.body?.blocked?.down || spr.body?.touching?.down);
    const dt = Phaser.Math.Clamp(
      (Number(scene.game?.loop?.delta) || 16.67) / 1000,
      0.008,
      0.034,
    );
    if (!state) {
      state = {
        x: frame.x,
        y: frame.y,
        dx: 0,
        dy: 0,
        lastVx: vx,
        lastVy: vy,
        grounded,
        wobble: 0.9,
        scale: 0.5,
        scaleVelocity: 3.6,
        alpha: 0,
        color: style.color,
        strength: style.strength,
        styles: activeStyles,
        phase: Math.random() * Math.PI * 2,
      };
      auraBubbleStates.set(key, state);
    }

    if (activeStyle) {
      state.color = activeStyle.color;
      state.strength = activeStyle.strength;
      state.styles = activeStyles;
    }
    const isWaitingForArrival =
      (state.arrivalPendingUntil || 0) > scene.time.now;
    const isVisibleEffect = (!!activeStyle || claimIsArriving) && !isWaitingForArrival;
    const alphaTarget = isVisibleEffect ? 1 : 0;
    state.alpha +=
      (alphaTarget - state.alpha) *
      (1 - Math.pow(isVisibleEffect ? 0.00008 : 0.012, dt));
    const scaleTarget = isWaitingForArrival
      ? 0.48
      : isVisibleEffect
        ? 1
        : 1.16;
    state.scaleVelocity +=
      ((scaleTarget - state.scale) * 90 - state.scaleVelocity * 13) * dt;
    state.scale += state.scaleVelocity * dt;
    if (!isVisibleEffect && !isWaitingForArrival && state.alpha < 0.018) {
      auraBubbleStates.delete(key);
      return;
    }

    // Keep the membrane attached to the body. Movement is expressed through
    // deformation below, never through visible positional delay.
    const motionResponse = 1 - Math.pow(0.0002, dt);
    state.dx = Phaser.Math.Linear(state.dx, vx * 0.035, motionResponse);
    state.dy = Phaser.Math.Linear(state.dy, vy * 0.035, motionResponse);
    state.x = frame.x;
    state.y = frame.y;

    const deltaVx = vx - state.lastVx;
    const deltaVy = vy - state.lastVy;
    const accel = Math.hypot(deltaVx, deltaVy);
    state.wobble = Math.min(1.5, state.wobble + accel * 0.0026);
    const surfaceTargetX = Phaser.Math.Clamp(
      -vx / 430 - deltaVx / 260,
      -1,
      1,
    );
    const surfaceTargetY = Phaser.Math.Clamp(
      -vy / 560 - deltaVy / 320,
      -1,
      1,
    );
    const surfaceResponse = 1 - Math.pow(0.018, dt);
    state.surfaceX = Phaser.Math.Linear(
      state.surfaceX || 0,
      surfaceTargetX,
      surfaceResponse,
    );
    state.surfaceY = Phaser.Math.Linear(
      state.surfaceY || 0,
      surfaceTargetY,
      surfaceResponse,
    );
    if (grounded && !state.grounded && state.lastVy > 80) {
      state.wobble = Math.min(1.5, state.wobble + state.lastVy / 520);
    }
    state.wobble *= Math.pow(0.075, dt);
    state.lastVx = vx;
    state.lastVy = vy;
    state.grounded = grounded;

    const speedX = Math.min(1, Math.abs(vx) / 390);
    const speedY = Math.min(1, Math.abs(vy) / 520);
    const squash = grounded ? Math.min(0.12, Math.abs(state.dy) * 0.002) : 0;
    const radius = (frame.radius + 2) * 0.94 * state.scale;
    const rx = radius * (1 + speedX * 0.13 - speedY * 0.05 + squash);
    const ry = radius * (1 - speedX * 0.07 + speedY * 0.12 - squash * 0.65);
    const points = [];
    const pointCount = 28;
    for (let i = 0; i < pointCount; i += 1) {
      const a = (i / pointCount) * Math.PI * 2;
      const ripple =
        Math.sin(a * 3 + nowSec * 4.2 + state.phase) * 0.025 +
        Math.sin(a * 5 - nowSec * 3.1 + state.phase * 1.7) * 0.014 +
        Math.sin(a * 2 + nowSec * 7.5) * state.wobble * 0.065 +
        (Math.cos(a) * state.surfaceX + Math.sin(a) * state.surfaceY) * 0.075;
      const push = Math.cos(a) * Phaser.Math.Clamp(-state.dx * 0.004, -0.1, 0.1);
      points.push(
        new Phaser.Geom.Point(
          state.x +
            Math.cos(a) * rx * (1 + ripple + push) +
            Math.sin(a) * state.surfaceX * radius * 0.045,
          state.y +
            Math.sin(a) * ry * (1 + ripple) +
            Math.cos(a) * state.surfaceY * radius * 0.04,
        ),
      );
    }

    const bubbleStyles = state.styles?.length
      ? state.styles
      : [{ color: state.color || 0xffffff, strength: state.strength || 1 }];
    const bubbleColor = bubbleStyles[0].color;
    const bubbleStrength = bubbleStyles[0].strength;
    const lifeAlpha = Phaser.Math.Clamp(state.alpha, 0, 1);
    g.fillStyle(0x071522, 0.07 * lifeAlpha);
    g.fillPoints(points, true);
    g.fillStyle(bubbleColor, (0.2 + bubbleStrength * 0.07) * lifeAlpha);
    g.fillPoints(points, true);

    bubbleStyles.forEach((bubbleStyle, i) => {
      const inset = i * 0.075;
      const layerPoints = points.map(
        (point) =>
          new Phaser.Geom.Point(
            state.x + (point.x - state.x) * (1 - inset),
            state.y + (point.y - state.y) * (1 - inset),
          ),
      );
      g.lineStyle(
        i === 0 ? 4 : 3,
        bubbleStyle.color,
        (0.58 + bubbleStyle.strength * 0.25) * lifeAlpha,
      );
      g.strokePoints(layerPoints, true);

      const lobeAngle =
        nowSec * (0.55 + i * 0.08) + state.phase + (Math.PI * 2 * i) / bubbleStyles.length;
      const lobeDistance = radius * (bubbleStyles.length > 1 ? 0.27 : 0.19);
      const lobeX = state.x + Math.cos(lobeAngle) * lobeDistance;
      const lobeY = state.y + Math.sin(lobeAngle * 1.17) * radius * 0.2;
      g.fillStyle(bubbleStyle.color, (0.2 + i * 0.018) * lifeAlpha);
      g.fillEllipse(
        lobeX,
        lobeY,
        Math.max(8, radius * (0.55 - i * 0.035)),
        Math.max(6, radius * (0.34 - i * 0.018)),
      );
    });

    g.lineStyle(
      1.5,
      0xffffff,
      (0.58 + bubbleStrength * 0.2) * lifeAlpha,
    );
    g.strokePoints(points, true);

    const shineX = state.x - rx * 0.31 - speedX * Math.sign(vx || 1) * 3;
    const shineY = state.y - ry * 0.34;
    g.fillStyle(0xffffff, 0.46 * lifeAlpha);
    g.fillEllipse(
      shineX,
      shineY,
      Math.max(4, rx * 0.24),
      Math.max(2.5, ry * 0.1),
    );
    g.fillStyle(0xffffff, 0.16 * lifeAlpha);
    g.fillCircle(
      state.x + rx * 0.32,
      state.y + ry * 0.28,
      Math.max(2, radius * 0.065),
    );
  }

  function renderPowerupAuras(nowSec) {
    const g = scene._powerupAuraGraphics;
    if (!g) return;
    g.clear();

    const username = getUsername();
    const gameData = getGameData();
    const latestPlayerEffects = getLatestPlayerEffects() || {};
    const me = latestPlayerEffects[username] || {};
    const liveBubbleKeys = new Set([username]);

    const baseSpeedMult = (me.rage || 0) > 0 ? 1.25 : 1;
    const baseJumpMult = (me.gravityBoots || 0) > 0 ? 1.5 : 1;
    const effectSpeedMult =
      (me.stun || 0) > 0
        ? 0
        : (me.freeze || 0) > 0
          ? 0.45
          : (me.gloopHookSlow || 0) > 0
            ? 0.5
            : (me.gloopSlimeSlow || 0) > 0
              ? 0.7
              : (me.slow || 0) > 0
                ? 0.45
                : 1;
    const effectJumpMult =
      (me.stun || 0) > 0
        ? 0
        : (me.freeze || 0) > 0
          ? 0.6
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
    const localInvisible = (me.invisibility || 0) > 0;
    setLocalPowerupInvisible?.(localInvisible);

    const drawAura = (spr, fx) => {
      if (!spr || !fx) return;
      const frame = spriteFrameForAura(spr);
      const x = frame.x;
      const y = frame.y;
      const r = frame.radius;
      const pulse = 0.75 + 0.25 * Math.sin(nowSec * 8 + x * 0.01);
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
      if ((fx.gravityBoots || 0) > 0) {
        const bootY = frame.bottom - 2;
        g.fillStyle(colors.gravityBoots, 0.22 * pulse);
        g.fillEllipse(x, bootY, Math.max(28, r + 4), 10);
        g.lineStyle(2, colors.gravityBoots, 0.75 * pulse);
        g.strokeEllipse(x, bootY, Math.max(28, r + 4), 10);
      }
      if ((fx.freeze || 0) > 0) {
        const freezeColor = colors.freeze || 0x67e8f9;
        const blobPoints = [];
        for (let i = 0; i < 26; i += 1) {
          const angle = (i / 26) * Math.PI * 2;
          const ripple =
            Math.sin(angle * 3 + nowSec * 2.6) * 4.2 +
            Math.sin(angle * 7 - nowSec * 1.8) * 2.1;
          const blobRadius = r + 7 + ripple + pulse * 2;
          blobPoints.push(
            new Phaser.Geom.Point(
              x + Math.cos(angle) * blobRadius,
              y + Math.sin(angle) * blobRadius * 0.92,
            ),
          );
        }
        g.fillStyle(0x38bdf8, 0.17 + 0.05 * pulse);
        g.fillPoints(blobPoints, true);
        g.lineStyle(5, freezeColor, 0.3 + 0.12 * pulse);
        g.strokePoints(blobPoints, true);
        g.lineStyle(2, 0xdffaff, 0.75 * pulse);
        g.strokePoints(blobPoints, true);

        // Faceted crystals protrude from the frozen blob.
        for (let i = 0; i < 7; i += 1) {
          const angle = (i / 7) * Math.PI * 2 + nowSec * 0.12;
          const inner = r + 4;
          const outer = r + 15 + 3 * Math.sin(nowSec * 3 + i);
          const baseX = x + Math.cos(angle) * inner;
          const baseY = y + Math.sin(angle) * inner * 0.92;
          const tipX = x + Math.cos(angle) * outer;
          const tipY = y + Math.sin(angle) * outer * 0.92;
          const sideX = Math.cos(angle + Math.PI / 2) * 4;
          const sideY = Math.sin(angle + Math.PI / 2) * 4;
          g.fillStyle(i % 2 === 0 ? 0xe0faff : freezeColor, 0.82);
          g.fillTriangle(
            baseX + sideX,
            baseY + sideY,
            baseX - sideX,
            baseY - sideY,
            tipX,
            tipY,
          );
        }

        // Three descending arrows make the movement penalty readable at a glance.
        const arrowTop = frame.top - 25 - pulse * 4;
        for (let i = 0; i < 3; i += 1) {
          const ax = x + (i - 1) * 15;
          const ay = arrowTop + Math.sin(nowSec * 5 + i * 0.85) * 3;
          g.fillStyle(freezeColor, 0.9);
          g.fillRect(ax - 2, ay - 9, 4, 10);
          g.fillTriangle(ax - 6, ay, ax + 6, ay, ax, ay + 10);
          g.lineStyle(1, 0xffffff, 0.7);
          g.strokeTriangle(ax - 6, ay, ax + 6, ay, ax, ay + 10);
        }
      }
    };

    const localPlayer = getLocalPlayer();
    if (localPlayer) localPlayer._powerupEffects = me;
    for (const wrapper of [
      ...Object.values(getOpponentPlayers() || {}),
      ...Object.values(getTeamPlayers() || {}),
    ]) {
      if (wrapper?.opponent) {
        wrapper.opponent._powerupEffects = latestPlayerEffects[wrapper.username] || {};
      }
    }
    if (!localInvisible) {
      drawBubblyAura(g, username, localPlayer, latestPlayerEffects[username] || {}, nowSec);
      drawAura(localPlayer, latestPlayerEffects[username] || {});
      drawCharacterPowerupAura(gameData?.yourCharacter, {
        graphics: g,
        frame: spriteFrameForAura(localPlayer),
        effects: latestPlayerEffects[username] || {},
        nowSec,
        colors,
      });
    }
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
      liveBubbleKeys.add(name);
      const invisible = (fx?.invisibility || 0) > 0;
      wrapper.setPowerupInvisible?.(invisible);
      if (!invisible) {
        drawBubblyAura(g, name, wrapper.opponent, fx, nowSec);
        drawAura(wrapper.opponent, fx);
        drawCharacterPowerupAura(wrapper.character, {
          graphics: g,
          frame: spriteFrameForAura(wrapper.opponent),
          effects: fx,
          nowSec,
          colors,
        });
      }
      applyPowerupCharacterFX(wrapper.opponent, fx, nowSec, wrapper.character);
    }
    for (const key of auraBubbleStates.keys()) {
      if (!liveBubbleKeys.has(key)) auraBubbleStates.delete(key);
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

    const drawSpawnVortex = (visual, pu, intensity = 1) => {
      if (!fxG || intensity <= 0) return;
      const c = colors[pu.type] || 0xffffff;
      const cx = pu.x;
      const cy = pu.y + 17;
      const open = Phaser.Math.Clamp(intensity, 0, 1);
      const apertureW = 18 + open * 34;
      const apertureH = 3 + open * 8;

      fxG.fillStyle(c, 0.1 + open * 0.13);
      fxG.fillEllipse(cx, cy, apertureW + 18, apertureH + 9);
      fxG.fillStyle(0x07111d, 0.26 + open * 0.22);
      fxG.fillEllipse(cx, cy, apertureW, apertureH);
      fxG.fillStyle(c, 0.3 + open * 0.28);
      fxG.fillEllipse(cx, cy + 1, apertureW * 0.64, Math.max(2, apertureH * 0.42));

      for (let streak = 0; streak < 3; streak += 1) {
        const fall =
          (nowSec * (0.72 + streak * 0.08) +
            visual.phase * 0.35 +
            streak * 0.31) %
          1;
        const streakX =
          cx + (streak - 1) * 17 + Math.sin(nowSec * 1.3 + streak) * 2;
        const streakY = cy - 54 + fall * 55;
        const streakAlpha = Math.sin(fall * Math.PI) * open * 0.62;
        fxG.lineStyle(2.5, c, streakAlpha);
        fxG.lineBetween(
          streakX,
          streakY,
          streakX,
          Math.min(cy - 2, streakY + 11 + fall * 7),
        );
      }

      for (let arm = 0; arm < 4; arm += 1) {
        const armColor = arm % 2 === 0 ? c : 0xffffff;
        const armAlpha = (0.18 + open * 0.42) * (arm % 2 === 0 ? 1 : 0.72);
        fxG.lineStyle(arm === 0 ? 3 : 2, armColor, armAlpha);
        let previous = null;
        for (let step = 0; step <= 8; step += 1) {
          const t = step / 8;
          const radius = (30 - t * 24) * open;
          const a =
            visual.phase +
            arm * (Math.PI / 2) +
            nowSec * (0.72 + arm * 0.04) +
            t * 2.4;
          const point = {
            x: cx + Math.cos(a) * radius,
            y: cy + Math.sin(a) * radius * 0.27 - t * 2,
          };
          if (previous) {
            fxG.lineBetween(previous.x, previous.y, point.x, point.y);
          }
          previous = point;
        }
      }
    };

    for (const pu of getLatestPowerups() || []) {
      if (!pu || typeof pu.id === "undefined") continue;
      const id = String(pu.id);
      seenIds.add(id);
      let visual = scene._powerupVisuals[id];
      if (!visual) {
        const glowColor = colors[pu.type] || 0xffffff;
        const glow = scene.add.ellipse(pu.x, pu.y, 40, 34, glowColor, 0.36);
        glow.setDepth(RENDER_LAYERS.POWERUPS);
        glow.setBlendMode(Phaser.BlendModes.ADD);
        const glowOuter = scene.add.ellipse(
          pu.x,
          pu.y,
          50,
          38,
          glowColor,
          0.2,
        );
        glowOuter.setDepth(RENDER_LAYERS.POWERUPS - 1);
        glowOuter.setBlendMode(Phaser.BlendModes.ADD);
        const glowCore = scene.add.ellipse(
          pu.x - 7,
          pu.y - 8,
          15,
          7,
          0xffffff,
          0.34,
        );
        glowCore.setDepth(RENDER_LAYERS.POWERUPS);
        glowCore.setBlendMode(Phaser.BlendModes.ADD);
        const omenBase = scene.add.ellipse(
          pu.x,
          pu.y + 18,
          42,
          8,
          glowColor,
          0.5,
        );
        omenBase.setDepth(RENDER_LAYERS.POWERUPS - 1);
        omenBase.setBlendMode(Phaser.BlendModes.ADD);
        const omenRing = scene.add.ellipse(pu.x - 8, pu.y + 14, 17, 6, 0xffffff, 0.32);
        omenRing.setDepth(RENDER_LAYERS.POWERUPS);
        omenRing.setBlendMode(Phaser.BlendModes.ADD);
        const omenEcho = scene.add.ellipse(pu.x + 10, pu.y + 17, 22, 5, glowColor, 0.18);
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
          visual.activatedAt = activationAge <= 260 ? nowMs : 0;
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
            visual.container.setScale(0.62);
            visual.glow.setScale(0.75, 0.22);
            visual.glowOuter.setScale(0.82, 0.16);
            visual.glowCore.setScale(0.55, 0.28);
            scene.tweens.add({
              targets: [
                visual.omenBase,
                visual.omenRing,
                visual.omenEcho,
              ].filter(Boolean),
              alpha: 0,
              scaleX: 1.12,
              scaleY: 0.12,
              duration: 280,
              ease: "Cubic.easeIn",
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
              duration: 430,
              ease: "Back.easeOut",
            });
          }
        }

        if (!isActive) {
          const omenProgress = Phaser.Math.Clamp(
            1 - (visual.activeAt - nowMs) / 2000,
            0,
            1,
          );
          const omenPulse = 0.5 + 0.5 * Math.sin(nowSec * 2.4 + visual.phase);
          const omenX = pu.x;
          const omenY = pu.y + 18;
          visual.container.setAlpha(0);
          visual.glow.setAlpha(0);
          visual.glowOuter.setAlpha(0);
          visual.glowCore.setAlpha(0);
          visual.omenBase?.setPosition(omenX, omenY);
          visual.omenRing?.setPosition(omenX, omenY);
          visual.omenEcho?.setPosition(omenX, omenY);
          if (visual.omenBase) {
            visual.omenBase.alpha =
              0.1 + omenProgress * 0.3 + 0.1 * omenPulse;
            visual.omenBase.setDisplaySize(
              24 + omenProgress * 22 + omenPulse * 4,
              5 + omenProgress * 7 + omenPulse * 2,
            );
            visual.omenBase.y = omenY - omenProgress * 7;
          }
          if (visual.omenRing) {
            visual.omenRing.alpha =
              0.08 + omenProgress * 0.24 + 0.1 * omenPulse;
            visual.omenRing.setDisplaySize(
              12 + omenProgress * 9,
              4 + omenProgress * 18,
            );
            visual.omenRing.x = omenX - 8 + Math.sin(nowSec * 3.2) * 3;
            visual.omenRing.y = omenY - omenProgress * 15;
          }
          if (visual.omenEcho) {
            visual.omenEcho.alpha =
              0.06 + omenProgress * 0.18 + 0.08 * (1 - omenPulse);
            visual.omenEcho.setDisplaySize(
              15 + omenProgress * 8,
              3 + omenProgress * 13,
            );
            visual.omenEcho.x = omenX + 9 - Math.sin(nowSec * 2.7) * 3;
            visual.omenEcho.y = omenY - omenProgress * 11;
          }
          drawSpawnVortex(visual, pu, 0.18 + omenProgress * 0.82);
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
        visual.glow.alpha = 0.48 + 0.22 * glowPulse;
        const membraneBreath = Math.sin(nowSec * 2.7 + visual.phase);
        visual.glow.setDisplaySize(36 + membraneBreath * 4, 29 - membraneBreath * 2);
        visual.glowOuter.alpha = 0.24 + 0.18 * glowPulse;
        visual.glowOuter.setDisplaySize(49 + membraneBreath * 5, 38 - membraneBreath * 2);
        visual.glowCore.alpha =
          0.28 + 0.16 * Math.abs(Math.sin(nowSec * 5.2 + visual.phase));
        visual.glowCore.setDisplaySize(13 + 3 * glowPulse, 6 + glowPulse);
        if (visual.sprite) {
          const baseS = visual.sprite.scaleY || 1;
          visual.sprite.scaleX =
            baseS * (0.9 + 0.1 * Math.sin(nowSec * 4.1 + visual.phase));
          visual.sprite.scaleY = baseS;
          visual.sprite.rotation = 0.05 * Math.sin(nowSec * 2.1 + visual.phase);
        }

        if (fxG) {
          const c = colors[pu.type] || 0xffffff;
          const spawnAge = nowMs - (visual.activatedAt || 0);
          if (spawnAge >= 0 && spawnAge < 520) {
            drawSpawnVortex(visual, pu, 1 - spawnAge / 520);
          }
          const cx = visual.container.x;
          const cy = visual.container.y + 3;
          const membrane = [];
          const pointCount = 22;
          for (let i = 0; i < pointCount; i += 1) {
            const a = (i / pointCount) * Math.PI * 2;
            const ripple =
              Math.sin(a * 3 + nowSec * 3.4 + visual.phase) * 1.25 +
              Math.sin(a * 5 - nowSec * 2.2 + visual.phase) * 0.65;
            membrane.push(
              new Phaser.Geom.Point(
                cx + Math.cos(a) * (25 + ripple),
                cy + Math.sin(a) * (22 + ripple * 0.72),
              ),
            );
          }
          fxG.fillStyle(0x071522, 0.08);
          fxG.fillPoints(membrane, true);
          fxG.fillStyle(c, 0.31);
          fxG.fillPoints(membrane, true);
          fxG.lineStyle(5, c, 0.26);
          fxG.strokePoints(membrane, true);
          fxG.lineStyle(3, c, 0.88);
          fxG.strokePoints(membrane, true);
          fxG.lineStyle(1.5, 0xffffff, 0.8);
          fxG.strokePoints(membrane, true);

          const fluidShift = Math.sin(nowSec * 1.8 + visual.phase);
          fxG.fillStyle(c, 0.3);
          fxG.fillEllipse(cx + fluidShift * 7, cy + 8, 31, 13);
          fxG.fillStyle(0xffffff, 0.58);
          fxG.fillEllipse(cx - 8 + fluidShift * 2, cy - 10, 10, 4);
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
