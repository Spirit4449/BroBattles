// src/characters/ninja/ninja.js
import socket from "../../socket";
import { characterStats } from "../../lib/characterStats.js";
import ReturningShuriken from "./attack";
import { animations } from "./anim";

// Single source of truth for this character's name/key
const NAME = "ninja";

class Ninja {
  // Main texture key used for this character's sprite
  static textureKey = NAME;
  static getTextureKey() {
    return Ninja.textureKey;
  }
  static preload(scene, staticPath = "/assets") {
    // Load atlas and projectile/sounds
    scene.load.atlas(
      NAME,
      `${staticPath}/${NAME}/spritesheet.webp`,
      `${staticPath}/${NAME}/animations.json`
    );
    scene.load.image("shuriken", `${staticPath}/${NAME}/shuriken.webp`);
    scene.load.audio(
      "shurikenThrow",
      `${staticPath}/${NAME}/shurikenThrow.mp3`
    );
    scene.load.audio("shurikenHit", `${staticPath}/${NAME}/hit.mp3`);
    scene.load.audio("shurikenHitWood", `${staticPath}/${NAME}/woodhit.wav`);
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
          forwardDistance: data.forwardDistance || 500,
          outwardDuration: data.outwardDuration || 380,
          returnSpeed: data.returnSpeed || 900,
          rotationSpeed: data.rotationSpeed || 2000,
          scale: data.scale || 0.1,
          damage: data.damage,
          isOwner: false,
        }
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

  constructor({
    scene,
    player,
    username,
    gameId,
    opponentPlayersRef,
    mapObjects,
    ammoHooks,
  }) {
    this.scene = scene;
    this.player = player;
    this.username = username;
    this.gameId = gameId;
    this.opponentPlayersRef = opponentPlayersRef;
    this.mapObjects = mapObjects;
    this.ammo = ammoHooks;
  }

  attachInput() {
    this.scene.input.on("pointerdown", () => this.handlePointerDown());
  }

  // Generic/default attack flow: ammo checks, flags, UI, socket emit
  performDefaultAttack(payloadBuilder, onAfterFire) {
    const {
      getAmmoCooldownMs,
      tryConsume,
      setCanAttack,
      setIsAttacking,
      drawAmmoBar,
    } = this.ammo;

    if (!tryConsume()) return false;
    setCanAttack(false);
    setIsAttacking(true);

    const cooldown = getAmmoCooldownMs();
    this.scene.time.delayedCall(cooldown, () => setCanAttack(true));
    // Reset attacking state a bit after shot
    setTimeout(() => setIsAttacking(false), 300);

    // Build and broadcast attack payload
    const payload =
      typeof payloadBuilder === "function" ? payloadBuilder() : null;
    if (payload) socket.emit("game:action", payload);

    // Update UI
    drawAmmoBar();
    if (typeof onAfterFire === "function") onAfterFire();
    return true;
  }

  // Ninja-specific attack: spawn a returning shuriken with owner-side collisions
  handlePointerDown() {
    const p = this.player;
    const direction = p.flipX ? -1 : 1;

    // Prefer server-provided level-based damage; fallback to base stats
    const session = (window && window.__MATCH_SESSION__) || {};
    const damage =
      (session.stats && typeof session.stats.damage === "number"
        ? session.stats.damage
        : ((this.constructor.getStats && this.constructor.getStats()) || {})
            .baseDamage) || 1000;

    const fired = this.performDefaultAttack(() => {
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
          true
        );
      }

      const config = {
        direction,
        username: this.username,
        gameId: this.gameId,
        isOwner: true,
        damage,
        rotationSpeed: 2000,
        forwardDistance: 500,
        arcHeight: 160,
        outwardDuration: 380,
        returnSpeed: 900,
      };

      const returning = new ReturningShuriken(
        this.scene,
        { x: p.x, y: p.y },
        p,
        config
      );

      // Owner-only collisions
      const enemyList = Object.values(this.opponentPlayersRef || {});
      returning.attachEnemyOverlap(enemyList);
      returning.attachMapOverlap(this.mapObjects);

      // Perk: grant ammo on return
      const { grantCharge, setCanAttack, drawAmmoBar } = this.ammo;
      returning.onReturn = () => {
        grantCharge(1);
        setCanAttack(true);
        drawAmmoBar();
      };

      return {
        type: "ninja-shuriken",
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
      };
    });

    return fired;
  }
}

export default Ninja;
