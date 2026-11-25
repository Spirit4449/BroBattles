import { createRemoteMovementFx } from "./remoteMovementFx";
import { cancelFighterCombat } from "./fighterCombatCleanup";
import { standingBodyHeight, applyBodyFlipOffset, hudTopY } from "./playerBodyGeometry";
import { getHealth, resolveCharacterKey } from "../../../shared/characters/characterStats.js";
import { spawnRespawnEffect } from '../scene/respawnEffect';
import { spritePresentation, sizePlayerBody } from '../characters/shared/spritePresentation';
import { bindPlayerOrigin } from '../characters/shared/rig';
import { attachEnemyBodyVisual } from "./enemyBodyVisual";
import { isAllyTeam, TEAM_GREEN, TEAM_RED } from "../../../shared/projectilePresentation";
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
  resetSuperBarAnimation,
} from "../scene/superBarRenderer";
import {
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
    if (isEnemy) attachEnemyBodyVisual(this.scene, this.opponent);
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
    this._worldHud = createPlayerWorldHud(this.scene, {
      username: this.username, getPlayerEffects: this.getPlayerEffects, role: isEnemy ? "enemy" : "ally",
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
      spawnHealthMarker(this.scene, this.opponent.x, this._worldHud.markerY(this.hudTopY()), delta, {
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
    if (drawBars) this.updateHealthBar();
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

  updateHealthBar(dead = false) {
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
    this._worldHud.draw({
      sprite: this.opponent, headY: this.hudTopY(),
      health: this.opCurrentHealth, maxHealth: this.opMaxHealth, dead,
      charge: this.opSuperCharge, maxCharge: this.opMaxSuperCharge,
      visible: !dead && this.opHealthBar.visible !== false &&
        !this._powerupInvisible && !this._deathPresentationActive && !this._corpseRemoved,
    });
    if (this.spectateIcon) {
      const name = this.opPlayerName;
      this.spectateIcon.setPosition(name.x + name.displayWidth / 2 + 4, name.y + 7);
    }
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
