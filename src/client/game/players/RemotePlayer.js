import { createRemoteMovementFx } from "./remoteMovementFx";
import { cancelFighterCombat } from "./fighterCombatCleanup";
import { standingBodyHeight, applyBodyFlipOffset, hudTopY } from "./playerBodyGeometry";
import { getHealth, resolveCharacterKey } from "../../../shared/characters/characterStats.js";
import { spawnRespawnEffect } from '../scene/respawnEffect';
import { spritePresentation, sizePlayerBody } from '../characters/shared/spritePresentation';
import { bindPlayerOrigin, playerAnchor } from '../characters/shared/rig';
import { applyTeamVisual, ENEMY_BODY_OVERLAY_ALPHA, isAllyTeam, TEAM_GREEN, TEAM_RED } from "../../../shared/projectilePresentation";
import { createPlayerWorldHud } from "../scene/playerWorldHud";
import { attachTeamFootRing } from "./teamFootRing";
import {
  getTextureKey,
  resolveAnimKey,
  getEffectsClass,
} from "../characters";
import { performSpecial } from "../characters/special";
import { clearAction } from "../characters/shared/animationState";
import {
  drawSuperChargeBar,
  resetSuperBarAnimation,
} from "../scene/superBarRenderer";
import {
  drawHealthBar,
  resetHealthBarAnimation,
} from "../scene/healthBarRenderer";
import {
  setStatusIconStackVisible,
} from "../scene/statusIconStack";
import { spawnDeathBurst, spawnHealthMarker, spawnSpawnBurst, spawnChromaReveal } from "../scene/effects";
import { RENDER_LAYERS } from "../scene/renderLayers";
import { playDuckTransitionSound } from "../audio/movementAudio.js";
import { playPlayerSound } from "../audio/playerAudio.js";
import { DUCK_HEIGHT_RATIO } from "../../../shared/physics/ducking.js";
import { INVISIBLE_ALPHA, invisibleAttackAlpha } from "../powerups/invisibilityReveal.js";

const OP_PLAYER_NAME_OFFSET_Y = 42;
// A fighter still loading (or who never joined) is drawn as a ghost.
const LOADING_GHOST_ALPHA = 0.6;

export default class RemotePlayer {
  constructor({ scene, character, skinId, username, team, getPlayerEffects, maxHealth = getHealth(resolveCharacterKey(character), 1) }) {
    this.scene = scene;
    this.getPlayerEffects = getPlayerEffects;
    this.character = character;
    this.skinId = String(skinId || "").trim();
    this.username = username;
    this.team = team;
    this.opMaxHealth = maxHealth;
    this.opCurrentHealth = maxHealth;
    this.opSuperCharge = 0;
    this.opMaxSuperCharge = 100;
    this.opHealthBarWidth = 52;
    this.effects = null; // per-opponent effects (e.g., Draven fire)
    this.presenceConnected = true;
    this.presenceLoaded = false;
    this._worldUiHidden = false;
    this._powerupInvisible = false;
    this._powerupStatusIcons = [];
    this._spawnPresented = false;
    this._networkSnapUntil = 0;
    this._deathPresentationActive = false;
    this._corpseRemoved = false;
    this._corpseRemovalTimer = null;
    this.movementFx = createRemoteMovementFx();
    this._hudAnchorX = null;
    this._hudAnchorY = null;
    this.createOpPlayer();
  }

  createOpPlayer() {
    // Creates the sprite
    const textureKey = getTextureKey(this.character, this.skinId);
    this.opponent = this.scene.physics.add.sprite(-100, -100, textureKey);
    this.opponent._bbCharacter = String(this.character || "").toLowerCase();
    this.opponent._bbSkinId = this.skinId;
    this.opponent._bbSkinTextureKey = textureKey;
    this.opponent._bbTeamColor = isAllyTeam(this.team) ? TEAM_GREEN : TEAM_RED;
    // Enemies carry a slight red body filter: a frame recolor in Canvas, an
    // overlay sprite in WebGL.
    const isEnemy = this.opponent._bbTeamColor === TEAM_RED;
    applyTeamVisual(this.opponent, this.opponent, isEnemy ? "body" : null);
    if (isEnemy) this._createEnemyRedOverlay();
    this.opponent.username = this.username; // Attach username for collision detection
    // Avoid first-frame pop: hide until frame/body configured and spawn applied
    this.opponent.setVisible(false);
    const presentation = spritePresentation(this.character, this.opponent.texture);
    this.bodyConfig = presentation.body;
    this.opponent.setScale(presentation.scale);
    this.opponent.setOrigin(presentation.originX, presentation.originY);
    bindPlayerOrigin(this.opponent, presentation);
    this.opponent._bbHudTopOffset = presentation.hudTopOffset;
    this.opponent.body.allowGravity = false;
    this.opponent.setCollideWorldBounds(false); // no world-bounds collision for remote visuals
    this.opponent.anims.play(
      resolveAnimKey(this.scene, this.character, "idle", "idle", this.skinId),
      true,
    );

    // Configure frame/body BEFORE computing spawn for correct initial grounding
    this.opFrame = this.opponent.frame;
    sizePlayerBody(this.opponent, this.opFrame, this.bodyConfig);
    this.applyFlipOffset();

    // Set depth so opponent renders above all map objects (bank bust graphics are at depths 7-24)
    this.opponent.setDepth(RENDER_LAYERS.PLAYER);
    attachTeamFootRing(this.scene, this.opponent, {
      isAlly: this.opponent._bbTeamColor === TEAM_GREEN,
      hidden: () => this._deathPresentationActive || this._corpseRemoved || this._worldUiHidden,
    });

    // Per-character effects: instantiate if available for this character
    const EffectsCls = getEffectsClass(this.character);
    if (EffectsCls) {
      this.effects = new EffectsCls(this.scene, this.opponent);
      this.scene.events.on("update", this._onSceneUpdate, this);
    }

    // Reveal only after the scene applies the actual spawn.
    this.opponent.setVisible(false);

    // Sets the text of the name to username
    const bodyTop = this.hudTopY();
    this._worldHud = createPlayerWorldHud(this.scene, {
      username: this.username, getPlayerEffects: this.getPlayerEffects, x: this.opponent.x, y: bodyTop - OP_PLAYER_NAME_OFFSET_Y, nameDepth: 50,
    });
    ({
      playerName: this.opPlayerName, healthText: this.opHealthText, healthBar: this.opHealthBar,
      duckShieldGlow: this.opDuckShieldGlow, duckShieldIcon: this.opDuckShieldIcon,
      superBar: this.opSuperBar, superBarBack: this.opSuperBarBack, statusIcons: this._powerupStatusIcons,
    } = this._worldHud);

    this.spectateIcon = this.scene.add.image(0, 0, "spectate-icon");
    this.spectateIcon
      .setDisplaySize(18, 13)
      .setOrigin(0, 0.5)
      .setDepth(RENDER_LAYERS.PLAYER_HUD + 4)
      .setVisible(false);
    this._isSpectated = false;

    // Initially updates health bar and name positioning
    this.updateHealthBar();
    this.updateUIPosition();
    this.setPresenceState(this.presenceConnected, this.presenceLoaded);

  }

  applyHealthUpdate(data) {
    const prevHealth = this.opCurrentHealth;
    if (typeof data.maxHealth === "number" && data.maxHealth > 0) {
      this.opMaxHealth = data.maxHealth;
      if (this.opCurrentHealth > this.opMaxHealth)
        this.opCurrentHealth = this.opMaxHealth;
    }
    this.opCurrentHealth = data.health;
    const delta = this.opCurrentHealth - prevHealth;
    if (
      delta !== 0 &&
      this.scene &&
      this.opponent &&
      this.opponent.active
    ) {
      const bodyTop = this.opponent.body
        ? this.opponent.body.y
        : this.opponent.y - this.opponent.height / 2;
      spawnHealthMarker(this.scene, this.opponent.x, bodyTop - 18, delta, {
        depth: 11,
        team: this.team,
      });
    }
    if (this.opCurrentHealth <= 0) {
      this.opCurrentHealth = 0;
      this.updateHealthBar(true);
    } else {
      this.updateHealthBar();
    }
  }

  applySuperUpdate(data) {
    this.opSuperCharge = data.charge;
    this.opMaxSuperCharge = data.maxCharge;
    this.updateHealthBar();
  }

  presentSpecial(data) {
    performSpecial(data.character, { scene: this.scene, player: this.opponent, aim: data.aim || null });
  }

  // WebGL path for the enemy red filter. A tint multiplies, so it
  // can't redden black pixels; a red-filled copy at low alpha can. Canvas uses
  // the frame recolor in applyTeamVisual instead.
  _createEnemyRedOverlay() {
    if (this.scene.game.renderer?.type !== Phaser.WEBGL) return;
    const o = this.scene.add.sprite(0, 0, this.opponent.texture.key);
    o.setTintFill(0xff2020);
    o.setVisible(false);
    this._enemyRedOverlay = o;
    this._syncEnemyRedOverlay = () => {
      const b = this.opponent;
      if (!b || !b.scene || !o.scene) return;
      const show = b.visible && b.alpha > 0;
      o.setVisible(show);
      if (!show) return;
      if (o.texture !== b.texture || o.frame !== b.frame) o.setTexture(b.texture.key, b.frame.name);
      o.setPosition(b.x, b.y).setOrigin(b.originX, b.originY).setScale(b.scaleX, b.scaleY)
        .setFlip(b.flipX, b.flipY).setRotation(b.rotation).setScrollFactor(b.scrollFactorX, b.scrollFactorY)
        .setAlpha(b.alpha * ENEMY_BODY_OVERLAY_ALPHA).setDepth(b.depth + 0.001);
    };
    this.scene.events.on("prerender", this._syncEnemyRedOverlay);
  }

  _destroyEnemyRedOverlay() {
    if (this._syncEnemyRedOverlay) this.scene?.events?.off("prerender", this._syncEnemyRedOverlay);
    this._enemyRedOverlay?.destroy();
    this._enemyRedOverlay = null;
    this._syncEnemyRedOverlay = null;
  }

  _onSceneUpdate() {
    if (this.effects && this.opponent && !this._powerupInvisible) {
      const moving = !!this.opponent.body && Math.abs(this.opponent.body.velocity.x) > 5;
      const isDead = this.opCurrentHealth <= 0;
      this.effects.update(this.scene.game.loop.delta, moving, isDead);
    }
  }

  updateMovementVfx(movementState, animationState = movementState) {
    this.movementFx.update(this, movementState, animationState);
  }

  setDucking(ducking) {
    if (!this.opponent) return;
    const nextDucking = ducking === true;
    const previousDucking = this.opponent._ducking;
    this.opponent._ducking = nextDucking;
    if (previousDucking !== nextDucking) this.resizeBodyForDuck(nextDucking);
    if (
      typeof previousDucking === "boolean" &&
      previousDucking !== nextDucking
    ) {
      playDuckTransitionSound(this.scene, nextDucking, this.opponent);
    }
  }

  // Collider height while standing, in body source units.
  standingBodyHeight() {
    return standingBodyHeight(this.opponent, this.opFrame, this.bodyConfig);
  }

  // Crouching shrinks the collider to DUCK_HEIGHT_RATIO with the feet kept in
  // place, matching the local player and the server's duck hitbox.
  resizeBodyForDuck(ducking) {
    const body = this.opponent?.body;
    if (!body || !this.opFrame) return;
    const standing = this.standingBodyHeight();
    body.setSize(body.sourceWidth, ducking ? standing * DUCK_HEIGHT_RATIO : standing, false);
    this.applyFlipOffset();
    body.updateFromGameObject?.();
    // Arcade's postUpdate moves the sprite by (position - prevFrame). Called
    // mid-frame, the move above would be applied a second time; after
    // body.reset() (respawn), which records the sprite's top-left, it was the
    // collider offset: a one-frame 70-140 px jump.
    if (body.position && body.prevFrame) {
      body.prev?.copy?.(body.position);
      body.prevFrame.copy(body.position);
    }
  }

  // Top of the world HUD (name, bars). Ducking only nudges it down slightly
  // instead of following the shrunken collider, like the local player's HUD.
  hudTopY() {
    return hudTopY(this.opponent, this.opFrame, this.bodyConfig);
  }

  applyFlipOffset() {
    applyBodyFlipOffset(this.opponent, this.opFrame, this.bodyConfig);
  }

  // Public helper to sync UI positions immediately (used after teleports/initial position set).
  // Pass { drawBars: false } when a later pass (updateHealthBars) redraws the bars this frame.
  updateUIPosition({ drawBars = true } = {}) {
    if (!this.opponent) return;
    if (this._worldUiHidden) return;
    // Anchor straight to the drawn sprite every frame, exactly like the local
    // player's HUD. Smoothing here made remote bars trail their fighter.
    this._hudAnchorX = playerAnchor(this.opponent, "top").x;
    this._hudAnchorY = this.hudTopY();
    if (this.opPlayerName) {
      this.opPlayerName.setPosition(
        this._hudAnchorX,
        this._hudAnchorY - OP_PLAYER_NAME_OFFSET_Y,
      );
    }
    if (this.spectateIcon) {
      const nameRight = this.opPlayerName
        ? this.opPlayerName.x + this.opPlayerName.displayWidth / 2
        : this._hudAnchorX;
      this.spectateIcon.setPosition(
        nameRight + 4,
        this._hudAnchorY - OP_PLAYER_NAME_OFFSET_Y + 7,
      );
    }
    if (drawBars) this.updateHealthBar(false);
  }

  setSpectated(active = false) {
    this._isSpectated = active === true;
    const shouldShow =
      this._isSpectated &&
      !!this.opponent?.active &&
      !this._corpseRemoved &&
      !this._deathPresentationActive &&
      this._spawnPresented &&
      this.presenceLoaded &&
      !this._worldUiHidden &&
      !this._powerupInvisible;
    this.spectateIcon?.setVisible(shouldShow);
    if (shouldShow) this.updateUIPosition();
  }

  // A fighter that has not finished loading is drawn as a faded ghost at its
  // server position, with faded UI: the server can still hit it.
  setPresenceState(connected, loaded) {
    if (connected === false || loaded === false) this.movementFx.resetAudio();
    this.presenceConnected = connected !== false;
    this.presenceLoaded = loaded !== false;
    const visible =
      !!this.opponent?.active &&
      !this._corpseRemoved &&
      this._spawnPresented;
    const ghost = visible && !this.presenceLoaded;
    const shouldRender = visible && this.presenceLoaded;
    const uiAlpha = ghost ? LOADING_GHOST_ALPHA : 1;
    if (this.opponent) {
      this.opponent.setVisible(shouldRender || ghost);
      this.opponent.setAlpha(
        ghost
          ? LOADING_GHOST_ALPHA
          : this._powerupInvisible ? this.invisibleAttackAlpha() : 1,
      );
    }
    if (this.opPlayerName) {
      this.opPlayerName.setVisible(
        (shouldRender || ghost) && !this._worldUiHidden && !this._powerupInvisible,
      );
      this.opPlayerName.setAlpha(uiAlpha);
    }
    this.spectateIcon?.setVisible(
      this._isSpectated &&
        shouldRender &&
        !this._worldUiHidden &&
        !this._powerupInvisible &&
        !this._deathPresentationActive,
    );
    if (this.opHealthText) {
      this.opHealthText.setVisible(
        (shouldRender || ghost) && !this._worldUiHidden && !this._powerupInvisible,
      );
      this.opHealthText.setAlpha(uiAlpha);
    }
    if (this.opHealthBar) {
      this.opHealthBar.setVisible(
        (shouldRender || ghost) && !this._worldUiHidden && !this._powerupInvisible,
      );
      this.opHealthBar.setAlpha(uiAlpha);
    }
    const showDuckShield =
      shouldRender &&
      !this._worldUiHidden &&
      !this._powerupInvisible &&
      !!this.opponent?._ducking &&
      !this._deathPresentationActive;
    this.opDuckShieldIcon?.setVisible(showDuckShield).setAlpha(1);
    this.opDuckShieldGlow?.setVisible(showDuckShield).setAlpha(0.4);
    const showStatusIcons =
      shouldRender &&
      !this._worldUiHidden &&
      !this._powerupInvisible &&
      !this._deathPresentationActive;
    if (!showStatusIcons) {
      setStatusIconStackVisible(this._powerupStatusIcons, false);
    }
    if (this.opSuperBarBack) {
      this.opSuperBarBack.setVisible(
        (shouldRender || ghost) && !this._worldUiHidden && !this._powerupInvisible,
      );
      this.opSuperBarBack.setAlpha(uiAlpha);
    }
    if (this.opSuperBar) {
      this.opSuperBar.setVisible(
        (shouldRender || ghost) && !this._worldUiHidden && !this._powerupInvisible,
      );
      this.opSuperBar.setAlpha(uiAlpha);
    }
  }

  // Attacking while invisible briefly gives away a faded silhouette.
  invisibleAttackAlpha() {
    return invisibleAttackAlpha(this.opponent?._invisibleAttackFlashAt, INVISIBLE_ALPHA.remote);
  }

  setPowerupInvisible(active = false) {
    const wasInvisible = this._powerupInvisible;
    this._powerupInvisible = active === true;
    if (this.opponent?.active) {
      this.opponent._powerupInvisible = this._powerupInvisible;
    }
    this.setPresenceState(this.presenceConnected, this.presenceLoaded);
    if (
      wasInvisible &&
      !this._powerupInvisible &&
      this.opponent?.active &&
      this.opponent.visible &&
      this.opCurrentHealth > 0 &&
      !this._deathPresentationActive
    ) {
      try {
        spawnChromaReveal(this.scene, this.opponent, { depth: 27 });
      } catch (_) {}
    }
  }

  finalizeSpawnPresentation() {
    if (!this.opponent || this._corpseRemoved) return;
    this._spawnPresented = true;
    this._networkSnapUntil = performance.now() + 220;
    if (!this._initialSpawnFxPlayed) {
      try {
        spawnSpawnBurst(this.scene, this.opponent, {
          tint: 0xffffff,
          accent: 0xb8ecff,
          depth: 27,
        });
        this._initialSpawnFxPlayed = true;
      } catch (_) {}
    }
    this.updateUIPosition();
    this.setPresenceState(this.presenceConnected, this.presenceLoaded);
  }

  updateHealthBar(dead = false, healthBarY) {
    if (!this.opHealthText || !this.opHealthText.active) return;
    if (this._worldUiHidden) {
      this.opHealthBar?.clear?.();
      this.opSuperBarBack?.clear?.();
      this.opSuperBar?.clear?.();
      return;
    }
    if (this.opCurrentHealth < 0) {
      // Prevents health from going negative
      this.opCurrentHealth = 0;
    }
    // Sets x in the center
    const hudX = Number.isFinite(Number(this._hudAnchorX))
      ? Number(this._hudAnchorX)
      : this.opponent.x;
    const healthBarX = hudX - this.opHealthBarWidth / 2;
    // Same anchor and offset as the local player's bar.
    const hudBodyTop = Number.isFinite(Number(this._hudAnchorY))
      ? Number(this._hudAnchorY)
      : this.hudTopY();
    const y =
      typeof healthBarY === "number" && !Number.isNaN(healthBarY)
        ? healthBarY
        : hudBodyTop - 20;
    if (dead === false) {
      this.opHealthText.setText(`${this.opCurrentHealth}`);
    } else {
      this.opHealthText.setText(`0`);
    }
    // Teammates should be green, opponents red
    const isTeammate = isAllyTeam(this.team);
    drawHealthBar(this.opHealthBar, {
      x: healthBarX,
      y,
      width: this.opHealthBarWidth,
      health: this.opCurrentHealth,
      maxHealth: this.opMaxHealth,
      color: isTeammate ? 0x99ab2c : 0xb24035,
      teamGlowColor: isTeammate ? TEAM_GREEN : 0xe04a4e,
    });
    this.opHealthBar.setDepth(RENDER_LAYERS.PLAYER_HUD + 1);

    this._worldHud?.layout({
      x: healthBarX, y, width: this.opHealthBarWidth, sprite: this.opponent,
      visible: !dead && this.opHealthBar.visible !== false &&
        !this._powerupInvisible && !this._deathPresentationActive && !this._corpseRemoved,
    });

    this.opHealthText.setPosition(hudX - this.opHealthText.width / 2, y - 8);
    this.opHealthText.setDepth(RENDER_LAYERS.PLAYER_HUD + 2);

    this.drawSuperBar(healthBarX, y + 11);
  }

  drawSuperBar(x, y) {
    if (!this.opSuperBar || !this.opSuperBarBack) return;
    if (this._worldUiHidden) return;
    drawSuperChargeBar(this.opSuperBar, this.opSuperBarBack, {
      x,
      y,
      charge: this.opSuperCharge,
      maxCharge: this.opMaxSuperCharge,
      player: this.opponent,
    });
  }

  hideWorldUi() {
    this._worldUiHidden = true;
    resetHealthBarAnimation(this.opHealthBar);
    resetSuperBarAnimation(this.opSuperBar, this.opponent);
    try {
      this.opPlayerName?.setVisible(false);
      this.spectateIcon?.setVisible(false);
    } catch (_) {}
    try {
      this.opHealthText?.setVisible(false);
    } catch (_) {}
    try {
      this.opHealthBar?.setVisible(false);
      this.opHealthBar?.clear?.();
    } catch (_) {}
    try {
      this.opDuckShieldIcon?.setVisible(false);
      this.opDuckShieldGlow?.setVisible(false);
    } catch (_) {}
    try {
      this.opSuperBarBack?.setVisible(false);
      this.opSuperBarBack?.clear?.();
    } catch (_) {}
    try {
      this.opSuperBar?.setVisible(false);
      this.opSuperBar?.clear?.();
    } catch (_) {}
  }

  // Death and respawn events carry the last snapshot received before them, so
  // the interpolated timeline does not undo them (see remoteLifeState).
  noteLifeEvent(meta, dead) {
    const mark = meta?.afterSnapshot;
    if (mark && Number.isFinite(mark.seq)) this._lifeEvent = { epoch: mark.epoch ?? null, afterSeq: mark.seq, dead };
  }

  startDeathPresentation(meta = {}) {
    this.noteLifeEvent(meta, true);
    this.movementFx.resetAudio();
    if (
      !this.opponent ||
      !this.opponent.active ||
      this._deathPresentationActive
    )
      return;

    this._deathPresentationActive = true;
    cancelFighterCombat(this.opponent);
    this.movementFx.reset();
    this._spawnPresented = true;
    this.opCurrentHealth = 0;
    if (Number.isFinite(meta?.x) && Number.isFinite(meta?.y)) {
      this.opponent.x = meta.x;
      this.opponent.y = meta.y;
    }
    this.hideWorldUi();

    if (this.effects) {
      this.scene.events.off("update", this._onSceneUpdate, this);
      this.effects.destroy?.();
      this.effects = null;
    }

    try {
      playPlayerSound(this.scene, this.opponent, "sfx-death", { volume: 0.11 });
    } catch (_) {}
    spawnDeathBurst(this.scene, this.opponent, {
      color: 0xff7394,
      glowColor: 0xffd4de,
    });
    try {
      this.opponent.setVelocity(0, 0);
    } catch (_) {}
    try {
      this.opponent.alpha = 1;
      this.opponent.setVisible(true);
      // Death ends any throw or special that was showing.
      clearAction?.(this.opponent);
      this.opponent.anims.play(
        resolveAnimKey(
          this.scene,
          this.character,
          "dying",
          "idle",
          this.skinId,
        ),
        true,
      );
    } catch (_) {}
    if (this.opponent.body) {
      this.opponent.body.enable = false;
    }

    this._corpseRemovalTimer?.remove?.(false);
    this._corpseRemovalTimer = this.scene.time.delayedCall(1500, () => {
      this._corpseRemovalTimer = null;
      if (!this._deathPresentationActive) return;
      if (!this.opponent) return;
      this._corpseRemoved = true;
      try {
        this.opponent.setVisible(false);
      } catch (_) {}
    });
  }

  handleRespawn(meta = {}) {
    this.noteLifeEvent(meta, false);
    this.movementFx.resetAudio();
    if (!this.opponent) return;
    this._corpseRemovalTimer?.remove?.(false);
    this._corpseRemovalTimer = null;
    this._deathPresentationActive = false;
    this._corpseRemoved = false;
    this._worldUiHidden = false;
    this._spawnPresented = true;
    this.movementFx.reset();
    this._networkSnapUntil = performance.now() + 220;
    if (typeof meta?.maxHealth === "number" && meta.maxHealth > 0) {
      this.opMaxHealth = meta.maxHealth;
    }
    if (typeof meta?.health === "number") {
      this.opCurrentHealth = meta.health;
    } else {
      this.opCurrentHealth = this.opMaxHealth;
    }
    try {
      cancelFighterCombat(this.opponent);
      if (Number.isFinite(meta?.x) && Number.isFinite(meta?.y)) {
        const serverX = Number(meta.x);
        const serverY = Number(meta.y);

        this.opponent.body?.reset?.(serverX, serverY);
      }
      this.opponent.setVelocity?.(0, 0);
      this.opponent.setVisible(true);
      this.opponent.setAlpha(1);
      this.opponent.body.enable = true;
      clearAction?.(this.opponent);
      this.opponent.anims.play(
        resolveAnimKey(this.scene, this.character, "idle", "idle", this.skinId),
        true,
      );
      this.opponent._ducking = false;
      this.resizeBodyForDuck(false);
      spawnRespawnEffect(this.scene, this.opponent, { silent: meta.kickoff === true });
    } catch (_) {}
    if (!this.effects) {
      const EffectsCls = getEffectsClass(this.character);
      if (EffectsCls) {
        this.effects = new EffectsCls(this.scene, this.opponent);
        this.scene.events.on("update", this._onSceneUpdate, this);
      }
    }
    this.setPresenceState(this.presenceConnected, this.presenceLoaded);
    this.updateUIPosition();
  }

  // Clean up method to stop any active tweens and remove sprites
  destroy() {
    this.movementFx.destroy();
    this._corpseRemovalTimer?.remove?.(false);
    this._corpseRemovalTimer = null;
    this._destroyEnemyRedOverlay();
    if (this.effects) {
      this.scene.events.off("update", this._onSceneUpdate, this);
      this.effects.destroy?.();
      this.effects = null;
    }
    if (this.opponent) {
      this.opponent.destroy();
    }
    this.spectateIcon?.destroy();
    this._worldHud?.destroy();
    this._worldHud = null;
  }
}
