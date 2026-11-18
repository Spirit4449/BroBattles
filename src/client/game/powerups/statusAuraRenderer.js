import { activeBubbleStyles, applyPrimaryStatus, drawStatusAuras } from "./powerupVisuals";
import { drawShieldBubble } from "../scene/fx/shieldBubble";
import { bodyBounds, playerAnchor } from "../characters/shared/rig";
import { addPixelCircle, fillPixelBlob, PIXEL_FX_SIZE, pixelBlobDepthAt, rasterizePixelBlob } from "../scene/fx/pixelShapes";
import { RENDER_LAYERS } from "../scene/renderLayers";
function newBubbleState(frame, sprite, overrides = {}) {
  return {
    x: frame.x,
    y: frame.y,
    dx: 0,
    dy: 0,
    lastVx: Number(sprite.body?.velocity?.x) || 0,
    lastVy: Number(sprite.body?.velocity?.y) || 0,
    grounded: false,
    phase: Math.random() * Math.PI * 2,
    ...overrides,
  };
}

export function createStatusAuraRenderer({ scene, Phaser, colors, getLatestPlayerEffects, getGameData, getLocalPlayer, getUsername, playerLookup, shieldImpactQueue, applyCharacterPowerupFx, drawCharacterPowerupAura, auraGraphics, fxG }) {
  const auraBubbleStates = new Map();
  const spawnShieldReflections = new WeakMap();
  function spawnTrailParticle(x, y, color, r = 5, life = 260) {
    const c = addPixelCircle(scene, x, y, r, color, 0.75);
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

  function primeClaimedBubble(username, spr, color, shouldForm = true) {
    if (!username || !spr?.active) return;
    const frame = spriteFrameForAura(spr);
    const state = auraBubbleStates.get(username) || newBubbleState(frame, spr);
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

  function prepareClaim(evt, collector, color) {
    const existingFx = (getLatestPlayerEffects() || {})[evt?.username] || {};
    const shouldForm = !activeBubbleStyles(existingFx).length;
    if (shouldForm) {
      const frame = spriteFrameForAura(collector);
      auraBubbleStates.set(evt.username, newBubbleState(frame, collector, {
        color,
        strength: 1,
        styles: [{ type: evt?.type || "claim", color, strength: 1 }],
        alpha: 0,
        scale: 0.48,
        scaleVelocity: 0,
        wobble: 0.2,
        arrivalPendingUntil: scene.time.now + 270,
        claimedUntil: scene.time.now + 620,
      }));
    }

    return shouldForm;
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
    const baseX = spr._puBaseScaleX || 1;
    const baseY = spr._puBaseScaleY || 1;
    const rageOn = (fx?.rage || 0) > 0;
    const invisibleOn = (fx?.invisibility || 0) > 0;
    if (invisibleOn) {
      spr.clearTint();
      spr.setScale(baseX, baseY);
      const vx = Number(spr.body?.velocity?.x) || 0;
      const vy = Number(spr.body?.velocity?.y) || 0;
      if ((Math.abs(vx) > 10 || Math.abs(vy) > 18) && Math.random() < 0.12) {
        const mote = addPixelCircle(
          scene,
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

    spr.setScale(baseX, baseY);
    applyPrimaryStatus(fx, {
      sprite: spr, colors, nowSec, Phaser, spawnTrailParticle, spawnPlusParticle, spawnArrowParticle,
    });
  }

  // Auras and bubbles centre on the drawn body (rig `core`, else the hitbox
  // centre) and keep the hitbox's height, so a short body such as Gloop's
  // blob is wrapped rather than floating under its effect.
  function spriteFrameForAura(spr) {
    if (!spr) return { x: 0, y: 0, top: 0, bottom: 0, radius: 24 };
    const bounds = bodyBounds(spr);
    if (bounds) {
      const core = playerAnchor(spr, "core");
      const w = Math.max(14, Number(bounds.width) || 14);
      const h = Math.max(20, Number(bounds.height) || 20);
      return {
        x: core.x,
        y: core.y,
        top: core.y - h / 2,
        bottom: core.y + h / 2,
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
      state = newBubbleState(frame, spr, {
        grounded,
        wobble: 0.9,
        scale: 0.5,
        scaleVelocity: 3.6,
        alpha: 0,
        color: style.color,
        strength: style.strength,
        styles: activeStyles,
      });
      auraBubbleStates.set(key, state);
    }

    if (activeStyle) {
      state.color = activeStyle.color;
      state.strength = activeStyle.strength;
      // Keep powerups in pickup order so newer ones draw as outer rings.
      const activeTypes = activeStyles.map((s) => s.type);
      state.order = (state.order || []).filter((type) => activeTypes.includes(type));
      for (const type of activeTypes) {
        if (!state.order.includes(type)) state.order.push(type);
      }
      state.styles = state.order.map((type) => activeStyles.find((s) => s.type === type));
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
      points.push({
        x:
          state.x +
          Math.cos(a) * rx * (1 + ripple + push) +
          Math.sin(a) * state.surfaceX * radius * 0.045,
        y:
          state.y +
          Math.sin(a) * ry * (1 + ripple) +
          Math.cos(a) * state.surfaceY * radius * 0.04,
      });
    }

    const bubbleStyles = state.styles?.length
      ? state.styles
      : [{ color: state.color || 0xffffff, strength: state.strength || 1 }];
    const bubbleColor = bubbleStyles[0].color;
    const bubbleStrength = bubbleStyles[0].strength;
    const lifeAlpha = Phaser.Math.Clamp(state.alpha, 0, 1);

    // Rasterize one membrane per active powerup so it reads as pixel art.
    // The oldest powerup is the core; each newer one wraps it a step wider.
    const layerStep = PIXEL_FX_SIZE * 5;
    const layers = bubbleStyles.map((bubbleStyle, i) => {
      const scale = 1 + (i * layerStep) / radius;
      const layerPoints = points.map((p) => ({
        x: state.x + (p.x - state.x) * scale,
        y: state.y + (p.y - state.y) * scale,
      }));
      return {
        style: bubbleStyle,
        radius: radius * scale,
        blob: rasterizePixelBlob(layerPoints, { ringCount: 4 }),
      };
    });
    const core = layers[0].blob;
    const { cell, originX, originY } = core;
    fillPixelBlob(g, core, 0x071522, 0.07 * lifeAlpha);
    fillPixelBlob(g, core, bubbleColor, (0.2 + bubbleStrength * 0.07) * lifeAlpha);

    bubbleStyles.forEach((bubbleStyle, i) => {
      const lobeAngle =
        nowSec * (0.55 + i * 0.08) + state.phase + (Math.PI * 2 * i) / bubbleStyles.length;
      const lobeDistance = radius * (bubbleStyles.length > 1 ? 0.27 : 0.19);
      const lobeX = state.x + Math.cos(lobeAngle) * lobeDistance;
      const lobeY = state.y + Math.sin(lobeAngle * 1.17) * radius * 0.2;
      const halfW = Math.max(4, radius * (0.275 - i * 0.0175));
      const halfH = Math.max(3, radius * (0.17 - i * 0.009));
      fillPixelBlob(g, core, bubbleStyle.color, (0.2 + i * 0.018) * lifeAlpha, (d, cx, cy) =>
        d > 4 && ((cx - lobeX) / halfW) ** 2 + ((cy - lobeY) / halfH) ** 2 <= 1,
      );
    });

    layers.forEach((layer, i) => {
      const { blob, style } = layer;
      if (i > 0) {
        // Tint only the band between this ring and the one inside it.
        const inner = layers[i - 1].blob;
        fillPixelBlob(g, blob, style.color, 0.14 * lifeAlpha, (d, cx, cy) =>
          d > 0 && pixelBlobDepthAt(inner, cx, cy) === 0,
        );
      }
      fillPixelBlob(g, blob, style.color, (0.62 + style.strength * 0.25) * lifeAlpha, (d) => d <= 3);
      fillPixelBlob(g, blob, style.color, 0.32 * lifeAlpha, (d) => d === 4);
      // Light the upper-left of each outline and shade the lower-right.
      const lightReach = layer.radius * 0.3;
      fillPixelBlob(g, blob, 0xffffff, (0.5 + style.strength * 0.2) * lifeAlpha, (d, cx, cy) =>
        d === 1 && state.x - cx + (state.y - cy) > lightReach,
      );
      fillPixelBlob(g, blob, 0x071522, 0.22 * lifeAlpha, (d, cx, cy) =>
        d === 1 && cx - state.x + (cy - state.y) > lightReach * 1.6,
      );
    });

    const snap = (value, origin) => origin + Math.round((value - origin) / cell) * cell;
    const shineX = snap(state.x - rx * 0.42 - speedX * Math.sign(vx || 1) * 3, originX);
    const shineY = snap(state.y - ry * 0.4, originY);
    const shineCells = Math.max(2, Math.round((rx * 0.24) / cell));
    g.fillStyle(0xffffff, 0.6 * lifeAlpha);
    g.fillRect(shineX + cell, shineY, shineCells * cell, cell);
    g.fillRect(shineX, shineY + cell, cell, cell * 2);
    g.fillStyle(0xffffff, 0.3 * lifeAlpha);
    g.fillRect(snap(state.x + rx * 0.32, originX), snap(state.y + ry * 0.28, originY), cell, cell);
  }

  function renderPowerupAuras(nowSec) {
    const g = auraGraphics;
    if (!g) return;
    g.clear();

    const username = getUsername();
    const gameData = getGameData();
    const latestPlayerEffects = getLatestPlayerEffects() || {};
    const me = latestPlayerEffects[username] || {};
    const localInvisible = (me.invisibility || 0) > 0;
    const liveBubbleKeys = new Set([username]);

    const drawAura = (spr, fx) => {
      if (!spr || !fx) return;
      const frame = spriteFrameForAura(spr);
      const x = frame.x;
      const y = frame.y;
      const r = frame.radius;
      const pulse = 0.75 + 0.25 * Math.sin(nowSec * 8 + x * 0.01);
      if ((fx.respawnShield || 0) > 0) {
        drawShieldBubble(g, spr, frame, nowSec, fx.respawnShield, spawnShieldReflections);
      } else {
        spawnShieldReflections.delete(spr);
      }
      drawStatusAuras({ graphics: g, effects: fx, frame, x, y, r, pulse, nowSec, colors, Phaser });
    };

    const localPlayer = getLocalPlayer();
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
      const wrapper = playerLookup.wrapper(name);
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

    while (shieldImpactQueue.length > 0) {
      const impact = shieldImpactQueue.shift();
      const spr = playerLookup.sprite(impact?.username);
      if (!spr || !fxG) continue;
      const frame = spriteFrameForAura(spr);
      const x = frame.x;
      const y = frame.y;
      for (let i = 0; i < 3; i++) {
        const ring = addPixelCircle(
          scene,
          x,
          y,
          24 + i * 4,
          colors.shield,
          0.22 - i * 0.05,
        );
        const rim = addPixelCircle(scene, x, y, 24 + i * 4, 0xffedd5, 0.85, {
          ring: 1,
        });
        ring.setDepth(RENDER_LAYERS.PLAYER_HUD + 1);
        rim.setDepth(RENDER_LAYERS.PLAYER_HUD + 1);
        scene.tweens.add({
          targets: [ring, rim],
          alpha: 0,
          scaleX: 1.45 + i * 0.08,
          scaleY: 1.45 + i * 0.08,
          duration: 220 + i * 40,
          ease: "Cubic.easeOut",
          onComplete: () => {
            ring.destroy();
            rim.destroy();
          },
        });
      }
    }
  }

  return { renderPowerupAuras, prepareClaim, primeClaimedBubble, spriteFrameForAura };
}
