import { POWERUP_OMEN_MS } from "../../../shared/combat/matchConfig.js";
import { addPixelCircle, addPixelEllipse, fillPixelBlob, fillPixelEllipse, rasterizePixelBlob } from "../scene/fx/pixelShapes";
import { POWERUP_CATALOG } from "../../../shared/powerups";
import { RENDER_LAYERS } from "../scene/renderLayers";
import { pickupVisualParts, destroyVisualParts } from "./pickupVisualParts";
export function createPickupRenderer({ scene, Phaser, colors, playerLookup, getLatestPowerups, getLocalPlayer, powerupCollectQueue, fxG, prepareClaim, primeClaimedBubble, spriteFrameForAura }) {
  const visuals = Object.create(null);

  function powerupTextureFor(type) {
    const webpKey = `pu-icon-${type}-webp`;
    const pngKey = `pu-icon-${type}-png`;
    if (scene.textures.exists(webpKey)) return webpKey;
    if (scene.textures.exists(pngKey)) return pngKey;
    return null;
  }

  function powerupLabelFor(type) {
    return POWERUP_CATALOG[type]?.visual?.label || String(type || "?")
      .charAt(0)
      .toUpperCase();
  }

  function cleanupPowerupVisual(id, visual) {
    destroyVisualParts(pickupVisualParts(visual));
    delete visuals[id];
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
    const collector = playerLookup.sprite(evt?.username);
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

      const flash = addPixelCircle(scene, frame.x, frame.y, 38, 0xfff7d6, 0.9);
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
        const spark = addPixelCircle(
          scene,
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
    const shouldForm = prepareClaim(evt, collector, color);
    const stream = [
      addPixelEllipse(scene, sx, sy, 25, 12, color, 0.68),
      addPixelEllipse(scene, sx, sy, 19, 8, 0xffffff, 0.42),
      addPixelEllipse(scene, sx, sy, 13, 6, color, 0.28),
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

  function consumeCollectedPowerupQueue() {
    while (powerupCollectQueue.length > 0) {
      const evt = powerupCollectQueue.shift();
      if (!evt) continue;
      const collector = playerLookup.sprite(evt.username);
      if (collector) {
        collector._recentPowerupEffects ||= Object.create(null);
        // Instant pickups (notably shockwave) still get a readable HUD beat.
        collector._recentPowerupEffects[evt.type] = Date.now() + 900;
      }
      const id = String(evt.id);
      const visual = visuals[id];
      try {
        scene.sound.play(`pu-touch-${evt.type}`, {
          volume: POWERUP_CATALOG[evt.type]?.touchVolume ?? 0.45,
        });
      } catch (_) {}
      const hasClaimFx = spawnPowerupClaimFx(evt, visual);
      if (visual && !visual.despawning) {
        visual.despawning = true;
        scene.tweens.add({
          targets: pickupVisualParts(visual),
          alpha: 0,
          scaleX: 0.45,
          scaleY: 0.12,
          angle: 70,
          duration: 170,
          ease: "Cubic.easeIn",
          onComplete: () => cleanupPowerupVisual(id, visual),
        });
      } else if (
        !hasClaimFx &&
        typeof evt.x === "number" &&
        typeof evt.y === "number"
      ) {
        const puff = addPixelCircle(
          scene,
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

  function render(nowSec) {
    const seenIds = new Set();

    const drawSpawnVortex = (visual, pu, intensity = 1) => {
      if (!fxG || intensity <= 0) return;
      const c = colors[pu.type] || 0xffffff;
      const cx = pu.x;
      const cy = pu.y + 17;
      const open = Phaser.Math.Clamp(intensity, 0, 1);
      const apertureW = 18 + open * 34;
      const apertureH = 3 + open * 8;

      fillPixelEllipse(fxG, cx, cy, apertureW + 18, apertureH + 9, c, 0.1 + open * 0.13);
      fillPixelEllipse(fxG, cx, cy, apertureW, apertureH, 0x07111d, 0.26 + open * 0.22);
      fillPixelEllipse(
        fxG,
        cx,
        cy + 1,
        apertureW * 0.64,
        Math.max(2, apertureH * 0.42),
        c,
        0.3 + open * 0.28,
      );

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
      let visual = visuals[id];
      if (!visual) {
        const glowColor = colors[pu.type] || 0xffffff;
        const glow = addPixelEllipse(scene, pu.x, pu.y, 40, 34, glowColor, 0.36);
        glow.setDepth(RENDER_LAYERS.POWERUPS);
        glow.setBlendMode(Phaser.BlendModes.ADD);
        const glowOuter = addPixelEllipse(
          scene,
          pu.x,
          pu.y,
          50,
          38,
          glowColor,
          0.2,
        );
        glowOuter.setDepth(RENDER_LAYERS.POWERUPS - 1);
        glowOuter.setBlendMode(Phaser.BlendModes.ADD);
        const glowCore = addPixelEllipse(
          scene,
          pu.x - 7,
          pu.y - 8,
          15,
          7,
          0xffffff,
          0.34,
        );
        glowCore.setDepth(RENDER_LAYERS.POWERUPS);
        glowCore.setBlendMode(Phaser.BlendModes.ADD);
        const omenBase = addPixelEllipse(
          scene,
          pu.x,
          pu.y + 18,
          42,
          8,
          glowColor,
          0.5,
        );
        omenBase.setDepth(RENDER_LAYERS.POWERUPS - 1);
        omenBase.setBlendMode(Phaser.BlendModes.ADD);
        const omenRing = addPixelEllipse(scene, pu.x - 8, pu.y + 14, 17, 6, 0xffffff, 0.32);
        omenRing.setDepth(RENDER_LAYERS.POWERUPS);
        omenRing.setBlendMode(Phaser.BlendModes.ADD);
        const omenEcho = addPixelEllipse(scene, pu.x + 10, pu.y + 17, 22, 5, glowColor, 0.18);
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
        visuals[id] = visual;
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
              targets: pickupVisualParts(visual, { includeOmen: false }),
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
            1 - (visual.activeAt - nowMs) / POWERUP_OMEN_MS,
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
            membrane.push({
              x: cx + Math.cos(a) * (25 + ripple),
              y: cy + Math.sin(a) * (22 + ripple * 0.72),
            });
          }
          const blob = rasterizePixelBlob(membrane, { ringCount: 4 });
          fillPixelBlob(fxG, blob, 0x071522, 0.08);
          fillPixelBlob(fxG, blob, c, 0.31);
          const fluidShift = Math.sin(nowSec * 1.8 + visual.phase);
          const fluidX = cx + fluidShift * 7;
          const fluidY = cy + 8;
          fillPixelBlob(fxG, blob, c, 0.3, (d, px, py) =>
            d > 4 && ((px - fluidX) / 15.5) ** 2 + ((py - fluidY) / 6.5) ** 2 <= 1,
          );
          fillPixelBlob(fxG, blob, c, 0.35, (d) => d === 4);
          fillPixelBlob(fxG, blob, c, 0.9, (d) => d <= 3);
          // Light the upper-left of the rim and shade the lower-right.
          fillPixelBlob(fxG, blob, 0xffffff, 0.8, (d, px, py) =>
            d === 1 && cx - px + (cy - py) > 7,
          );
          fillPixelBlob(fxG, blob, 0x071522, 0.25, (d, px, py) =>
            d === 1 && px - cx + (py - cy) > 12,
          );
          fillPixelEllipse(fxG, cx - 8 + fluidShift * 2, cy - 10, 10, 4, 0xffffff, 0.58);
        }
      }
    }

    for (const [id, visual] of Object.entries(visuals)) {
      if (seenIds.has(id) || visual.despawning) continue;
      visual.despawning = true;
      scene.tweens.add({
        targets: pickupVisualParts(visual),
        alpha: 0,
        scaleX: 0.35,
        scaleY: 0.35,
        duration: 180,
        ease: "Quad.easeIn",
        onComplete: () => cleanupPowerupVisual(id, visual),
      });
    }

  }
  function destroy() {
    for (const [id, visual] of Object.entries(visuals)) cleanupPowerupVisual(id, visual);
  }

  return { render, consumeCollectedPowerupQueue, destroy };
}
