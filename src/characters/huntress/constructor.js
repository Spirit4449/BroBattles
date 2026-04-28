import socket from "../../socket";
import { characterStats } from "../../lib/characterStats.js";
import { animations } from "./anim";
import {
  changeDebugState,
  performHuntressArrowSpread,
  spawnHuntressArrowVisual,
  stopHuntressArrowOnConfirmedHit,
} from "./attack";
import { executeDefaultAttack } from "../shared/attackFlow";
import CharacterEntityBase from "../shared/characterEntityBase";

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
      this.characterAssetPath(staticPath, "burn-tick.mp3"),
    );
  }

  static setupAnimations(scene) {
    animations(scene);
  }

  static setDebugState(enabled) {
    changeDebugState(enabled);
  }

  static getStats() {
    return characterStats.huntress;
  }

  static handleRemoteAttack(scene, data, ownerWrapper, remoteContext = {}) {
    if (!data) return false;
    const ownerSprite = ownerWrapper ? ownerWrapper.opponent : null;
    const type = String(data.type || "").toLowerCase();
    if (
      type === "character-hit-confirm" &&
      String(data?.attackType || "").toLowerCase().startsWith(`${NAME}-`)
    ) {
      return stopHuntressArrowOnConfirmedHit(
        data?.instanceId,
        remoteContext?.targetSprite || null,
        remoteContext?.targetUsername || data?.target || "",
      );
    }
    if (type === `${NAME}-arrow`) {
      try {
        if (ownerSprite?.anims) {
          if (scene.anims?.exists(`${NAME}-throw`)) {
            ownerSprite.anims.play(`${NAME}-throw`, true);
          }
        }
      } catch (_) {}
      return true;
    }
    if (type === `${NAME}-arrow-release` || type === `${NAME}-burning-arrow`) {
      try {
        if (ownerSprite?.anims) {
          const animKey =
            type === `${NAME}-burning-arrow`
              ? `${NAME}-special`
              : `${NAME}-throw`;
          if (scene.anims?.exists(animKey))
            ownerSprite.anims.play(animKey, true);
        }
      } catch (_) {}
      spawnHuntressArrowVisual(scene, data, ownerSprite, {
        mapObjects: Array.isArray(scene?._mapObjects) ? scene._mapObjects : [],
        opponentPlayersRef: remoteContext?.opponentPlayersRef || {},
        teamPlayersRef: remoteContext?.teamPlayersRef || {},
        localPlayer: remoteContext?.localPlayer || null,
        localUsername: remoteContext?.localUsername || "",
        attackerUsername: remoteContext?.attackerUsername || "",
        attackerTeam: remoteContext?.attackerTeam || "",
        players: remoteContext?.players || [],
      });
      return true;
    }
    return false;
  }

  static handleLocalAuthoritativeAttack(scene, data, localContext = {}) {
    const type = String(data?.type || "").toLowerCase();
    if (type !== `${NAME}-arrow-release` && type !== `${NAME}-burning-arrow`) {
      return false;
    }
    spawnHuntressArrowVisual(scene, data, localContext?.ownerSprite || null, {
      mapObjects: Array.isArray(scene?._mapObjects) ? scene._mapObjects : [],
      targetSprites: Object.entries(localContext?.opponentPlayersRef || {})
        .map(([username, entry]) =>
          entry?.opponent ? { sprite: entry.opponent, username } : null,
        )
        .filter(Boolean),
      isOwner: true,
      username: String(localContext?.username || "").trim(),
    });
    return true;
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
      emitAction: (payload) => socket.emit("game:action", payload),
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
