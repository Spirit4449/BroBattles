import { predictNinja } from './network';
import { getResolvedCharacterAttackConfig } from "../../../../shared/characters/characterTuning.js";
import { animations } from "./anim";
import { legacyAnimations } from "./legacyAnim";
import CharacterEntityBase from "../shared/characterEntityBase";
import { playSpriteAnimation } from "../shared/animationState";
import { createRuntimeId } from "../shared/runtimeId";
import { aimAngle, aimFacesLeft, faceAttack } from "../shared/flipLock";
import { beginThrow } from "./throwPresentation";

// Single source of truth for this character's name/key
const NAME = "ninja";
const RETURNING_SHURIKEN = getResolvedCharacterAttackConfig(
  NAME,
  "returningShuriken",
);

class Ninja extends CharacterEntityBase {
  static key = NAME;
  // Main texture key used for this character's sprite
  static textureKey = NAME;

  static sounds = {
    attack: { key: "shurikenThrow", volume: 0.5, rate: 1.3 },
    hit: { key: "shurikenHit", volume: 1.25, rate: 1.0 },
    hitWood: { key: "shurikenHitWood", volume: 0.7 },
  };

  static attackFlow = { attackResetMs: 300 };

  static preload(scene, staticPath = "/assets", options = {}) {
    this.loadBaseAtlas(scene, staticPath, options);
    scene.load.spritesheet("ninja-throw-effects",
      this.characterAssetPath(staticPath, "throw-effects.webp"),
      { frameWidth: 64, frameHeight: 64 });
    this.loadFiles(scene, staticPath, {
      image: { shuriken: "shuriken.webp", "shuriken-red": "shuriken-red.webp" },
      audio: {
        shurikenThrow: "shurikenThrow.mp3",
        shurikenHit: "hit.mp3",
        shurikenHitWood: "woodhit.mp3",
      },
    });
  }

  static setupAnimations(scene) {
    animations(scene);
  }

  // Unconverted skins retain their original frame counts and cadence.
  static setupSkinAnimations(scene, textureKey, texture) {
    if (texture.has("attack00")) return false;
    legacyAnimations(scene, textureKey);
    return true;
  }

  // The throw is a server projectile; ninja/network.js predicts and draws it.
  handlePointerDown(attackContext = null) {
    const context = attackContext || this.consumeAttackContext() || {};
    const p = this.player;
    const angle = aimAngle(context?.angle, p);
    const direction = aimFacesLeft({ direction: context?.direction, angle }, p.flipX) ? -1 : 1;

    return this.performDefaultAttack(() => {
      const attackId = createRuntimeId("ninjaShuriken");
      // Face the throw and hold it through the throw, so running the other
      // way does not turn him back mid-throw.
      faceAttack(this.scene, p, direction < 0, RETURNING_SHURIKEN.flipLockMs);
      this.scene.sound.play("shurikenThrow", { volume: 1, rate: 1.3 });
      playSpriteAnimation({
        scene: this.scene,
        sprite: p,
        character: NAME,
        logical: "throw",
        fallback: "idle",
        id: attackId,
        variant: beginThrow(p, angle),
      });
      return predictNinja(this.scene, p, this.username, { type: 'ninja-shuriken', id: attackId, angle });
    });
  }
}

export default Ninja;
