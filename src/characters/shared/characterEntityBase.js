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
  }

  attachInput() {
    if (!this.scene?.input || typeof this.handlePointerDown !== "function")
      return;
    this.scene.input.on("pointerdown", () => this.handlePointerDown());
  }
}
