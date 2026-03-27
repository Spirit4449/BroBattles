// src/characters/ninja/ninja.js
import socket from "../../socket";
import {
  characterStats,
  getCharacterTuning,
} from "../../lib/characterStats.js";
import { getResolvedCharacterAttackConfig } from "../../lib/characterTuning.js";
import ReturningShuriken from "./attack";
import { animations } from "./anim";
import {
  executeDefaultAttack,
  resolveSessionDamage,
} from "../shared/attackFlow";
import CharacterEntityBase from "../shared/characterEntityBase";
import { createRuntimeId } from "../shared/runtimeId";
import {
  getChargeRatioFromContext,
  scaleByCharge,
} from "../shared/chargeAttack";

// Single source of truth for this character's name/key
const NAME = "ninja";
const RETURNING_SHURIKEN = getResolvedCharacterAttackConfig(
  NAME,
  "returningShuriken",
);
const NINJA_TUNING = getCharacterTuning(NAME);
const NINJA_CHARGE = NINJA_TUNING.attack?.charge || {};

class Ninja extends CharacterEntityBase {
  static key = NAME;
  // Main texture key used for this character's sprite
  static textureKey = NAME;

  static sounds = {
    attack: { key: "shurikenThrow", volume: 0.5, rate: 1.3 },
    hit: { key: "shurikenHit", volume: 0.6 },
    hitWood: { key: "shurikenHitWood", volume: 0.7 },
  };

  static preload(scene, staticPath = "/assets") {
    // Load atlas and projectile/sounds
    scene.load.atlas(
      NAME,
      this.characterAssetPath(staticPath, "spritesheet.webp"),
      this.characterAssetPath(staticPath, "animations.json"),
    );
    scene.load.image(
      "shuriken",
      this.characterAssetPath(staticPath, "shuriken.webp"),
    );
    scene.load.audio(
      "shurikenThrow",
      this.characterAssetPath(staticPath, "shurikenThrow.mp3"),
    );
    scene.load.audio(
      "shurikenHit",
      this.characterAssetPath(staticPath, "hit.mp3"),
    );
    scene.load.audio(
      "shurikenHitWood",
      this.characterAssetPath(staticPath, "woodhit.wav"),
    );
  }

  static setupAnimations(scene) {
    animations(scene);
  }

  // Per-character gameplay and presentation stats
  static getStats() {
    return characterStats.ninja;
  }

  // Handle remote attack events for opponents using this character
  static handleRemoteAttack(scene, data, ownerWrapper) {
    // Support returning shuriken as emitted by local Ninja.attack()
    if (data.returning) {
      const ownerSprite = ownerWrapper ? ownerWrapper.opponent : null;
      // Play remote throw SFX for other players
      try {
        const sfx = scene.sound.add("shurikenThrow");
        sfx.setVolume(0.5); // Lower volume for remote players
        sfx.setRate(1.3);
        sfx.play();
      } catch (_) {}
      // Instantiate a non-owner returning shuriken so visuals match
      const shuriken = new ReturningShuriken(
        scene,
        { x: data.x, y: data.y },
        ownerSprite,
        {
          direction: data.direction,
          forwardDistance:
            data.forwardDistance || RETURNING_SHURIKEN.forwardDistance,
          outwardDuration:
            data.outwardDuration || RETURNING_SHURIKEN.outwardDuration,
          returnSpeed: data.returnSpeed || RETURNING_SHURIKEN.returnSpeed,
          rotationSpeed:
            data.rotationSpeed || RETURNING_SHURIKEN.rotationSpeed,
          scale: data.scale || RETURNING_SHURIKEN.scale,
          damage: data.damage,
          isOwner: false,
        },
      );
      // Remote collision intentionally omitted (owner authoritative)
      return true;
    }

    // Fallback for simple projectiles if ever used
    const key = data.weapon || "shuriken";
    if (scene.textures?.exists(key)) {
      const proj = scene.physics.add.image(data.x, data.y, key);
      proj.setScale(data.scale || 0.1);
      proj.setVelocity((data.direction || 1) * 400, 0);
      proj.setAngularVelocity(data.rotationSpeed || 600);
      proj.body.allowGravity = false;
    } else {
      // Texture not ready; skip visual to avoid null render errors
      // Optionally, could queue a retry later if needed.
    }
    return true;
  }

  constructor(deps) {
    super(deps);
  }

  // Generic/default attack flow: ammo checks, flags, UI, socket emit
  performDefaultAttack(payloadBuilder, onAfterFire) {
    const result = executeDefaultAttack({
      scene: this.scene,
      ammo: this.ammo,
      emitAction: (payload) => socket.emit("game:action", payload),
      payloadBuilder,
      onAfterFire,
      attackResetMs: 300,
    });
    return !!result.fired;
  }

  // Ninja-specific attack: spawn a returning shuriken with owner-side collisions
  handlePointerDown(attackContext) {
    const context = attackContext || this.consumeAttackContext();
    const chargeRatio = getChargeRatioFromContext(context);
    const p = this.player;
    const direction = p.flipX ? -1 : 1;

    // Prefer server-provided level-based damage; fallback to base stats
    const baseDamage = (
      (this.constructor.getStats && this.constructor.getStats()) ||
      {}
    ).baseDamage;
    const damage = resolveSessionDamage(baseDamage, 1000);

    const fired = this.performDefaultAttack(() => {
      const attackId = createRuntimeId("ninjaShuriken");
      // Play throw anim and sfx
      const sfx = this.scene.sound.add("shurikenThrow");
      sfx.setVolume(1);
      sfx.setRate(1.3);
      sfx.play();
      if (
        this.scene.anims &&
        (this.scene.anims.exists(`${NAME}-throw`) ||
          this.scene.anims.exists("throw"))
      ) {
        p.anims.play(
          this.scene.anims.exists(`${NAME}-throw`) ? `${NAME}-throw` : "throw",
          true,
        );
      }

      const config = {
        direction,
        username: this.username,
        gameId: this.gameId,
        isOwner: true,
        serverAuthoritativeHits: true,
        instanceId: attackId,
        damage,
        chargeRatio,
        rotationSpeed: RETURNING_SHURIKEN.rotationSpeed,
        forwardDistance: scaleByCharge({
          baseValue: RETURNING_SHURIKEN.forwardDistance,
          chargeRatio,
          maxScale: NINJA_CHARGE.rangeScaleMax || 1,
        }),
        arcHeight: RETURNING_SHURIKEN.arcHeight,
        outwardDuration: RETURNING_SHURIKEN.outwardDuration,
        returnSpeed: RETURNING_SHURIKEN.returnSpeed,
      };

      const returning = new ReturningShuriken(
        this.scene,
        { x: p.x, y: p.y },
        p,
        config,
      );

      // Owner-only collisions
      if (!config.serverAuthoritativeHits) {
        const enemyList = Object.values(this.opponentPlayersRef || {});
        returning.attachEnemyOverlap(enemyList);
        returning.attachMapOverlap(this.mapObjects);
      }

      // Perk: grant ammo on return
      const { grantCharge, setCanAttack, drawAmmoBar } = this.ammo;
      returning.onReturn = () => {
        grantCharge(1);
        setCanAttack(true);
        drawAmmoBar();
      };

      return {
        type: "ninja-shuriken",
        id: attackId,
        x: p.x,
        y: p.y,
        scale: config.scale || 0.1,
        damage: config.damage,
        name: this.username,
        returning: true,
        direction,
        forwardDistance: config.forwardDistance,
        outwardDuration: config.outwardDuration,
        returnSpeed: config.returnSpeed,
        rotationSpeed: config.rotationSpeed,
        chargeRatio,
      };
    });

    return fired;
  }
}

export default Ninja;
