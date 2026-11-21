import { characterDefinitions } from "../../../../shared/characters/index.js";
import { createAnimationBuilder } from "../shared/animationBuilder";
import { perform as performSpecial } from "./special";
import { animations } from "./anim";
import DravenEffects from "./effects";
import { updateInfernoHover } from "./infernoHover";
import { INFERNO_SOUND_KEYS } from "./infernoAudio";
import {
  performDravenSplashAttack,
  spawnExplosion,
  spawnInfernoExplosion,
} from "./attack";
import CharacterEntityBase from "../shared/characterEntityBase";
import { playSpriteAnimation } from "../shared/animationState";
import { playPlayerSound } from "../../audio/playerAudio";
import { takePredictedHit } from "../shared/shotPrediction";

const { key: NAME } = characterDefinitions.draven;

// Inferno impact ids are "inferno:<caster>:<target>:<time>".
const infernoTarget = (data) => String(data?.id || "").split(":")[2] || null;

class Draven extends CharacterEntityBase {
  static key = NAME;
  // Main texture key used for this character's sprite
  static performSpecial = performSpecial;
  // Optional per-player effects class to be used for this character
  static Effects = DravenEffects;

  static sounds = {
    attack: { key: "draven-fireball" },
    hit: { key: "draven-hit" },
    special: { key: "draven-special", rate: 0.8 },
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
    if (!scene.cache?.audio?.exists(`${NAME}-hit`)) {
      scene.load.audio(
        `${NAME}-hit`,
        this.characterAssetPath(staticPath, "hit.mp3"),
      );
    }

    scene.load.audio(
      `${NAME}-special`,
      this.characterAssetPath(staticPath, "special.mp3"),
    );
    // Inferno's event layers: draven-inferno-* -> inferno-*.mp3.
    for (const key of INFERNO_SOUND_KEYS) {
      scene.load.audio(key, this.characterAssetPath(staticPath, `${key.slice(NAME.length + 1)}.mp3`));
    }

    // Ensure nearest-neighbor sampling for crisp pixel art (renderer-agnostic)
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      try {
        const tex = scene.textures.get(NAME);
        if (tex && typeof tex.setFilter === "function") {
          tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
        }
      } catch (_) {}
    });
  }

  static setupAnimations(scene) {
    animations(scene);
    for (const [base, rate, repeat] of [["draven-explosion", 24, 0], ["draven-special-fx", 24, -1]]) {
      for (const key of [base, base + "-red"]) {
        if (scene.textures.exists(key)) createAnimationBuilder(scene, key).make(key, "", rate, repeat);
      }
    }
  }

  // Called every local movement frame; Inferno is Draven's ability lock.
  static updateMovementLock(scene, player, state) {
    updateInfernoHover(scene, player, state);
  }

  // Cast animation starts immediately; confirmed hits own impact presentation.
  static handleRemoteAttack(scene, data, ownerWrapper) {
    if (!data) return false;
    if (data.type === "draven-splash-explode") {
      spawnExplosion(scene, Number(data.x) || 0, Number(data.y) || 0, ownerWrapper?.opponent);
      return true;
    }
    if (data.type === "draven-inferno-explode") {
      spawnInfernoExplosion(scene, Number(data.x) || 0, Number(data.y) || 0, ownerWrapper?.opponent, infernoTarget(data));
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
      id: data.id ?? null,
    });
    // Play remote attack start SFX (mirror owner's throw)
    try {
      playPlayerSound(scene, ownerSprite, "draven-fireball");
    } catch (_) {}
    // Impact presentation is owned by the authoritative hit event. A delayed
    // caster-position copy duplicates the target impact and can fire on misses.
    return true;
  }

  static handleLocalAuthoritativeAttack(scene, data) {
    if (data?.type === "draven-inferno-explode") {
      spawnInfernoExplosion(scene, Number(data.x) || 0, Number(data.y) || 0, null, infernoTarget(data));
      return true;
    }
    if (!data || data.type !== "draven-splash-explode") return false;
    // A splash this client predicted already exploded on the drawn target.
    if (!takePredictedHit(data.target, "impact")) spawnExplosion(scene, Number(data.x) || 0, Number(data.y) || 0);
    return true;
  }

  // Draven splash attack trigger
  static basicAttack = performDravenSplashAttack;
}

export default Draven;
