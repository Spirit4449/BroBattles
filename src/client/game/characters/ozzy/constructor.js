// src/client/game/characters/ozzy/constructor.js
import { animations } from "./anim";
import { ensureFireballTextures } from "./fireballArt";
import {
  performOzzyFireball,
  chargeOzzyFireball,
  spawnOzzyFireballAuthoritative,
  spawnOzzyFireballVisual,
  changeDebugState,
  playOzzyCastWindup,
  consumeOzzyRelease,
} from "./attack";
import { playOzzyArcaneSurge } from "./effects.js";
import CharacterEntityBase from "../shared/characterEntityBase";

const NAME = "ozzy";

class Ozzy extends CharacterEntityBase {
  static key = NAME;
  static textureKey = NAME;

  static sounds = {
    attack: { key: "ozzy-fireball", volume: 0.55 },
    hit: { key: "ozzy-impact", volume: 0.45 },
    special: { key: "ozzy-special", volume: 0.5, rate: 1 },
  };

  static attackFlow = {
    attackResetMs: null,
    cooldownFallbackMs: 450,
    clearOnAnimation: { safetyMs: 950, fallbackFrameRate: 18, bufferMs: 120, noAnimationMs: 520 },
  };

  static socketEvents = {
    "ozzy:arcane-surge": ({ scene, findSprite }, payload) =>
      playOzzyArcaneSurge(scene, payload, findSprite),
  };

  static preload(scene, staticPath = "/assets", options = {}) {
    if (!scene?.load) return;
    this.loadBaseAtlas(scene, staticPath, options);
    this.loadFiles(scene, staticPath, {
      audio: { "ozzy-fireball": "fireball.mp3", "ozzy-special": "special.mp3" },
    });
    if (!scene.cache?.audio?.exists("ozzy-impact")) {
      scene.load.audio(
        "ozzy-impact",
        this.characterAssetPath(staticPath, "hit.mp3"),
      );
    }
  }

  static setupAnimations(scene) {
    animations(scene);
    // Fireball sheets are drawn in code (fireballArt.js), not loaded.
    ensureFireballTextures(scene);
  }

  static setDebugState(enabled) {
    changeDebugState(enabled);
  }

  static handleRemoteAttack(scene, data, ownerWrapper) {
    if (!data) return false;
    const ownerSprite = ownerWrapper ? ownerWrapper.opponent : null;
    if (data.type === `${NAME}-fireball`) {
      chargeOzzyFireball(scene, ownerSprite, data);
      playOzzyCastWindup(scene, ownerSprite, 0.55, data.id ?? null);
      return true;
    }
    if (data.type === `${NAME}-fireball-release`) {
      if (!consumeOzzyRelease(scene, data.id)) return true;
      spawnOzzyFireballVisual(scene, data, ownerSprite);
      return true;
    }
    return false;
  }

  static handleLocalAuthoritativeAttack(scene, data, localContext = {}) {
    if (!data || data.type !== `${NAME}-fireball-release`) return false;
    if (!consumeOzzyRelease(scene, data.id)) return true;
    spawnOzzyFireballAuthoritative(scene, data, localContext);
    return true;
  }

  handlePointerDown(attackContext = null) {
    const context = attackContext || this.consumeAttackContext();
    return this.performDefaultAttack(() =>
      performOzzyFireball(this, context),
    );
  }
}

export default Ozzy;
