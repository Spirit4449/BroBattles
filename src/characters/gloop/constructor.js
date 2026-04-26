import socket from "../../socket";
import { characterStats } from "../../lib/characterStats.js";
import { animations } from "./anim";
import {
  changeDebugState,
  performGloopSlimeball,
  spawnGloopSlimeballVisual,
} from "./attack";
import { playHookAction, playHookCatchAction } from "./special";
import { executeDefaultAttack } from "../shared/attackFlow";
import CharacterEntityBase from "../shared/characterEntityBase";

const NAME = "gloop";

function consumeGloopRelease(scene, packetId) {
  const id = String(packetId || "").trim();
  if (!id) return true;
  if (!scene._gloopReleaseSeen) {
    scene._gloopReleaseSeen = new Map();
  }
  const now = Date.now();
  for (const [key, seenAt] of scene._gloopReleaseSeen.entries()) {
    if (now - seenAt > 5000) scene._gloopReleaseSeen.delete(key);
  }
  if (scene._gloopReleaseSeen.has(id)) return false;
  scene._gloopReleaseSeen.set(id, now);
  return true;
}

function playOwnerThrow(scene, sprite) {
  if (!scene?.anims || !sprite?.anims) return;
  try {
    if (scene.anims.exists(`${NAME}-throw`)) {
      sprite.anims.play(`${NAME}-throw`, true);
    } else if (scene.anims.exists(`${NAME}-special`)) {
      sprite.anims.play(`${NAME}-special`, true);
    }
  } catch (_) {}
}

class Gloop extends CharacterEntityBase {
  static key = NAME;
  static textureKey = NAME;

  static sounds = {
    attack: { key: `${NAME}-attack`, volume: 0.58 },
    hit: { key: `${NAME}-hit`, volume: 0.5 },
    special: { key: `${NAME}-special`, volume: 0.62 },
    pull: { key: `${NAME}-pull`, volume: 0.54 },
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
      `${NAME}-slimeball`,
      this.characterAssetPath(staticPath, "slimeball.webp"),
    );
    scene.load.atlas(
      `${NAME}-slimeball-attack`,
      this.characterAssetPath(staticPath, "attack.webp"),
      this.characterAssetPath(staticPath, "attack.json"),
    );
    scene.load.image(
      `${NAME}-hand`,
      this.characterAssetPath(staticPath, "hand.webp"),
    );
    scene.load.image(
      `${NAME}-hand-open`,
      this.characterAssetPath(staticPath, "openHand.webp"),
    );
    scene.load.image(
      `${NAME}-hand-closed`,
      this.characterAssetPath(staticPath, "closedHand.webp"),
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
      `${NAME}-pull`,
      this.characterAssetPath(staticPath, "pull.mp3"),
    );
  }

  static setupAnimations(scene) {
    animations(scene);
  }

  static setDebugState(enabled) {
    changeDebugState(enabled);
  }

  static getStats() {
    return characterStats.gloop;
  }

  static handleRemoteAttack(scene, data, ownerWrapper) {
    if (!data) return false;
    const ownerSprite = ownerWrapper ? ownerWrapper.opponent : null;
    const type = String(data.type || "").toLowerCase();
    if (type === `${NAME}-slimeball`) {
      playOwnerThrow(scene, ownerSprite);
      return true;
    }
    if (type === `${NAME}-slimeball-release`) {
      if (!consumeGloopRelease(scene, data.id)) return true;
      spawnGloopSlimeballVisual(scene, data, ownerSprite);
      return true;
    }
    if (type === `${NAME}-hook-release`) {
      playOwnerThrow(scene, ownerSprite);
      playHookAction(scene, ownerSprite, data, false);
      return true;
    }
    if (type === `${NAME}-hook-catch`) {
      playHookCatchAction(scene, ownerSprite, data, false);
      return true;
    }
    return false;
  }

  static handleLocalAuthoritativeAttack(scene, data, localContext = {}) {
    const type = String(data?.type || "").toLowerCase();
    const ownerSprite = localContext?.ownerSprite || null;
    if (type === `${NAME}-slimeball-release`) {
      if (!consumeGloopRelease(scene, data.id)) return true;
      spawnGloopSlimeballVisual(scene, data, ownerSprite);
      return true;
    }
    if (type === `${NAME}-hook-release`) {
      playOwnerThrow(scene, ownerSprite);
      playHookAction(scene, ownerSprite, data, true);
      return true;
    }
    if (type === `${NAME}-hook-catch`) {
      playHookCatchAction(scene, ownerSprite, data, true);
      return true;
    }
    return false;
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

    // Keep base scale under rage so the physics body remains stable on platforms.
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
        3.7,
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
      emitAction: (payload) => socket.emit("game:action", payload),
      payloadBuilder,
      onAfterFire,
      attackResetMs: 760,
      cooldownFallbackMs: 400,
    });
    return !!result.fired;
  }

  handlePointerDown = (attackContext = null) => {
    const context = attackContext || this.consumeAttackContext();
    return this.performDefaultAttack(() =>
      performGloopSlimeball(this, context),
    );
  };
}

export default Gloop;
