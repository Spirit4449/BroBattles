import { setThorgRageVisual } from "./rageVisual";
import { drawPixelRing } from "../../powerups/pixelShapes";
// src/client/game/characters/thorg/thorg.js
import { getResolvedCharacterAttackConfig } from "../../../../shared/characters/characterTuning.js";
import { animations } from "./anim";
import { performThorgFallAttack, THORG_FALL_DURATION_MS, changeDebugState } from "./attack";
import { startThorgSweep } from "./weapon";
import CharacterEntityBase from "../shared/characterEntityBase";
import { chooseRemoteAnimationState } from "../shared/animationState";

// Single source of truth for this character's name/key
const NAME = "thorg";
const SWEEP = getResolvedCharacterAttackConfig(NAME, "sweep");

class Thorg extends CharacterEntityBase {
  static key = NAME;
  static WEAPON_FORWARD_OFFSET = SWEEP.spriteForwardOffset;
  // Main texture key used for this character's sprite
  static textureKey = NAME;

  static sounds = {
    attack: { key: "thorg-throw", volume: 0.6 },
    hit: { key: "thorg-hit", volume: 0.72 },
    special: { key: "thorg-throw", volume: 0.5, rate: 0.85 },
  };

  static attackFlow = { attackResetMs: THORG_FALL_DURATION_MS };

  static preload(scene, staticPath = "/assets", options = {}) {
    this.loadBaseAtlas(scene, staticPath, options);
    scene.load.audio(
      "thorg-throw",
      this.characterAssetPath(staticPath, "swoosh.mp3"),
    );
    scene.load.audio("thorg-sweep", this.characterAssetPath(staticPath, "sweep.mp3"));
    if (!scene.sound.get("thorg-hit")) {
      scene.load.audio(
        "thorg-hit",
        this.characterAssetPath(staticPath, "hit.mp3"),
      );
    }
  }

  static setupAnimations(scene, textureKey = NAME) {
    animations(scene, textureKey);
  }

  static setDebugState(enabled) {
    changeDebugState(enabled);
  }

  static handleRemoteAttack(scene, data, ownerWrapper) {
    if (data.type !== `${NAME}-fall`) return false;
    const sprite = ownerWrapper?.opponent;
    if (sprite) startThorgSweep(scene, sprite, { direction: data.direction });
    return true;
  }

  static chooseRemoteAnimation({
    animation = "idle",
    previousPosition,
    currentPosition,
    sprite,
  } = {}) {
    return chooseRemoteAnimationState({
      animation,
      previousPosition,
      currentPosition,
      sprite,
      character: NAME,
    });
  }

  static applyPowerupFx({
    scene,
    sprite,
    effects,
    nowSec,
    colors,
    spawnTrailParticle,
  } = {}) {
    if (!scene || !sprite || !effects)
      return { handled: false, rageLike: false };
    const thorgRageOn = (effects.thorgRage || 0) > 0;
    setThorgRageVisual(scene, sprite, thorgRageOn);
    if (!thorgRageOn) return { handled: false, rageLike: false };

    const pulse = 0.5 + 0.5 * Math.sin(nowSec * 10 + (sprite.x || 0) * 0.012);
    sprite.setTint(pulse > 0.52 ? 0xc084fc : 0x7e22ce);

    if (typeof spawnTrailParticle === "function" && Math.random() < 0.72) {
      spawnTrailParticle(
        sprite.x + Phaser.Math.Between(-18, 18),
        sprite.y + Phaser.Math.Between(-34, 14),
        colors?.thorgRage || 0x9333ea,
        Phaser.Math.FloatBetween(3.6, 6.2),
        340,
      );
    }
    if (typeof spawnTrailParticle === "function" && Math.random() < 0.28) {
      spawnTrailParticle(
        sprite.x + Phaser.Math.Between(-12, 12),
        sprite.y + Phaser.Math.Between(-38, 4),
        0xffffff,
        Phaser.Math.FloatBetween(2.6, 4.2),
        260,
      );
    }

    return { handled: true, rageLike: true };
  }

  static drawPowerupAura({ graphics, frame, effects, nowSec, colors } = {}) {
    if (!graphics || !frame || !effects) return false;
    if ((effects.thorgRage || 0) <= 0) return false;
    const x = frame.x;
    const y = frame.y;
    const r = frame.radius;
    const pulse = 0.75 + 0.25 * Math.sin(nowSec * 8 + x * 0.01);

    const rageColor = colors?.thorgRage || 0x9333ea;
    drawPixelRing(graphics, x, y, r + 18 + 2.5 * pulse, {
      lineColor: 0xffffff,
      lineAlpha: 0.28 + 0.18 * Math.abs(Math.sin(nowSec * 18 + y * 0.02)),
      lineCells: 1,
      highlight: false,
    });
    drawPixelRing(graphics, x, y, r + 12 + 5 * pulse, {
      fillColor: rageColor,
      fillAlpha: 0.22 + 0.08 * pulse,
      lineColor: rageColor,
      lineAlpha: 0.88 * pulse,
    });
    return true;
  }

  static getEffectTickSounds() {
    return {
      thorgRage: {
        key: "pu-tick-rage",
        options: { volume: 0.24, rate: 0.78 },
      },
    };
  }

  handlePointerDown(attackContext = null) {
    const context = attackContext || this.consumeAttackContext();
    // Use the shared Thorg fall attack implementation (owner-side hits + payload)
    return this.performDefaultAttack(() =>
      performThorgFallAttack(this, context),
    );
  }

}

export default Thorg;
