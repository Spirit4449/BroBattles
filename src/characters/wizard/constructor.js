// src/characters/wizard/constructor.js
import socket from "../../socket";
import { characterStats } from "../../lib/characterStats.js";
import { animations } from "./anim";
import {
  performWizardFireball,
  spawnWizardFireballAuthoritative,
  spawnWizardFireballVisual,
  changeDebugState,
} from "./attack";
import { executeDefaultAttack } from "../shared/attackFlow";
import CharacterEntityBase from "../shared/characterEntityBase";

const NAME = "wizard";

function consumeWizardRelease(scene, packetId) {
  const id = String(packetId || "").trim();
  if (!id) return true;
  if (!scene._wizardReleaseSeen) {
    scene._wizardReleaseSeen = new Map();
  }
  const now = Date.now();
  for (const [key, seenAt] of scene._wizardReleaseSeen.entries()) {
    if (now - seenAt > 4000) scene._wizardReleaseSeen.delete(key);
  }
  if (scene._wizardReleaseSeen.has(id)) return false;
  scene._wizardReleaseSeen.set(id, now);
  return true;
}

class Wizard extends CharacterEntityBase {
  static key = NAME;
  static textureKey = NAME;

  static sounds = {
    attack: { key: "wizard-fireball", volume: 0.55 },
    hit: { key: "wizard-impact", volume: 0.45 },
    special: { key: "wizard-special", volume: 0.5, rate: 1 },
  };

  static preload(scene, staticPath = "/assets") {
    if (!scene?.load) return;
    scene.load.atlas(
      NAME,
      this.characterAssetPath(staticPath, "spritesheet.webp"),
      this.characterAssetPath(staticPath, "animations.json"),
    );
    scene.load.atlas(
      "wizard-aura",
      this.characterAssetPath(staticPath, "aura.png"),
      this.characterAssetPath(staticPath, "aura.json"),
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
    scene.load.audio(
      "wizard-special",
      this.characterAssetPath(staticPath, "special.mp3"),
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
    if (!data) return false;
    const ownerSprite = ownerWrapper ? ownerWrapper.opponent : null;
    if (data.type === `${NAME}-fireball`) {
      try {
        if (ownerSprite?.anims) {
          if (scene.anims?.exists("wizard-throw")) {
            ownerSprite.anims.play("wizard-throw", false);
          } else if (scene.anims?.exists("throw")) {
            ownerSprite.anims.play("throw", false);
          }
        }
      } catch (_) {}
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

  constructor(deps) {
    super(deps);
  }

  performDefaultAttack(payloadBuilder, onAfterFire) {
    const result = executeDefaultAttack({
      scene: this.scene,
      ammo: this.ammo,
      emitAction: (payload) => socket.emit("game:action", payload),
      payloadBuilder,
      onAfterFire,
      attackResetMs: null,
      cooldownFallbackMs: 450,
    });

    if (!result.fired) return false;

    const safeClear = result.clearAttack;
    this.scene.time.delayedCall(950, safeClear);

    try {
      const p = this.player;
      const currentAnim =
        p?.anims && p.anims.currentAnim ? p.anims.currentAnim : null;
      if (currentAnim && /throw|attack/i.test(currentAnim.key)) {
        const key = currentAnim.key;
        const frameRate = currentAnim.frameRate || 18;
        const frameCount =
          (currentAnim.frames && currentAnim.frames.length) || frameRate;
        const estMs = (frameCount / Math.max(1, frameRate)) * 1000 + 120;
        this.scene.time.delayedCall(Math.min(estMs, 1200), safeClear);
        p.once("animationcomplete", (anim) => {
          if (anim && anim.key === key) safeClear();
        });
      } else {
        this.scene.time.delayedCall(520, safeClear);
      }
    } catch (_) {}

    return true;
  }

  handlePointerDown = (attackContext = null) => {
    const context = attackContext || this.consumeAttackContext();
    return this.performDefaultAttack(() =>
      performWizardFireball(this, context),
    );
  };
}

export default Wizard;
