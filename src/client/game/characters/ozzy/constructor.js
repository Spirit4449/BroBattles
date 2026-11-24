import { characterDefinitions } from "../../../../shared/characters/index.js";
import { perform as performSpecial } from "./special";
import { SOCKET_EVENTS } from "../../../../shared/net/socketEvents.js";
// src/client/game/characters/ozzy/constructor.js
import { animations } from "./anim";
import { ensureFireballTextures } from "./fireballArt";
import {
  performOzzyFireball,
  chargeOzzyFireball,
  spawnOzzyFireballAuthoritative,
  spawnOzzyFireballVisual,
  playOzzyCastWindup,
  consumeOzzyRelease,
} from "./attack";
import { playOzzyArcaneSurge } from "./effects.js";
import CharacterEntityBase from "../shared/characterEntityBase";

const { key: NAME } = characterDefinitions.ozzy;

class Ozzy extends CharacterEntityBase {
  static key = NAME;
  static performSpecial = performSpecial;

  static sounds = {
    attack: { key: "ozzy-fireball" },
    hit: { key: "ozzy-impact" },
    special: { key: "ozzy-special" },
  };

  static attackFlow = {
    attackResetMs: null,
    cooldownFallbackMs: 450,
    clearOnAnimation: { safetyMs: 950, fallbackFrameRate: 18, bufferMs: 120, noAnimationMs: 520 },
  };

  static socketEvents = {
    [SOCKET_EVENTS.OZZY_ARCANE_SURGE]: ({ scene, findSprite }, payload) =>
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

  static setupSkinAnimations(scene, textureKey) {
    animations(scene, textureKey);
    return true;
  }

  static handleRemoteAttack(scene, data, ownerWrapper) {
    if (!data) return false;
    const ownerSprite = ownerWrapper ? ownerWrapper.opponent : null;
    if (data.type === `${NAME}-fireball`) {
      playOzzyCastWindup(scene, ownerSprite, data.id ?? null, data.angle);
      chargeOzzyFireball(scene, ownerSprite, data);
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

  static basicAttack = performOzzyFireball;
}

export default Ozzy;
