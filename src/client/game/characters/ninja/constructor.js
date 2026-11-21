import { combatSoundVolume } from "../../audio/playerAudio";
import { characterDefinitions } from "../../../../shared/characters/index.js";
import { perform as performSpecial } from "./special";
import { predictNinja } from './network';
import { getResolvedCharacterAttackConfig } from "../../../../shared/characters/characterTuning.js";
import { animations } from "./anim";
import { legacyAnimations } from "./legacyAnim";
import CharacterEntityBase from "../shared/characterEntityBase";
import { playSpriteAnimation } from "../shared/animationState";
import { createRuntimeId } from "../shared/runtimeId";
import { aimAngle, aimFacesLeft, faceAttack } from "../shared/flipLock";
import { beginThrow } from "./throwPresentation";
import { SWARM_FX_KEY, SWARM_SOUND_FILES } from "./swarmFx";
import { FLIGHT_SOUND, HIT_SOUND } from "./effects";

// Single source of truth for this character's name/key

const { key: NAME } = characterDefinitions.ninja;

const RETURNING_SHURIKEN = getResolvedCharacterAttackConfig(
  NAME,
  "returningShuriken",
);

class Ninja extends CharacterEntityBase {
  static key = NAME;
  // Main texture key used for this character's sprite
  static performSpecial = performSpecial;

  static sounds = {
    attack: { key: "shurikenThrow", rate: 1.3 },
    hit: { key: HIT_SOUND },
    hitWood: { key: "shurikenHitWood" },
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
        shurikenHitWood: "woodhit.mp3",
        [FLIGHT_SOUND]: "shuriken-flight.mp3",
        [HIT_SOUND]: "shuriken-hit.mp3",
        ...SWARM_SOUND_FILES,
      },
    });
    scene.load.atlas(SWARM_FX_KEY, this.characterAssetPath(staticPath, "swarm-fx.webp"),
      this.characterAssetPath(staticPath, "swarm-fx.json"));
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
      this.scene.sound.play("shurikenThrow", { volume: combatSoundVolume("shurikenThrow"), rate: 1.3 });
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
