import { DEATH_DROP_BLINK_MS } from "../../../shared/combat/matchConfig.js";
import { RENDER_LAYERS } from "../scene/renderLayers";
import { createDeathLootEffects, handleDeathLootContact } from "./deathLootEffects";
import { coinSpinFrame } from "../scene/coinSprite.mjs";
import { pickupVisualParts, destroyVisualParts } from "./pickupVisualParts";
import { createDeathDropPickupClient } from "./deathDropPickupClient";
export function createDeathDropRenderer({ scene, Phaser, getLatestDeathDrops, deathdropCollectQueue, socket, getMapObjects, getDead, getLocalPlayer }) {
  const deathLootFx = createDeathLootEffects(scene, Phaser);
  const deathBursts = new Map();
  const visuals = Object.create(null);
  const pickupClient = createDeathDropPickupClient({ socket, getDead, getLocalPlayer });

  function deathDropTextureFor(type) {
    return type === "gem" ? "deathdrop-gem" : "coin-spin";
  }

  function deathDropColorFor(type) {
    return type === "gem" ? 0x67e8f9 : 0xfacc15;
  }

  function cleanupDeathDropVisual(id, visual) {
    destroyVisualParts(visual.colliders || []);
    destroyVisualParts(pickupVisualParts(visual));
    delete visuals[id];
    pickupClient.forget(id);
  }

  function consumeCollectedDeathDropQueue() {
    while (deathdropCollectQueue.length > 0) {
      const evt = deathdropCollectQueue.shift();
      if (!evt) continue;
      const id = String(evt.id);
      pickupClient.forget(id);
      try {
        const gem = evt.type === "gem";
        scene.sound.play(gem ? "sfx-gem-pickup" : "sfx-coin-pickup", { volume: gem ? 0.24 : 0.13 });
      } catch (_) {}
      const visual = visuals[id];
      if (visual && !visual.despawning) {
        visual.despawning = true;
        deathLootFx.pickup(visual.sprite.x, visual.sprite.y, deathDropColorFor(evt.type));
        try {
          visual.sprite.body.enable = false;
        } catch (_) {}
        scene.tweens.add({
          targets: pickupVisualParts(visual),
          alpha: 0,
          y: "-=14",
          duration: 170,
          ease: "Quad.easeOut",
          onComplete: () => cleanupDeathDropVisual(id, visual),
        });
      } else if (typeof evt.x === "number" && typeof evt.y === "number") {
        deathLootFx.pickup(evt.x, evt.y, deathDropColorFor(evt.type));
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
      let visual = visuals[id];

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
        sprite.setBounce(0, 0);
        sprite.setDrag(12, 0);
        sprite.setVelocity(Number(drop.vx) || 0, Number(drop.vy) || 0);
        const maxDim = Math.max(sprite.width || 1, sprite.height || 1);
        // A round coin fills its frame where the gem is wide and flat, so the
        // coin is drawn smaller to stand about as tall as the gem.
        const targetSize = drop.type === "gem" ? 26 : 22;
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
          nextTrailAt: scene.time.now,
          bornAt: scene.time.now,
          spin: (Number(drop.vx) < 0 ? -1 : 1) * (drop.type === "gem" ? 4 : 7),
          settledX: drop.spawnX,
          settledY: drop.spawnY,
          despawning: false,
        };

        visuals[id] = visual;
      }

      if (visual.despawning) continue;

      visual.spawnedAt = Number(drop.spawnedAt) || visual.spawnedAt;
      visual.blinkAt = Number(drop.blinkAt) || visual.blinkAt;
      visual.expiresAt = Number(drop.expiresAt) || visual.expiresAt;

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
        Number(visual.expiresAt || 0) - Number(visual.blinkAt || 0) || DEATH_DROP_BLINK_MS,
      );
      const pulseT = Phaser.Math.Clamp(1 - remainingMs / pulseWindowMs, 0, 1);
      const pulseSpeed = 8 + pulseT * 26;
      const pulseWave = Math.abs(
        Math.sin(nowSec * pulseSpeed + visual.phase * 1.7),
      );
      const blinkAlpha =
        pulseT > 0 ? 0.26 + (0.74 - pulseT * 0.08) * pulseWave : 1;

      if (visual.settled) {
        visual.sprite.x = visual.settledX;
        visual.sprite.y = visual.settledY;
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
        // A real turn of the coin, and quicker while it is flying.
        const spinRate = visual.settled ? 6 : 12;
        visual.sprite.setFrame(coinSpinFrame(nowSec * spinRate + visual.phase));
      } else {
        const scalePulse = 0.94 + 0.08 * Math.sin(nowSec * 3.6 + visual.phase);
        visual.sprite.setScale(baseScale * scalePulse);
        visual.sprite.rotation = 0.06 * Math.sin(nowSec * 2.4 + visual.phase);
      }

      if (!visual.settled && visual.type !== "coin") {
        const flightAge = (scene.time.now - visual.bornAt) / 1000;
        visual.sprite.rotation = flightAge * visual.spin;
      }

      pickupClient.propose(drop.id, visual, deathAgeMs);
    }

    for (const [key, at] of deathBursts) {
      if (scene.time.now - at > 15000) deathBursts.delete(key);
    }

    for (const [id, visual] of Object.entries(visuals || {})) {
      if (seenIds.has(id) || visual.despawning) continue;
      visual.despawning = true;
      scene.tweens.add({
        targets: pickupVisualParts(visual),
        alpha: 0,
        scaleX: 0.35,
        scaleY: 0.35,
        duration: 160,
        ease: "Quad.easeIn",
        onComplete: () => cleanupDeathDropVisual(id, visual),
      });
    }
  }

  function destroy() {
    for (const [id, visual] of Object.entries(visuals)) cleanupDeathDropVisual(id, visual);
  }

  return { renderDeathDrops, consumeCollectedDeathDropQueue, destroy };
}
