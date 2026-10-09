import socket from "../../../lib/socket";
import { predictHuntressShot } from './network';
import { animations } from "./anim";
import { performHuntressArrowSpread } from "./attack";
import CharacterEntityBase from "../shared/characterEntityBase";
import { playSpriteAnimation } from "../shared/animationState";
import { applyScaleLockedRageFx } from "../shared/powerupFx";
import { playPlayerSound } from "../../audio/playerAudio";
import { withShotView } from "../shared/shotPrediction";

const NAME = "huntress";

class Huntress extends CharacterEntityBase {
  static key = NAME;
  static textureKey = NAME;

  static sounds = {
    attack: { key: "huntress-attack", volume: 0.48 },
    hit: { key: "huntress-hit", volume: 0.48 },
    special: { key: "huntress-special", volume: 0.56 },
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
      playPlayerSound(scene, ownerSprite, "huntress-attack", { volume: 0.48 });
      playSpriteAnimation({
        scene,
        sprite: ownerSprite,
        character: NAME,
        logical: "throw",
        fallback: "idle",
      });
      return true;
    }
    return false;
  }

  static getEffectTickSounds() {
    return {
      huntressBurn: {
        key: "huntress-burn-tick",
        options: { volume: 0.28 },
      },
    };
  }

  static drawPowerupAura({ graphics, frame, effects, nowSec, colors } = {}) {
    if (!graphics || !frame || !effects || (effects.huntressBurn || 0) <= 0) {
      return false;
    }
    const pulse = 0.72 + 0.28 * Math.sin(nowSec * 10 + frame.x * 0.01);
    const color = colors?.huntressBurn || 0xff7a1f;
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
    socket.emit("game:action", withShotView(predictHuntressShot(this.scene, this.player, this.username, payload)));
  }

  handlePointerDown(attackContext = null) {
    const context = attackContext || this.consumeAttackContext();
    return this.performDefaultAttack(() =>
      performHuntressArrowSpread(this, context),
    );
  }
}

export default Huntress;
