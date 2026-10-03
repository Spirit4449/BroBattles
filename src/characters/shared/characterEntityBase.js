import socket from "../../socket";
import { characterStats } from "../../shared/characterStats.js";
import { chooseRemoteAnimationState } from "./animationState";
import { executeDefaultAttack } from "./attackFlow";
import { playPlayerSound } from "../../gameScene/playerAudio";

/**
 * Base for browser character classes registered in ../manifest.js.
 *
 * Data (stats, tuning, aim, presentation knobs) lives in
 * src/shared/characters/<key>.json. A subclass declares `key`, its assets in
 * `preload`, its animations, and overrides only the hooks its kit needs:
 *   - attackFlow / emitAttackAction / handlePointerDown: local basic attack
 *   - handleRemoteAttack / handleLocalAuthoritativeAttack: action playback
 *   - handleActionTargetingLocalPlayer: effects applied to the local player
 *   - socketEvents: character-owned match socket events
 *   - setupSkinAnimations: skins whose atlases need their own animations
 *   - applyPowerupFx / drawPowerupAura / getEffectTickSounds: effect visuals
 */
export default class CharacterEntityBase {
  static key = "unknown";
  static textureKey = "sprite";

  static getTextureKey() {
    return this.textureKey || this.key || "sprite";
  }

  static characterAssetPath(staticPath = "/assets", fileName = "") {
    return `${staticPath}/${this.key}/${fileName}`;
  }

  static preload() {}

  /** Loads the character's base atlas unless a skin atlas replaces it. */
  static loadBaseAtlas(scene, staticPath = "/assets", options = {}) {
    if (options?.includeBaseAtlas === false) return;
    scene.load.atlas(
      this.key,
      this.characterAssetPath(staticPath, "spritesheet.webp"),
      this.characterAssetPath(staticPath, "animations.json"),
    );
  }

  /** Queues `{ image: { key: file }, audio: { key: file } }` from this character's folder. */
  static loadFiles(scene, staticPath = "/assets", { image = {}, audio = {} } = {}) {
    for (const [key, file] of Object.entries(image)) {
      scene.load.image(key, this.characterAssetPath(staticPath, file));
    }
    for (const [key, file] of Object.entries(audio)) {
      scene.load.audio(key, this.characterAssetPath(staticPath, file));
    }
  }

  static setupAnimations() {}

  /**
   * Builds animations for a skin texture. Return true when handled; otherwise
   * the base animations are cloned onto the skin's frames.
   */
  static setupSkinAnimations() {
    return false;
  }

  static getStats() {
    return characterStats[this.key] || null;
  }

  /**
   * Character-owned match socket events: { event: (context, payload) => void }.
   * The match coordinator binds them for the match lifetime; `context` exposes
   * { scene, findSprite(name) }.
   */
  static socketEvents = {};

  /**
   * Called for every action packet so a kit can affect the local player when
   * it is the target (e.g. Gloop's hook pull). Return true when handled.
   */
  static handleActionTargetingLocalPlayer() {
    return false;
  }

  /**
   * Called every local movement frame with { locked, now }, where `locked`
   * means an ability (player._movementLockedUntil) holds the fighter in place.
   */
  static updateMovementLock() {}

  static handleRemoteAttack() {
    return false;
  }

  static handleLocalAuthoritativeAttack() {
    return false;
  }

  static chooseRemoteAnimation(context = {}) {
    return chooseRemoteAnimationState({ ...context, character: this.key });
  }

  static setDebugState() {}

  static applyPowerupFx() {
    return { handled: false, rageLike: false };
  }

  static drawPowerupAura() {
    return false;
  }

  static getEffectTickSounds() {
    return {};
  }

  /**
   * Declarative sound table. Override per character:
   *   static sounds = {
   *     attack:  { key: "sfx-key", volume: 0.5, rate: 1.0 },
   *     hit:     { key: "sfx-hit",  volume: 0.8 },
   *     special: { key: "sfx-special", volume: 0.6 },
   *   };
   */
  static sounds = {};

  /**
   * Play a logical sound event using this class's sounds table.
   * Accepts optional overrides for volume/rate.
   */
  static playSound(scene, event, overrides = {}, source = null) {
    const entry = this.sounds?.[event];
    if (!entry || !scene?.sound) return false;
    const key = typeof entry === "string" ? entry : entry.key;
    if (!key) return false;
    const volume = overrides.volume ?? entry.volume ?? 1;
    const rate = overrides.rate ?? entry.rate ?? 1;
    try {
      if (source) return playPlayerSound(scene, source, key, { volume, rate });
      return scene.sound.play(key, { volume, rate });
    } catch (_) {
      return false;
    }
  }

  /**
   * Create and return the physics sprite for this character.
   * Called by player.js instead of manually building the sprite.
   */
  static createSprite(scene, x = -100, y = -100) {
    return scene.physics.add.sprite(x, y, this.getTextureKey());
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
    this._pendingAttackContext = null;
  }

  setAttackContext(context) {
    this._pendingAttackContext = context || null;
  }

  consumeAttackContext() {
    const context = this._pendingAttackContext || null;
    this._pendingAttackContext = null;
    return context;
  }

  attack(direction, context) {
    if (!this.player) return false;
    if (direction === -1 || direction === 1) {
      this.player.flipX = direction < 0;
    }
    this.setAttackContext(context);
    if (typeof this.handlePointerDown === "function") {
      return this.handlePointerDown(context);
    }
    return false;
  }

  /**
   * Basic-attack timing: { attackResetMs, cooldownFallbackMs, clearOnAnimation }.
   * `clearOnAnimation` ({ safetyMs, fallbackFrameRate, bufferMs, noAnimationMs })
   * keeps the attack flag until the throw/attack animation finishes.
   */
  static attackFlow = {};

  emitAttackAction(payload) {
    socket.emit("game:action", payload);
  }

  performDefaultAttack(payloadBuilder, onAfterFire) {
    const flow = this.constructor.attackFlow || {};
    const result = executeDefaultAttack({
      scene: this.scene,
      ammo: this.ammo,
      emitAction: (payload) => this.emitAttackAction(payload),
      payloadBuilder,
      onAfterFire,
      attackResetMs: flow.attackResetMs,
      cooldownFallbackMs: flow.cooldownFallbackMs,
    });
    if (!result.fired) return false;
    if (flow.clearOnAnimation) this.clearAttackAfterAnimation(result.clearAttack, flow.clearOnAnimation);
    return true;
  }

  // Clears the attack flag when the current attack animation completes, with
  // an estimate and a safety timeout in case the animation is interrupted.
  clearAttackAfterAnimation(clear, { safetyMs, fallbackFrameRate, bufferMs, noAnimationMs }) {
    this.scene.time.delayedCall(safetyMs, clear);
    try {
      const sprite = this.player;
      const currentAnim = sprite?.anims?.currentAnim || null;
      if (currentAnim && /throw|attack/i.test(currentAnim.key)) {
        const key = currentAnim.key;
        const frameRate = currentAnim.frameRate || fallbackFrameRate;
        const frameCount = currentAnim.frames?.length || frameRate;
        const estimateMs = (frameCount / Math.max(1, frameRate)) * 1000 + bufferMs;
        this.scene.time.delayedCall(Math.min(estimateMs, 1200), clear);
        sprite.once("animationcomplete", (anim) => {
          if (anim && anim.key === key) clear();
        });
      } else {
        this.scene.time.delayedCall(noAnimationMs, clear);
      }
    } catch (_) {}
  }

  attachInput() {
    // Local attack input is centrally owned by player.js so drag-aim, quick-fire,
    // and map-editor interactions all flow through one consistent lifecycle.
    return;
  }
}
