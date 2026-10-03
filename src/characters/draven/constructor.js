// src/characters/draven/draven.js
import { animations } from "./anim";
import DravenEffects from "./effects";
import { updateInfernoHover } from "./infernoHover";
import {
  performDravenSplashAttack,
  spawnExplosion,
  changeDebugState,
} from "./attack";
import CharacterEntityBase from "../shared/characterEntityBase";
import { playSpriteAnimation } from "../shared/animationState";
import { playPlayerSound } from "../../gameScene/playerAudio";

const NAME = "draven";

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

  // The attack flag clears when the throw animation completes.
  static attackFlow = {
    attackResetMs: null,
    clearOnAnimation: { safetyMs: 900, fallbackFrameRate: 15, bufferMs: 30, noAnimationMs: 350 },
  };

  static preload(scene, staticPath = "/assets", options = {}) {
    this.loadBaseAtlas(scene, staticPath, options);
    // Explosion atlas (separate) for splash attack visual
    scene.load.atlas(
      `${NAME}-explosion`,
      this.characterAssetPath(staticPath, "explosion-bb.webp"),
      this.characterAssetPath(staticPath, "explosion-bb.json"),
    );
    // Inferno overlay atlas (separate) for special VFX layer
    scene.load.atlas(
      `${NAME}-special-fx`,
      this.characterAssetPath(staticPath, "special-bb.webp"),
      this.characterAssetPath(staticPath, "special-bb.json"),
    );
    scene.load.atlas("draven-explosion-red", this.characterAssetPath(staticPath, "explosion-bb-red.webp"), this.characterAssetPath(staticPath, "explosion-bb-red.json"));
    scene.load.atlas("draven-special-fx-red", this.characterAssetPath(staticPath, "special-bb-red.webp"), this.characterAssetPath(staticPath, "special-bb-red.json"));
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
    for (const [key, frameRate, repeat] of [["draven-explosion-red", 28, 0], ["draven-special-fx-red", 14, -1]]) {
      if (!scene.anims.exists(key) && scene.textures.exists(key)) {
        const names = scene.textures.get(key).getFrameNames().sort((a,b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
        scene.anims.create({ key, frames: names.map(frame => ({ key, frame })), frameRate, repeat });
      }
    }
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
    if (!scene.anims.exists(`${NAME}-special-fx`)) {
      try {
        const tex = scene.textures.get(`${NAME}-special-fx`);
        if (tex && typeof tex.getFrameNames === "function") {
          let names = tex.getFrameNames();
          if (!Array.isArray(names)) names = [];
          names.sort((a, b) => {
            const ra = /(\d+)(?=\D*$)/.exec(String(a));
            const rb = /(\d+)(?=\D*$)/.exec(String(b));
            if (ra && rb) return parseInt(ra[1], 10) - parseInt(rb[1], 10);
            return String(a).localeCompare(String(b));
          });
          if (names.length) {
            scene.anims.create({
              key: `${NAME}-special-fx`,
              frames: names.map((f) => ({
                key: `${NAME}-special-fx`,
                frame: f,
              })),
              frameRate: 14,
              repeat: -1,
            });
          }
        }
      } catch (_) {}
    }
  }

  // Called every local movement frame; Inferno is Draven's ability lock.
  static updateMovementLock(scene, player, state) {
    updateInfernoHover(scene, player, state);
  }

  static setDebugState(enabled) {
    changeDebugState(enabled);
  }

  // Cast animation starts immediately; confirmed hits own impact presentation.
  static handleRemoteAttack(scene, data, ownerWrapper) {
    if (!data) return false;
    if (data.type === "draven-splash-explode") {
      spawnExplosion(scene, Number(data.x) || 0, Number(data.y) || 0, ownerWrapper?.opponent);
      return true;
    }
    if (data.type === "draven-inferno-explode") {
      spawnExplosion(
        scene,
        Number(data.x) || 0,
        Number(data.y) || 0,
        ownerWrapper?.opponent,
      );
      return true;
    }
    if (data.type !== "draven-splash") return false;
    const ownerSprite = ownerWrapper && ownerWrapper.opponent;
    if (!ownerSprite) return true; // nothing to draw
    playSpriteAnimation({
      scene,
      sprite: ownerSprite,
      character: NAME,
      logical: "throw",
      fallback: "idle",
    });
    // Play remote attack start SFX (mirror owner's throw)
    try {
      playPlayerSound(scene, ownerSprite, "draven-fireball", { volume: 0.4 });
    } catch (_) {}
    // Impact presentation is owned by the authoritative hit event. A delayed
    // caster-position copy duplicates the target impact and can fire on misses.
    return true;
  }

  static handleLocalAuthoritativeAttack(scene, data) {
    if (data?.type === "draven-inferno-explode") {
      spawnExplosion(scene, Number(data.x) || 0, Number(data.y) || 0);
      return true;
    }
    if (!data || data.type !== "draven-splash-explode") return false;
    spawnExplosion(scene, Number(data.x) || 0, Number(data.y) || 0);
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
