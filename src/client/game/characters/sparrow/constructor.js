import { characterDefinitions } from "../../../../shared/characters/index.js";
import { perform as performSpecial, updateSeraphHover, isSeraphAiming, releaseSeraph, setSeraphAim, getSeraphAim, SERAPH_AIM_SOUND, SERAPH_RELEASE_SOUND } from "./special";
import { SERAPH_FX_KEY } from "./seraphFx";
import { chooseRemoteAnimationState } from "../shared/animationState";
import { predictSparrowShot } from './network';
import { animations } from "./anim";
import { performSparrowArrowSpread } from "./attack";
import CharacterEntityBase from "../shared/characterEntityBase";
import { playSpriteAnimation } from "../shared/animationState";
import { applyScaleLockedRageFx } from "../shared/powerupFx";
import { playPlayerSound } from "../../audio/playerAudio";
import { sparrowAimVariant } from "./aimPoses";

const { key: NAME } = characterDefinitions.sparrow;

class Sparrow extends CharacterEntityBase {
  static key = NAME;
  static performSpecial = performSpecial;

  static sounds = {
    attack: { key: "sparrow-attack" },
    hit: { key: "sparrow-hit" },
    special: { key: "sparrow-special" },
  };

  static attackFlow = { attackResetMs: 520, cooldownFallbackMs: 1000 };

  static preload(scene, staticPath = "/assets", options = {}) {
    if (!scene?.load) return;
    this.loadBaseAtlas(scene, staticPath, options);
    this.loadFiles(scene, staticPath, {
      image: { [`${NAME}-arrow`]: "arrow.webp" },
      audio: {
        [`${NAME}-attack`]: "attack.mp3",
        [`${NAME}-hit`]: "hit.mp3",
        [`${NAME}-special`]: "special.mp3",
        [SERAPH_AIM_SOUND]: "seraph-aim.mp3",
        [SERAPH_RELEASE_SOUND]: "seraph-release.mp3",
      },
    });
    scene.load.atlas(SERAPH_FX_KEY, this.characterAssetPath(staticPath, "seraph-fx.webp"),
      this.characterAssetPath(staticPath, "seraph-fx.json"));
  }

  static setupAnimations(scene) {
    animations(scene);
  }

  static handleRemoteAttack(scene, data, ownerWrapper, remoteContext = {}) {
    if (!data) return false;
    const ownerSprite = ownerWrapper ? ownerWrapper.opponent : null;
    const type = String(data.type || "").toLowerCase();
    if (type === `${NAME}-arrow`) {
      playPlayerSound(scene, ownerSprite, "sparrow-attack");
      playSpriteAnimation({
        scene,
        sprite: ownerSprite,
        character: NAME,
        logical: "throw",
        fallback: "idle",
        id: data.id ?? null,
        variant: sparrowAimVariant(data.angle),
      });
      return true;
    }
    return false;
  }

  // Seraph poses (`seraph-aim-NN`) are shown as sent: they carry her aim.
  static chooseRemoteAnimation(context = {}) {
    if (/^(sparrow-)?seraph-/.test(String(context.animation || ""))) {
      return String(context.animation).replace(/^sparrow-/, "");
    }
    return chooseRemoteAnimationState({ ...context, character: NAME });
  }

  // Called each frame by the local movement loop while an ability lock holds.
  static updateMovementLock(scene, player, { now } = {}) {
    updateSeraphHover(scene, player, now);
  }

  // Seraph's aim phase takes the attack inputs: they aim and loose the bolt.
  static followUpActive(player) {
    return isSeraphAiming(player);
  }
  static aimFollowUp(player, angle) {
    setSeraphAim(player, angle);
  }
  static getFollowUpAngle(player) {
    return getSeraphAim(player);
  }
  static releaseFollowUp(scene, player, angle) {
    return releaseSeraph(scene, player, angle);
  }

  static applyPowerupFx(context) {
    return applyScaleLockedRageFx(context, { particleSize: 3.5 });
  }

  // Shots are predicted locally before the server confirms them.
  emitAttackAction(payload) {
    super.emitAttackAction(predictSparrowShot(this.scene, this.player, this.username, payload));
  }

  static basicAttack = performSparrowArrowSpread;
}

export default Sparrow;
