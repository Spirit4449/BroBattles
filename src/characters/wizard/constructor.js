// src/characters/wizard/constructor.js
import { animations } from "./anim";
import {
  performWizardFireball,
  chargeWizardFireball,
  spawnWizardFireballAuthoritative,
  spawnWizardFireballVisual,
  changeDebugState,
  playWizardCastWindup,
} from "./attack";
import { playWizardArcaneSurge } from "./effects.js";
import CharacterEntityBase from "../shared/characterEntityBase";
import { consumeOnce } from "../shared/packetDedupe";

const NAME = "wizard";
const consumeWizardRelease = (scene, id) => consumeOnce(scene, "wizard-release", id, 4000);

class Wizard extends CharacterEntityBase {
  static key = NAME;
  static textureKey = NAME;

  static sounds = {
    attack: { key: "wizard-fireball", volume: 0.55 },
    hit: { key: "wizard-impact", volume: 0.45 },
    special: { key: "wizard-special", volume: 0.5, rate: 1 },
  };

  static attackFlow = {
    attackResetMs: null,
    cooldownFallbackMs: 450,
    clearOnAnimation: { safetyMs: 950, fallbackFrameRate: 18, bufferMs: 120, noAnimationMs: 520 },
  };

  static socketEvents = {
    "wizard:arcane-surge": ({ scene, findSprite }, payload) =>
      playWizardArcaneSurge(scene, payload, findSprite),
  };

  static preload(scene, staticPath = "/assets", options = {}) {
    if (!scene?.load) return;
    this.loadBaseAtlas(scene, staticPath, options);
    scene.load.atlas(
      "wizard-aura",
      this.characterAssetPath(staticPath, "aura.webp"),
      this.characterAssetPath(staticPath, "aura.json"),
    );
    scene.load.atlas(
      "wizard-fireball-unified",
      this.characterAssetPath(staticPath, "fireball-bb.webp"),
      this.characterAssetPath(staticPath, "fireball-bb.json"),
    );
    scene.load.atlas(
      "wizard-fireball-red",
      this.characterAssetPath(staticPath, "fireball-bb-red.webp"),
      this.characterAssetPath(staticPath, "fireball-bb-red.json"),
    );
    this.loadFiles(scene, staticPath, {
      audio: { "wizard-fireball": "fireball.mp3", "wizard-special": "special.mp3" },
    });
    if (!scene.cache?.audio?.exists("wizard-impact")) {
      scene.load.audio(
        "wizard-impact",
        this.characterAssetPath(staticPath, "hit.mp3"),
      );
    }
  }

  static setupAnimations(scene) {
    animations(scene);
  }

  static setDebugState(enabled) {
    changeDebugState(enabled);
  }

  static handleRemoteAttack(scene, data, ownerWrapper) {
    if (!data) return false;
    const ownerSprite = ownerWrapper ? ownerWrapper.opponent : null;
    if (data.type === `${NAME}-fireball`) {
      chargeWizardFireball(scene, ownerSprite, data);
      playWizardCastWindup(scene, ownerSprite, 0.55);
      return true;
    }
    if (data.type === `${NAME}-fireball-release`) {
      if (!consumeWizardRelease(scene, data.id)) return true;
      spawnWizardFireballVisual(scene, data, ownerSprite);
      return true;
    }
    return false;
  }

  static handleLocalAuthoritativeAttack(scene, data, localContext = {}) {
    if (!data || data.type !== `${NAME}-fireball-release`) return false;
    if (!consumeWizardRelease(scene, data.id)) return true;
    spawnWizardFireballAuthoritative(scene, data, localContext);
    return true;
  }

  handlePointerDown(attackContext = null) {
    const context = attackContext || this.consumeAttackContext();
    return this.performDefaultAttack(() =>
      performWizardFireball(this, context),
    );
  }
}

export default Wizard;
