// src/characters/wizard/constructor.js
import socket from "../../socket";
import { characterStats } from "../../lib/characterStats.js";
import { animations } from "./anim";
import {
  performWizardFireball,
  spawnWizardFireballVisual,
  changeDebugState,
} from "./attack";
import { executeDefaultAttack } from "../shared/attackFlow";
import CharacterEntityBase from "../shared/characterEntityBase";

const NAME = "wizard";

class Wizard extends CharacterEntityBase {
  static key = NAME;
  static textureKey = NAME;

  static sounds = {
    attack: { key: "wizard-fireball", volume: 0.55 },
    hit: { key: "wizard-impact", volume: 0.45 },
    special: { key: "wizard-fireball", volume: 0.4, rate: 0.75 },
  };

  static preload(scene, staticPath = "/assets") {
    if (!scene?.load) return;
    scene.load.atlas(
      NAME,
      this.characterAssetPath(staticPath, "spritesheet.webp"),
      this.characterAssetPath(staticPath, "animations.json"),
    );
    // Load animated fireball atlas (frames defined in fireball.json)
    scene.load.atlas(
      "wizard-fireball",
      this.characterAssetPath(staticPath, "fireball.webp"),
      this.characterAssetPath(staticPath, "fireball.json"),
    );
    scene.load.audio(
      "wizard-fireball",
      this.characterAssetPath(staticPath, "fireball.mp3"),
    );
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

  static getStats() {
    return characterStats.wizard;
  }

  static handleRemoteAttack(scene, data, ownerWrapper) {
    if (!data || data.type !== `${NAME}-fireball`) return false;
    const ownerSprite = ownerWrapper ? ownerWrapper.opponent : null;
    spawnWizardFireballVisual(scene, data, ownerSprite);
    return true;
  }

  constructor(deps) {
    super(deps);
  }

  performDefaultAttack(payloadBuilder, onAfterFire) {
    const cooldown = this.ammo?.getAmmoCooldownMs
      ? Number(this.ammo.getAmmoCooldownMs()) || 450
      : 450;
    const settleDuration = Math.max(200, cooldown);

    const result = executeDefaultAttack({
      scene: this.scene,
      ammo: this.ammo,
      emitAction: (payload) => socket.emit("game:action", payload),
      payloadBuilder,
      onAfterFire,
      attackResetMs: settleDuration,
      cooldownFallbackMs: 450,
    });

    return !!result.fired;
  }

  handlePointerDown = (attackContext) => {
    const context = attackContext || this.consumeAttackContext();
    return this.performDefaultAttack(() =>
      performWizardFireball(this, context),
    );
  };
}

export default Wizard;
