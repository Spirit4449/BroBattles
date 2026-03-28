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

  static setupAnimations() {}

  static getStats() {
    return null;
  }

  static handleRemoteAttack() {
    return false;
  }

  static handleLocalAuthoritativeAttack() {
    return false;
  }

  static chooseRemoteAnimation({ animation = "idle" } = {}) {
    return animation || "idle";
  }

  static setDebugState() {}

  static applyPowerupFx() {
    return { handled: false, rageLike: false };
  }

  static drawPowerupAura() {
    return false;
  }

  static getPowerupMobilityModifier() {
    return { speedMult: 1, jumpMult: 1 };
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
  static playSound(scene, event, overrides = {}) {
    const entry = this.sounds?.[event];
    if (!entry || !scene?.sound) return false;
    const key = typeof entry === "string" ? entry : entry.key;
    if (!key) return false;
    const volume = overrides.volume ?? entry.volume ?? 1;
    const rate = overrides.rate ?? entry.rate ?? 1;
    try {
      scene.sound.play(key, { volume, rate });
      return true;
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

  attachInput() {
    // Local attack input is centrally owned by player.js so drag-aim, quick-fire,
    // and map-editor interactions all flow through one consistent lifecycle.
    return;
  }
}
