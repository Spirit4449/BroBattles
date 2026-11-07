import { animations } from "./anim";
import {
  changeDebugState,
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

const NAME = "gloop";

// Each slimeball or hook id is its own throw.
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
  static textureKey = NAME;

  static sounds = {
    attack: { key: `${NAME}-attack`, volume: 0.5 },
    hit: { key: `${NAME}-hit`, volume: 0.5 },
    special: { key: `${NAME}-special`, volume: 0.62 },
    pull: { key: `${NAME}-pull`, volume: 0.54 },
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

  static setDebugState(enabled) {
    changeDebugState(enabled);
  }

  static handleRemoteAttack(scene, data, ownerWrapper) {
    if (!data) return false;
    const ownerSprite = ownerWrapper ? ownerWrapper.opponent : null;
    const type = String(data.type || "").toLowerCase();
    if (type === `${NAME}-slimeball`) {
      playOwnerThrow(scene, ownerSprite, data.id ?? null);
      playPlayerSound(scene, ownerSprite, "gloop-attack", { volume: 0.5 });
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

  handlePointerDown(attackContext = null) {
    const context = attackContext || this.consumeAttackContext();
    return this.performDefaultAttack(() =>
      performGloopSlimeball(this, context),
    );
  }
}

export default Gloop;
