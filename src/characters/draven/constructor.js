// src/characters/draven/draven.js
import socket from "../../socket";
import {
  characterStats,
} from "../../lib/characterStats.js";
import { getResolvedCharacterAttackConfig } from "../../lib/characterTuning.js";
import { animations } from "./anim";
import DravenEffects from "./effects";
import {
  performDravenSplashAttack,
  spawnExplosion,
  changeDebugState,
} from "./attack";
import { executeDefaultAttack } from "../shared/attackFlow";
import CharacterEntityBase from "../shared/characterEntityBase";

// Single source of truth for this character's name/key
const NAME = "draven";
const SPLASH = getResolvedCharacterAttackConfig(NAME, "splash");

class Draven extends CharacterEntityBase {
  static key = NAME;
  // Main texture key used for this character's sprite
  static textureKey = NAME;
  // Optional per-player effects class to be used for this character
  static Effects = DravenEffects;

  static sounds = {
    attack: { key: "draven-fireball", volume: 0.4 },
    hit: { key: "draven-hit", volume: 0.5 },
    special: { key: "draven-special", volume: 0.6, rate: 0.8 },
  };

  static preload(scene, staticPath = "/assets") {
    // Load atlas and projectile/sounds
    scene.load.atlas(
      NAME,
      this.characterAssetPath(staticPath, "spritesheet.webp"),
      this.characterAssetPath(staticPath, "animations.json"),
    );
    // Explosion atlas (separate) for splash attack visual
    scene.load.atlas(
      `${NAME}-explosion`,
      this.characterAssetPath(staticPath, "explosion.webp"),
      this.characterAssetPath(staticPath, "explosion.json"),
    );
    // Fireball / splash SFX
    scene.load.audio(
      `${NAME}-fireball`,
      this.characterAssetPath(staticPath, "fireball.mp3"),
    );
    if (!scene.sound.get(`${NAME}-hit`)) {
      scene.load.audio(
        `${NAME}-hit`,
        this.characterAssetPath(staticPath, "hit.mp3"),
      );
    }

    scene.load.audio(
      `${NAME}-special`,
      this.characterAssetPath(staticPath, "special.mp3"),
    );

    // Ensure nearest-neighbor sampling for crisp pixel art (renderer-agnostic)
    scene.load.on(Phaser.Loader.Events.COMPLETE, () => {
      try {
        const tex = scene.textures.get(NAME);
        if (tex && typeof tex.setFilter === "function") {
          tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
        }
        // Also set global defaults for this scene's game (Phaser 3.70)
        if (scene.game && scene.game.config) {
          scene.game.config.pixelArt = true;
          scene.game.config.antialias = false;
        }
      } catch (_) {}
    });
  }

  static setupAnimations(scene) {
    animations(scene);
    // Create explosion animation once
    if (!scene.anims.exists(`${NAME}-explosion`)) {
      try {
        const tex = scene.textures.get(`${NAME}-explosion`);
        if (tex && typeof tex.getFrameNames === "function") {
          let names = tex.getFrameNames();
          if (!Array.isArray(names)) names = [];
          // Prefer frames containing "explosion"; fallback to all frames if filter is empty
          let filtered = names.filter((f) => /explosion/i.test(String(f)));
          if (!filtered.length) filtered = names.slice();
          if (filtered.length) {
            // Keep natural order if possible (assumes TexturePacker export is already ordered)
            scene.anims.create({
              key: `${NAME}-explosion`,
              frames: filtered.map((f) => ({
                key: `${NAME}-explosion`,
                frame: f,
              })),
              frameRate: 28,
              repeat: 0,
            });
          }
        }
      } catch (_) {}
    }
  }

  static setDebugState(enabled) {
    changeDebugState(enabled);
  }

  // Remote attack visualization: replicate moving splash & delayed explosion
  static handleRemoteAttack(scene, data, ownerWrapper) {
    if (!data) return false;
    if (data.type === "draven-splash-explode") {
      spawnExplosion(scene, Number(data.x) || 0, Number(data.y) || 0);
      return true;
    }
    if (data.type !== "draven-splash") return false;
    const ownerSprite = ownerWrapper && ownerWrapper.opponent;
    if (!ownerSprite) return true; // nothing to draw
    try {
      if (scene.anims?.exists("draven-throw")) {
        ownerSprite.anims.play("draven-throw", true);
      }
    } catch (_) {}
    // Play remote attack start SFX (mirror owner's throw)
    try {
      scene.sound && scene.sound.play("draven-fireball", { volume: 0.4 });
    } catch (_) {}
    const delay = data.delay || SPLASH.remoteExplosionDelayMs;
    const tipOffset = data.tipOffset || SPLASH.remoteExplosionTipOffset;
    const centerYFactor = data.centerYFactor || SPLASH.centerYFactor;
    // Removed opponent-side debug splash rectangle; only show final explosion now
    scene.time.delayedCall(delay, () => {
      if (!ownerSprite || !ownerSprite.active) return;
      const dir =
        typeof data.direction === "number"
          ? data.direction >= 0
            ? 1
            : -1
          : ownerSprite.flipX
            ? -1
            : 1;
      const ex = ownerSprite.x + (dir > 0 ? tipOffset : -tipOffset);
      const ey = ownerSprite.y - ownerSprite.height * centerYFactor;
      spawnExplosion(scene, ex, ey);
    });
    return true;
  }

  static handleLocalAuthoritativeAttack(scene, data) {
    if (!data || data.type !== "draven-splash-explode") return false;
    spawnExplosion(scene, Number(data.x) || 0, Number(data.y) || 0);
    return true;
  }

  // Per-character gameplay and presentation stats
  static getStats() {
    return characterStats.draven;
  }

  constructor(deps) {
    super(deps);
  }

  // Common default behavior for firing attacks
  performDefaultAttack(payloadBuilder, onAfterFire) {
    const result = executeDefaultAttack({
      scene: this.scene,
      ammo: this.ammo,
      emitAction: (payload) => socket.emit("game:action", payload),
      payloadBuilder,
      onAfterFire,
      attackResetMs: null,
    });

    if (!result.fired) return false;

    // We'll clear isAttacking when the attack animation actually completes (see below)
    // Provide a safety fallback in case the animation is interrupted.
    const safeClear = result.clearAttack;
    // Safety fallback: if nothing else clears it within 900ms, clear automatically
    this.scene.time.delayedCall(900, safeClear);

    // Attempt to detect and listen for the throw animation to finish before clearing isAttacking
    try {
      const p = this.player;
      const currentAnim =
        p.anims && p.anims.currentAnim ? p.anims.currentAnim : null;
      if (currentAnim && /throw|attack/i.test(currentAnim.key)) {
        const key = currentAnim.key;
        // Estimate duration if we have frame data
        const frameRate = currentAnim.frameRate || 15;
        const frameCount =
          (currentAnim.frames && currentAnim.frames.length) || frameRate;
        const estMs = (frameCount / Math.max(1, frameRate)) * 1000 + 30; // small buffer
        // Hard cap (not longer than 1.2s so we don't get stuck)
        const capped = Math.min(estMs, 1200);
        this.scene.time.delayedCall(capped, safeClear);
        // Also clear on actual animation complete (whichever happens first)
        p.once("animationcomplete", (anim) => {
          if (anim && anim.key === key) safeClear();
        });
      } else {
        // If no attack animation detected, rely on the shorter fallback
        this.scene.time.delayedCall(350, safeClear);
      }
    } catch (_) {}
    return true;
  }

  // Draven splash attack trigger
  handlePointerDown(attackContext = null) {
    const context = attackContext || this.consumeAttackContext();
    return this.performDefaultAttack(() =>
      performDravenSplashAttack(this, context),
    );
  }
}

export default Draven;
