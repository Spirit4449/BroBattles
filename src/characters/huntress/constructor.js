import socket from "../../socket";
import { predictHuntressShot } from './network';
import { characterStats } from "../../shared/characterStats.js";
import { animations } from "./anim";
import { performHuntressArrowSpread } from "./attack";
import { executeDefaultAttack } from "../shared/attackFlow";
import CharacterEntityBase from "../shared/characterEntityBase";
import { playSpriteAnimation } from "../shared/animationState";

const NAME = "huntress";

class Huntress extends CharacterEntityBase {
  static key = NAME;
  static textureKey = NAME;

  static characterAssetPath(staticPath = "/assets", fileName = "") {
    return `${staticPath}/huntress/${fileName}`;
  }

  static sounds = {
    attack: { key: "huntress-attack", volume: 0.55 },
    hit: { key: "huntress-hit", volume: 0.55 },
    special: { key: "huntress-special", volume: 0.6 },
  };

  static preload(scene, staticPath = "/assets", options = {}) {
    const includeBaseAtlas = options?.includeBaseAtlas !== false;
    if (!scene?.load) return;

    if (includeBaseAtlas) {
      scene.load.atlas(
        NAME,
        this.characterAssetPath(staticPath, "spritesheet.webp"),
        this.characterAssetPath(staticPath, "animations.json"),
      );
    }
    scene.load.image(
      `${NAME}-arrow`,
      this.characterAssetPath(staticPath, "arrow.webp"),
    );
    scene.load.audio(
      `${NAME}-attack`,
      this.characterAssetPath(staticPath, "attack.mp3"),
    );
    scene.load.audio(
      `${NAME}-hit`,
      this.characterAssetPath(staticPath, "hit.mp3"),
    );
    scene.load.audio(
      `${NAME}-special`,
      this.characterAssetPath(staticPath, "special.mp3"),
    );
    scene.load.audio(
      `${NAME}-burn-tick`,
      this.characterAssetPath(staticPath, "tick.mp3"),
    );
  }

  static setupAnimations(scene) {
    animations(scene);
  }

  static getStats() {
    return characterStats.huntress;
  }

  static handleRemoteAttack(scene, data, ownerWrapper, remoteContext = {}) {
    if (!data) return false;
    const ownerSprite = ownerWrapper ? ownerWrapper.opponent : null;
    const type = String(data.type || "").toLowerCase();
    if (type === `${NAME}-arrow`) {
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

  static applyPowerupFx({
    sprite,
    effects,
    nowSec,
    colors,
    spawnTrailParticle,
  } = {}) {
    if (!sprite || !effects) return { handled: false, rageLike: false };
    if ((effects.rage || 0) <= 0) return { handled: false, rageLike: false };

    const pulse = 0.5 + 0.5 * Math.sin(nowSec * 8 + (sprite.x || 0) * 0.01);
    sprite.setTint(pulse > 0.52 ? 0xc084fc : 0x9333ea);

    // Keep base scale under rage so the physics body does not desync and tunnel.
    const baseX = sprite._puBaseScaleX || 1;
    const baseY = sprite._puBaseScaleY || 1;
    const baseOriginX = sprite._puBaseOriginX ?? 0.5;
    const baseOriginY = sprite._puBaseOriginY ?? 0.5;
    sprite.setScale(baseX, baseY);
    sprite.setOrigin(baseOriginX, baseOriginY);

    if (typeof spawnTrailParticle === "function" && Math.random() < 0.34) {
      spawnTrailParticle(
        (sprite.x || 0) + (Math.random() * 28 - 14),
        (sprite.y || 0) + (Math.random() * 44 - 26),
        colors?.rage || 0xa855f7,
        3.5,
        300,
      );
    }
    return { handled: true, rageLike: true };
  }

  constructor(deps) {
    super(deps);
  }

  performDefaultAttack(payloadBuilder, onAfterFire) {
    const result = executeDefaultAttack({
      scene: this.scene,
      ammo: this.ammo,
      emitAction: (payload) => socket.emit("game:action",
        predictHuntressShot(this.scene, this.player, this.username, payload)),
      payloadBuilder,
      onAfterFire,
      attackResetMs: 520,
      cooldownFallbackMs: 1000,
    });
    return !!result.fired;
  }

  handlePointerDown(attackContext = null) {
    const context = attackContext || this.consumeAttackContext();
    return this.performDefaultAttack(() =>
      performHuntressArrowSpread(this, context),
    );
  }
}

export default Huntress;
