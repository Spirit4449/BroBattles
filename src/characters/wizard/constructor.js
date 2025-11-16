// src/characters/wizard/constructor.js
import socket from "../../socket";
import { characterStats } from "../../lib/characterStats.js";
import { animations } from "./anim";
import { performWizardFireball, spawnWizardFireballVisual } from "./attack";

const NAME = "wizard";

class Wizard {
  static textureKey = NAME;

  static getTextureKey() {
    return Wizard.textureKey;
  }

  static preload(scene, staticPath = "/assets") {
    if (!scene?.load) return;
    scene.load.atlas(
      NAME,
      `${staticPath}/${NAME}/spritesheet.webp`,
      `${staticPath}/${NAME}/animations.json`
    );
    // Load animated fireball atlas (frames defined in fireball.json)
    scene.load.atlas(
      "wizard-fireball",
      `${staticPath}/${NAME}/fireball.webp`,
      `${staticPath}/${NAME}/fireball.json`
    );
    scene.load.audio("fireball-sound", `${staticPath}/${NAME}/fireball.mp3`);
    if (!scene.cache?.audio?.exists("wizard-impact")) {
      scene.load.audio("wizard-impact", `${staticPath}/damage.mp3`);
    }
  }

  static setupAnimations(scene) {
    animations(scene);
  }

  static getStats() {
    return characterStats.wizard;
  }

  static handleRemoteAttack(scene, data, ownerWrapper) {
    if (!data || data.type !== `${NAME}-fireball`) return false;
    const ownerSprite = ownerWrapper ? ownerWrapper.opponent : null;
    spawnWizardFireballVisual(scene, data, ownerSprite);
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
    if (!this.scene?.input) return;
    this.scene.input.on("pointerdown", this.handlePointerDown, this);
  }

  performDefaultAttack(payloadBuilder, onAfterFire) {
    const {
      getAmmoCooldownMs,
      tryConsume,
      setCanAttack,
      setIsAttacking,
      drawAmmoBar,
    } = this.ammo || {};

    if (!tryConsume || !tryConsume()) return false;
    setIsAttacking && setIsAttacking(true);
    setCanAttack && setCanAttack(false);

    const cooldown = getAmmoCooldownMs ? getAmmoCooldownMs() : 450;
    const settleDuration = Math.max(200, cooldown);
    if (this.scene?.time?.delayedCall) {
      if (setCanAttack) {
        this.scene.time.delayedCall(cooldown, () => setCanAttack(true));
      }
      this.scene.time.delayedCall(
        settleDuration,
        () => setIsAttacking && setIsAttacking(false)
      );
    } else {
      if (setCanAttack) {
        setTimeout(() => setCanAttack(true), cooldown);
      }
      setTimeout(() => setIsAttacking && setIsAttacking(false), settleDuration);
    }

    const payload =
      typeof payloadBuilder === "function" ? payloadBuilder() : null;
    if (payload) socket.emit("game:action", payload);
    if (drawAmmoBar) drawAmmoBar();
    if (typeof onAfterFire === "function") onAfterFire();
    return true;
  }

  handlePointerDown = () => {
    return this.performDefaultAttack(() => performWizardFireball(this));
  };
}

export default Wizard;
