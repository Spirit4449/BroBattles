import { characterDefinitions } from "../../../../shared/characters/index.js";
import { perform as performSpecial } from "./special";
import { animations } from "./anim";
import {
  performGloopSlimeball,
  spawnGloopSlimeballVisual,
  spawnGloopSlimeBud,
  handleGloopSlimeSplat,
  consumeGloopRelease,
} from "./attack";
import { playHookAction, playHookCatchAction, consumeGloopHook } from "./special";
import { interruptHookedChannel, pullLocalPlayerByHook } from "./hookPull";
import CharacterEntityBase from "../shared/characterEntityBase";
import { playSpriteAnimation } from "../shared/animationState";
import { applyScaleLockedRageFx } from "../shared/powerupFx";
import { playPlayerSound } from "../../audio/playerAudio";


// Each slimeball or hook id is its own throw.

const { key: NAME } = characterDefinitions.gloop;

function playOwnerThrow(scene, sprite, id = null) {
  playSpriteAnimation({
    scene,
    sprite,
    character: NAME,
    logical: "throw",
    fallback: "special",
    id,
  });
}

class Gloop extends CharacterEntityBase {
  static key = NAME;
  static performSpecial = performSpecial;

  static sounds = {
    attack: { key: `${NAME}-attack` },
    hit: { key: `${NAME}-hit` },
    special: { key: `${NAME}-special` },
    pull: { key: `${NAME}-pull` },
  };

  static attackFlow = { attackResetMs: 760, cooldownFallbackMs: 400 };

  static preload(scene, staticPath = "/assets", options = {}) {
    if (!scene?.load) return;
    this.loadBaseAtlas(scene, staticPath, options);
    this.loadFiles(scene, staticPath, {
      image: {
        [`${NAME}-hand-grip-source`]: "hand-grip.webp",
        [`${NAME}-hand-open`]: "openHand.webp",
        [`${NAME}-hand-closed`]: "closedHand.webp",
      },
      audio: {
        [`${NAME}-attack`]: "attack.mp3",
        [`${NAME}-hit`]: "hit.mp3",
        [`${NAME}-special`]: "special.mp3",
        [`${NAME}-pull`]: "pull.mp3",
      },
    });
  }

  static setupAnimations(scene) {
    animations(scene);
  }

  static handleRemoteAttack(scene, data, ownerWrapper) {
    if (!data) return false;
    const ownerSprite = ownerWrapper ? ownerWrapper.opponent : null;
    const type = String(data.type || "").toLowerCase();
    if (type === `${NAME}-slimeball`) {
      playOwnerThrow(scene, ownerSprite, data.id ?? null);
      playPlayerSound(scene, ownerSprite, "gloop-attack");
      spawnGloopSlimeBud(scene, ownerSprite, data);
      return true;
    }
    if (type === `${NAME}-slimeball-splat`) {
      handleGloopSlimeSplat(scene, data);
      return true;
    }
    if (type === `${NAME}-slimeball-release`) {
      if (!consumeGloopRelease(scene, data.id)) return true;
      spawnGloopSlimeballVisual(scene, data, ownerSprite);
      return true;
    }
    if (type === `${NAME}-hook-release`) {
      playOwnerThrow(scene, ownerSprite, data.id ?? null);
      playHookAction(scene, ownerSprite, data, false);
      return true;
    }
    if (type === `${NAME}-hook-catch`) {
      interruptHookedChannel(scene, data.target);
      playHookCatchAction(scene, ownerSprite, data, false);
      return true;
    }
    return false;
  }

  static handleLocalAuthoritativeAttack(scene, data, localContext = {}) {
    const type = String(data?.type || "").toLowerCase();
    const ownerSprite = localContext?.ownerSprite || null;
    if (type === `${NAME}-slimeball-splat`) {
      handleGloopSlimeSplat(scene, data);
      return true;
    }
    if (type === `${NAME}-slimeball-release`) {
      if (!consumeGloopRelease(scene, data.id)) return true;
      spawnGloopSlimeballVisual(scene, data, ownerSprite);
      return true;
    }
    if (type === `${NAME}-hook-release`) {
      // The caster already predicted this hook under the same id.
      if (!consumeGloopHook(scene, data.id)) return true;
      playOwnerThrow(scene, ownerSprite, data.id ?? null);
      playHookAction(scene, ownerSprite, data, true);
      return true;
    }
    if (type === `${NAME}-hook-catch`) {
      interruptHookedChannel(scene, data.target);
      playHookCatchAction(scene, ownerSprite, data, true);
      return true;
    }
    return false;
  }

  static handleActionTargetingLocalPlayer(action, context) {
    if (String(action?.type || "").toLowerCase() !== `${NAME}-hook-catch`) return false;
    return pullLocalPlayerByHook(action, context);
  }

  static applyPowerupFx(context) {
    return applyScaleLockedRageFx(context, { particleSize: 3.7 });
  }

  static basicAttack = performGloopSlimeball;
}

export default Gloop;
