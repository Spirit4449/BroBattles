import socket from "../../../lib/socket";
import { predictSparrowShot } from './network';
import { animations } from "./anim";
import { performSparrowArrowSpread } from "./attack";
import CharacterEntityBase from "../shared/characterEntityBase";
import { playSpriteAnimation } from "../shared/animationState";
import { applyScaleLockedRageFx } from "../shared/powerupFx";
import { playPlayerSound } from "../../audio/playerAudio";
import { withShotView } from "../shared/shotPrediction";
import { sparrowAimVariant } from "./aimPoses";

const NAME = "sparrow";

class Sparrow extends CharacterEntityBase {
  static key = NAME;
  static textureKey = NAME;

  static sounds = {
    attack: { key: "sparrow-attack", volume: 0.48 },
    hit: { key: "sparrow-hit", volume: 0.48 },
    special: { key: "sparrow-special", volume: 0.56 },
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
        [`${NAME}-burn-tick`]: "tick.mp3",
      },
    });
  }

  static setupAnimations(scene) {
    animations(scene);
  }

  static handleRemoteAttack(scene, data, ownerWrapper, remoteContext = {}) {
    if (!data) return false;
    const ownerSprite = ownerWrapper ? ownerWrapper.opponent : null;
    const type = String(data.type || "").toLowerCase();
    if (type === `${NAME}-arrow`) {
      playPlayerSound(scene, ownerSprite, "sparrow-attack", { volume: 0.48 });
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

  static getEffectTickSounds() {
    return {
      sparrowBurn: {
        key: "sparrow-burn-tick",
        options: { volume: 0.28 },
      },
    };
  }

  static drawPowerupAura({ graphics, frame, effects, nowSec, colors } = {}) {
    if (!graphics || !frame || !effects || (effects.sparrowBurn || 0) <= 0) {
      return false;
    }
    const pulse = 0.72 + 0.28 * Math.sin(nowSec * 10 + frame.x * 0.01);
    const color = colors?.sparrowBurn || 0xff7a1f;
    graphics.fillStyle(color, 0.12 + 0.06 * pulse);
    graphics.fillCircle(frame.x, frame.y, frame.radius + 5 * pulse);
    graphics.lineStyle(3, color, 0.7 * pulse);
    graphics.strokeCircle(frame.x, frame.y, frame.radius + 7 * pulse);
    return true;
  }

  static applyPowerupFx(context) {
    return applyScaleLockedRageFx(context, { particleSize: 3.5 });
  }

  // Shots are predicted locally before the server confirms them.
  emitAttackAction(payload) {
    socket.emit("game:action", withShotView(predictSparrowShot(this.scene, this.player, this.username, payload)));
  }

  handlePointerDown(attackContext = null) {
    const context = attackContext || this.consumeAttackContext();
    return this.performDefaultAttack(() =>
      performSparrowArrowSpread(this, context),
    );
  }
}

export default Sparrow;
