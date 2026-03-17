// powerups/powerupRenderer.js

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
  getLatestPlayerEffects,
  powerupCollectQueue,
  shieldImpactQueue,
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

  function spawnTrailParticle(x, y, color, r = 5, life = 260) {
    const c = scene.add.circle(x, y, r, color, 0.75);
    c.setDepth(19);
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
    g.setDepth(19);
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
    g.setDepth(19);
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
    const custom = applyCharacterPowerupFx(characterKey, {
      scene,
      sprite: spr,
      effects: fx,
      nowSec,
      colors,
      spawnTrailParticle,
    });
    const rageLikeOn = rageOn || !!custom?.rageLike;

    if (rageLikeOn && !spr._rageLiftApplied) {
      spr.y -= 6;
      if (spr.body && typeof spr.body.updateFromGameObject === "function") {
        spr.body.updateFromGameObject();
      }
      spr._rageLiftApplied = true;
    } else if (!rageLikeOn && spr._rageLiftApplied) {
      spr._rageLiftApplied = false;
    }

    if (custom?.handled) return;

    if (rageOn) {
      const pulse = Math.sin(nowSec * 8 + (spr.x || 0) * 0.01);
      spr.setTint(pulse > 0 ? 0xc084fc : 0x9333ea);
      spr.setScale(baseX * 1.22, baseY * 1.22);
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
          targets: [visual.container, visual.glow],
          alpha: 0,
          scaleX: 0.2,
          scaleY: 0.2,
          angle: 180,
          duration: 220,
          ease: "Back.easeIn",
          onComplete: () => {
            try {
              visual.glow.destroy();
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
        puff.setDepth(6);
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
    const charMobility = getCharacterPowerupMobilityModifier(
      gameData?.yourCharacter,
      me,
    );
    const speedMult = baseSpeedMult * (charMobility?.speedMult || 1);
    const jumpMult = baseJumpMult * (charMobility?.jumpMult || 1);
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
      if ((fx.poison || 0) > 0) {
        g.fillStyle(colors.poison, 0.1 * pulse);
        g.fillCircle(x, y, Math.max(16, r - 2 + 3 * pulse));
        g.lineStyle(3, colors.poison, 0.75 * pulse);
        g.strokeCircle(x, y, Math.max(16, r - 2 + 3 * pulse));
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
        ring.setDepth(22);
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
        const glow = scene.add.circle(
          pu.x,
          pu.y,
          16,
          colors[pu.type] || 0xffffff,
          0.28,
        );
        glow.setDepth(4);
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
        container.setDepth(5);
        visual = {
          id,
          type: pu.type,
          x: pu.x,
          y: pu.y,
          expiresAt: Number(pu.expiresAt) || 0,
          glow,
          sprite: spr,
          container,
          phase: Math.random() * Math.PI * 2,
          despawning: false,
        };
        visual.container.setAlpha(0);
        visual.glow.setAlpha(0);
        visual.container.setScale(0.55);
        visual.glow.setScale(0.45);
        scene.tweens.add({
          targets: [visual.container, visual.glow],
          alpha: 1,
          scaleX: 1,
          scaleY: 1,
          duration: 480,
          ease: "Back.easeOut",
        });
        scene._powerupVisuals[id] = visual;
      }

      if (!visual.despawning) {
        visual.expiresAt = Number(pu.expiresAt) || visual.expiresAt || 0;
        visual.x = pu.x;
        visual.y = pu.y;
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
        visual.container.x = pu.x + shakeX;
        visual.container.y = pu.y - 6 + bob + shakeY;
        visual.glow.x = pu.x + shakeX;
        visual.glow.y = pu.y - 6 + bob + shakeY + 1;
        visual.glow.alpha =
          0.18 + 0.18 * Math.abs(Math.sin(nowSec * 3.5 + visual.phase));
        visual.glow.radius =
          16 + 4 * Math.abs(Math.sin(nowSec * 2.7 + visual.phase));
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
        targets: [visual.container, visual.glow],
        alpha: 0,
        scaleX: 0.35,
        scaleY: 0.35,
        duration: 180,
        ease: "Quad.easeIn",
        onComplete: () => {
          try {
            visual.glow.destroy();
            visual.container.destroy();
          } catch (_) {}
          delete scene._powerupVisuals[id];
        },
      });
    }

    renderPowerupAuras(nowSec);
  }

  return {
    renderPowerupsAndEffects,
  };
}
