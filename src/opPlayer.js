// opplayer.js

import {
  getTextureKey,
  resolveAnimKey,
  getStats,
  getEffectsClass,
} from "./characters";
import { getResolvedCharacterBodyConfig } from "./lib/characterTuning.js";
import { performSpecial } from "./characters/special";
import { player } from "./player";
import socket from "./socket";
import { drawSuperChargeBar, resetSuperBarAnimation } from "./gameScene/superBarRenderer";
import { drawHealthBar, resetHealthBarAnimation } from "./gameScene/healthBarRenderer";
import {
  MOVEMENT_VFX_CONFIG,
  spawnDeathBurst,
  spawnDirectionChangeBurst,
  spawnFastFallTrail,
  spawnHealthMarker,
  spawnJumpTakeoff,
  spawnLandingImpact,
  spawnRunDust,
  spawnSpawnBurst,
  spawnWallKickCloud,
  spawnWallSlideBurst,
  spawnWallSlideTrail,
} from "./effects";
import { RENDER_LAYERS } from "./gameScene/renderLayers";

const OP_PLAYER_NAME_OFFSET_Y = 42;
const HUD_SMOOTH_ALPHA = 0.35;
const HUD_DEADBAND_PX = 0.75;

function stabilizeHudAxis(current, target, snap = false) {
  const nextTarget = Number(target);
  if (!Number.isFinite(nextTarget)) return current;
  const currentValue = Number(current);
  if (snap || !Number.isFinite(currentValue)) return Math.round(nextTarget);
  const delta = nextTarget - currentValue;
  if (Math.abs(delta) <= HUD_DEADBAND_PX) return Math.round(currentValue);
  return Math.round(currentValue + delta * HUD_SMOOTH_ALPHA);
}

export default class OpPlayer {
  constructor(
    scene,
    character,
    skinId,
    username,
    team,
    spawnPlatform,
    spawn,
    playersInTeam,
    map,
  ) {
    this.scene = scene;
    this.character = character;
    this.skinId = String(skinId || "").trim();
    this.username = username;
    this.team = team;
    this.spawnPlatform = spawnPlatform;
    this.spawn = spawn;
    this.map = map;
    this.mapObjects;
    this.playersInTeam = playersInTeam;
    this.opMaxHealth = 8000;
    this.opCurrentHealth = 8000;
    this.opSuperCharge = 0;
    this.opMaxSuperCharge = 100;
    this.opHealthBarWidth = 60;
    this.movementTween = null; // Store reference to current movement tween
    this.effects = null; // per-opponent effects (e.g., Draven fire)
    this.presenceConnected = true;
    this.presenceLoaded = false;
    this._worldUiHidden = false;
    this._powerupInvisible = false;
    this._spawnPresented = false;
    this._networkSnapUntil = 0;
    this._deathPresentationActive = false;
    this._corpseRemoved = false;
    this._movementVfxState = null;
    this._wallSlideVfxAt = 0;
    this._runDustVfxAt = 0;
    this._fastFallVfxAt = 0;
    this._lastMovementFxSeq = null;
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
    this.opponent.username = this.username; // Attach username for collision detection
    // Avoid first-frame pop: hide until frame/body configured and spawn applied
    this.opponent.setVisible(false);
    const stats = getStats(this.character);
    this.bodyConfig = getResolvedCharacterBodyConfig(this.character);
    // Apply per-character max health for correct bar scaling
    if (stats && typeof stats.maxHealth === "number") {
      this.opMaxHealth = stats.maxHealth;
      this.opCurrentHealth = this.opMaxHealth;
    }
    if (stats.spriteScale && stats.spriteScale !== 1) {
      this.opponent.setScale(stats.spriteScale);
    }
    this.opponent.body.allowGravity = false;
    this.opponent.setCollideWorldBounds(false); // no world-bounds collision for remote visuals
    this.opponent.anims.play(
      resolveAnimKey(this.scene, this.character, "idle", "idle", this.skinId),
      true,
    );

    // Configure frame/body BEFORE computing spawn for correct initial grounding
    this.opFrame = this.opponent.frame;
    const bs = this.bodyConfig;
    const widthShrink = bs.widthShrink;
    const heightShrink = bs.heightShrink;
    this.opponent.body.setSize(
      this.opFrame.width - widthShrink,
      this.opFrame.height - heightShrink,
    );
    this.opponent.body.updateFromGameObject?.();
    this.applyFlipOffset();

    // Set depth so opponent renders above all map objects (bank bust graphics are at depths 7-24)
    this.opponent.setDepth(RENDER_LAYERS.PLAYER);

    // Per-character effects: instantiate if available for this character
    const EffectsCls = getEffectsClass(this.character);
    if (EffectsCls) {
      this.effects = new EffectsCls(this.scene, this.opponent);
      this.scene.events.on("update", this._onSceneUpdate, this);
    }

    // Reveal only after the scene applies the actual spawn.
    this.opponent.setVisible(false);

    // Sets the text of the name to username
    const bodyTop = this.opponent.body
      ? this.opponent.body.y
      : this.opponent.y - this.opponent.height / 2;
    this.opPlayerName = this.scene.add.text(
      this.opponent.x,
      bodyTop - OP_PLAYER_NAME_OFFSET_Y,
      this.username,
    );
    this.opPlayerName.setStyle({
      fontFamily: "LilitaOne-Regular",
      fontSize: "10px",
      fontStyle: "bold",
      fill: "#ffffff",
      stroke: "#000000",
      strokeThickness: 4,
    });
    this.opPlayerName.setOrigin(0.5, 0);
    this.opPlayerName.setDepth(50); // always above map objective props

    this.opHealthText = this.scene.add.text(0, 0, "", {
      fontFamily: "LilitaOne-Regular",
      fontSize: "10px",
      color: "#FFFFFF",
      stroke: "#000000",
      strokeThickness: 4,
    });

    this.opHealthBar = this.scene.add.graphics();
    this.opHealthBar.setDepth(RENDER_LAYERS.PLAYER_HUD + 1);
    this.opSuperBarBack = this.scene.add.graphics();
    this.opSuperBar = this.scene.add.graphics();

    // Initially updates health bar and name positioning
    this.updateHealthBar();
    this.updateUIPosition();
    this.setPresenceState(this.presenceConnected, this.presenceLoaded);

    // Listen for health updates for this opponent
    this.healthUpdateListener = (data) => {
      // data: { username, health, gameId }
      if (data.username === this.username) {
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
    };
    socket.on("health-update", this.healthUpdateListener);

    // Listen for super updates
    this.superUpdateListener = (data) => {
      if (data.username === this.username) {
        this.opSuperCharge = data.charge;
        this.opMaxSuperCharge = data.maxCharge;
        this.updateHealthBar();
      }
    };
    socket.on("super-update", this.superUpdateListener);

    this.specialListener = (data) => {
      if (data.username === this.username) {
        if (String(data.character || "").toLowerCase() === "wizard") {
          this._animLockUntil = performance.now() + 2200;
        }
        performSpecial(
          data.character,
          this.scene,
          this.opponent,
          this.playersInTeam,
          [player], // Target local player
          this.username,
          null,
          false, // isOwner
          data.aim || null,
        );
      }
    };
    socket.on("player:special", this.specialListener);
  }

  _onSceneUpdate() {
    if (this.effects && this.opponent && !this._powerupInvisible) {
      // Determine simple moving state: horizontal velocity or recent tweening
      const moving =
        (this.opponent.body && Math.abs(this.opponent.body.velocity.x) > 5) ||
        !!this.movementTween;
      const isDead = this.opCurrentHealth <= 0;
      this.effects.update(this.scene.game.loop.delta, moving, isDead);
    }
  }

  updateMovementVfx(movementState, animationState = movementState) {
    if (
      !this.scene?.add ||
      !this.opponent?.active ||
      !movementState ||
      this._powerupInvisible
    ) {
      return;
    }
    const grounded = !!movementState.grounded;
    const velocityY = Number(movementState.vy) || 0;
    const velocityX = Number(movementState.vx) || 0;
    const animation = String(animationState?.animation || "").toLowerCase();
    const reportedWallSide =
      movementState.wallSide === "left" || movementState.wallSide === "right"
        ? movementState.wallSide
        : movementState.flip
          ? "left"
          : "right";
    const wallSliding =
      !grounded &&
      (typeof movementState.wallSliding === "boolean"
        ? movementState.wallSliding
        : animation.includes("wallslid"));
    const body = this.opponent.body;
    const centerX = Number(body?.center?.x) || this.opponent.x;
    const bottom =
      Number(body?.bottom) ||
      this.opponent.y +
        (this.opponent.displayHeight || this.opponent.height) * 0.5;
    const bodyWidth = Number(body?.width) || this.opponent.displayWidth;
    const previous = this._movementVfxState;
    const airbornePeakBottomY = grounded
      ? null
      : Math.min(
          Number.isFinite(previous?.airbornePeakBottomY)
            ? previous.airbornePeakBottomY
            : bottom,
          bottom,
        );
    let handledNetworkFx = null;
    const movementFxSeq = Number(movementState.movementFxSeq);
    if (Number.isFinite(movementFxSeq)) {
      if (this._lastMovementFxSeq === null) {
        this._lastMovementFxSeq = movementFxSeq;
      } else if (movementFxSeq > this._lastMovementFxSeq) {
        this._lastMovementFxSeq = movementFxSeq;
        handledNetworkFx = String(movementState.movementFxType || "");

        if (handledNetworkFx === "jump") {
          spawnJumpTakeoff(this.scene, centerX, bottom - 2, {
            bodyWidth,
            velocityX,
          });
        } else if (handledNetworkFx === "land") {
          spawnLandingImpact(this.scene, centerX, bottom - 2, {
            bodyWidth,
            impactVelocity: Number(movementState.movementFxImpactVelocity) || 0,
            fallDistance: Number(movementState.movementFxFallDistance) || 0,
            cameraShake: false,
          });
        } else if (handledNetworkFx === "turn") {
          spawnDirectionChangeBurst(this.scene, centerX, bottom - 2, {
            previousDirection:
              Number(movementState.movementFxDirection) || -Math.sign(velocityX),
            speedRatio: Phaser.Math.Clamp(
              Math.abs(velocityX) / MOVEMENT_VFX_CONFIG.runSpeedReference,
              0,
              1,
            ),
          });
        } else if (handledNetworkFx === "wall-jump") {
          const eventWallSide =
            movementState.movementFxWallSide === "left" ||
            movementState.movementFxWallSide === "right"
              ? movementState.movementFxWallSide
              : reportedWallSide;
          const contactX = body
            ? body.x + (eventWallSide === "left" ? 0 : body.width)
            : centerX +
              (eventWallSide === "left" ? -bodyWidth * 0.5 : bodyWidth * 0.5);
          const contactY = body
            ? body.y + body.height * 0.62
            : this.opponent.y + 12;
          spawnWallKickCloud(
            this.scene,
            contactX,
            contactY,
            Number(movementState.movementFxDirection) < 0 ? -1 : 1,
          );
        }
      } else if (movementFxSeq < this._lastMovementFxSeq) {
        // A respawned/reconnected sender starts a fresh event sequence.
        this._lastMovementFxSeq = movementFxSeq;
      }
    }

    if (previous) {
      if (
        handledNetworkFx !== "jump" &&
        previous.grounded &&
        !grounded &&
        velocityY < -40
      ) {
        spawnJumpTakeoff(this.scene, centerX, bottom - 2, {
          bodyWidth,
          velocityX,
        });
      } else if (
        handledNetworkFx !== "land" &&
        !previous.grounded &&
        grounded
      ) {
        spawnLandingImpact(this.scene, centerX, bottom - 2, {
          bodyWidth,
          impactVelocity: Math.max(previous.airborneVelocityY, velocityY),
          fallDistance: Math.max(
            0,
            bottom -
              (Number.isFinite(previous.airbornePeakBottomY)
                ? previous.airbornePeakBottomY
                : bottom),
          ),
          cameraShake: false,
        });
      }
    }

    if (
      previous?.wallSliding &&
      !wallSliding &&
      !grounded &&
      handledNetworkFx !== "wall-jump" &&
      Math.abs(velocityX) > 220
    ) {
      const previousWallSide = previous.wallSide || "left";
      const contactX = body
        ? body.x + (previousWallSide === "left" ? 0 : body.width)
        : centerX +
          (previousWallSide === "left" ? -bodyWidth * 0.5 : bodyWidth * 0.5);
      const contactY = body
        ? body.y + body.height * 0.62
        : this.opponent.y + 12;
      spawnWallKickCloud(
        this.scene,
        contactX,
        contactY,
        velocityX < 0 ? -1 : 1,
      );
    }

    const runSpeedRatio = Phaser.Math.Clamp(
      Math.abs(velocityX) / MOVEMENT_VFX_CONFIG.runSpeedReference,
      0,
      1,
    );
    const runDirection = Math.sign(velocityX);
    const now = performance.now();
    if (grounded && runDirection !== 0 && Math.abs(velocityX) > 35) {
      if (
        previous?.grounded &&
        previous.runDirection &&
        runDirection !== previous.runDirection &&
        handledNetworkFx !== "turn" &&
        Math.abs(velocityX) >= MOVEMENT_VFX_CONFIG.directionChangeMinSpeed
      ) {
        spawnDirectionChangeBurst(this.scene, centerX, bottom - 2, {
          previousDirection: previous.runDirection,
          speedRatio: runSpeedRatio,
        });
      }
      const runInterval = Phaser.Math.Linear(
        MOVEMENT_VFX_CONFIG.runDustMaxIntervalMs,
        MOVEMENT_VFX_CONFIG.runDustMinIntervalMs,
        runSpeedRatio,
      );
      if (!this._runDustVfxAt || now - this._runDustVfxAt >= runInterval) {
        this._runDustVfxAt = now;
        spawnRunDust(this.scene, centerX - runDirection * 10, bottom - 2, {
          direction: runDirection,
          intensity: runSpeedRatio,
        });
      }
    } else {
      this._runDustVfxAt = 0;
    }

    if (
      !grounded &&
      !wallSliding &&
      velocityY >= MOVEMENT_VFX_CONFIG.fastFallStartVelocity
    ) {
      const fastFallRatio = Phaser.Math.Clamp(
        (velocityY - MOVEMENT_VFX_CONFIG.fastFallStartVelocity) /
          (MOVEMENT_VFX_CONFIG.fastFallMaxVelocity -
            MOVEMENT_VFX_CONFIG.fastFallStartVelocity),
        0,
        1,
      );
      const fastFallInterval = Phaser.Math.Linear(
        MOVEMENT_VFX_CONFIG.fastFallTrailMaxIntervalMs,
        MOVEMENT_VFX_CONFIG.fastFallTrailMinIntervalMs,
        fastFallRatio,
      );
      if (
        !this._fastFallVfxAt ||
        now - this._fastFallVfxAt >= fastFallInterval
      ) {
        this._fastFallVfxAt = now;
        spawnFastFallTrail(this.scene, this.opponent, { velocityY });
      }
    } else {
      this._fastFallVfxAt = 0;
    }

    if (wallSliding) {
      const side = reportedWallSide;
      const contactX = body
        ? body.x + (side === "left" ? 0 : body.width)
        : centerX + (side === "left" ? -bodyWidth * 0.5 : bodyWidth * 0.5);
      const contactY = body
        ? body.y + body.height * 0.68
        : this.opponent.y + 12;
      if (!previous?.wallSliding) {
        spawnWallSlideBurst(this.scene, contactX, contactY, side);
        this._wallSlideVfxAt = 0;
      }
      if (
        !this._wallSlideVfxAt ||
        now - this._wallSlideVfxAt >= MOVEMENT_VFX_CONFIG.wallTrailIntervalMs
      ) {
        this._wallSlideVfxAt = now;
        spawnWallSlideTrail(this.scene, contactX, contactY, side);
      }
    } else {
      this._wallSlideVfxAt = 0;
    }

    this._movementVfxState = {
      grounded,
      wallSliding,
      airborneVelocityY: grounded
        ? 0
        : Math.max(Number(previous?.airborneVelocityY) || 0, velocityY),
      airbornePeakBottomY,
      runDirection:
        grounded &&
        Math.abs(velocityX) < MOVEMENT_VFX_CONFIG.directionChangeMinSpeed
          ? previous?.runDirection || runDirection
          : runDirection,
      wallSide: wallSliding
        ? reportedWallSide
        : previous?.wallSide || null,
    };
  }

  // Adjust body offset depending on facing; uses optional flipOffset from body config
  applyFlipOffset() {
    if (!this.opponent || !this.opponent.body) return;
    const bs = this.bodyConfig || {};
    const flipOffset = bs.flipOffset || 0;
    const extra = this.opponent.flipX ? flipOffset : 0;
    const frameW = this.opFrame ? this.opFrame.width : this.opponent.width;
    const bodyW = this.opponent.body.width;
    const ox = frameW / 2 - bodyW / 2 + (bs.offsetXFromHalf ?? 0) + extra;
    const oy = bs.offsetY;
    this.opponent.body.setOffset(ox, oy);
  }

  // Public helper to sync UI positions immediately (used after teleports/initial position set)
  updateUIPosition() {
    if (!this.opponent) return;
    if (this._worldUiHidden) return;
    const bodyTop = this.opponent.body
      ? this.opponent.body.y
      : this.opponent.y - this.opponent.height / 2;
    const snapHud = this.opponent._spawnIntroPending === true ||
      Number(this._networkSnapUntil) > performance.now();
    this._hudAnchorX = stabilizeHudAxis(
      this._hudAnchorX,
      this.opponent.x,
      snapHud,
    );
    this._hudAnchorY = stabilizeHudAxis(this._hudAnchorY, bodyTop, snapHud);
    if (this.opPlayerName) {
      this.opPlayerName.setPosition(
        this._hudAnchorX,
        this._hudAnchorY - OP_PLAYER_NAME_OFFSET_Y,
      );
    }
    this.updateHealthBar(false);
  }

  setPresenceState(connected, loaded) {
    this.presenceConnected = connected !== false;
    this.presenceLoaded = loaded !== false;
    const shouldRender =
      !!this.opponent?.active &&
      !this._corpseRemoved &&
      this._spawnPresented &&
      this.presenceLoaded;
    if (this.opponent) {
      this.opponent.setVisible(shouldRender);
      this.opponent.setAlpha(this._powerupInvisible ? 0 : 1);
    }
    if (this.opPlayerName) {
      this.opPlayerName.setVisible(
        shouldRender && !this._worldUiHidden && !this._powerupInvisible,
      );
      this.opPlayerName.setAlpha(1);
    }
    if (this.opHealthText) {
      this.opHealthText.setVisible(
        shouldRender && !this._worldUiHidden && !this._powerupInvisible,
      );
      this.opHealthText.setAlpha(1);
    }
    if (this.opHealthBar) {
      this.opHealthBar.setVisible(
        shouldRender && !this._worldUiHidden && !this._powerupInvisible,
      );
      this.opHealthBar.setAlpha(1);
    }
    if (this.opSuperBarBack) {
      this.opSuperBarBack.setVisible(
        shouldRender && !this._worldUiHidden && !this._powerupInvisible,
      );
      this.opSuperBarBack.setAlpha(1);
    }
    if (this.opSuperBar) {
      this.opSuperBar.setVisible(
        shouldRender && !this._worldUiHidden && !this._powerupInvisible,
      );
      this.opSuperBar.setAlpha(1);
    }
  }

  setPowerupInvisible(active = false) {
    this._powerupInvisible = active === true;
    if (this.opponent?.active) {
      this.opponent._powerupInvisible = this._powerupInvisible;
    }
    this.setPresenceState(this.presenceConnected, this.presenceLoaded);
  }

  finalizeSpawnPresentation() {
    if (!this.opponent || this._corpseRemoved) return;
    this._spawnPresented = true;
    this._networkSnapUntil = performance.now() + 220;
    if (!this._initialSpawnFxPlayed && !this.opponent._spawnIntroPending) {
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
      : Math.round(this.opponent.x);
    const healthBarX = hudX - this.opHealthBarWidth / 2;
    // If no explicit Y provided, anchor to the sprite's body top so it doesn't jump
    const bodyTop = this.opponent.body
      ? this.opponent.body.y
      : this.opponent.y - this.opponent.height / 2;
    const hudBodyTop = Number.isFinite(Number(this._hudAnchorY))
      ? Number(this._hudAnchorY)
      : Math.round(bodyTop);
    const y =
      typeof healthBarY === "number" && !Number.isNaN(healthBarY)
        ? healthBarY
        : hudBodyTop - 21;
    if (dead === false) {
      this.opHealthText.setText(`${this.opCurrentHealth}`);
    } else {
      this.opHealthText.setText(`0`);
    }
    // Teammates should be green, opponents red
    const isTeammate =
      this.team === "teammate" || this.team === "ally" || this.team === true;
    drawHealthBar(this.opHealthBar, {
      x: healthBarX, y, width: this.opHealthBarWidth,
      health: this.opCurrentHealth, maxHealth: this.opMaxHealth,
      color: isTeammate ? 0x99ab2c : 0xbb5c39,
    });
    this.opHealthBar.setDepth(RENDER_LAYERS.PLAYER_HUD + 1);

    this.opHealthText.setPosition(
      hudX - this.opHealthText.width / 2,
      y - 8,
    );
    this.opHealthText.setDepth(RENDER_LAYERS.PLAYER_HUD + 2);

    this.drawSuperBar(healthBarX, y + 11);
  }

  drawSuperBar(x, y) {
    if (!this.opSuperBar || !this.opSuperBarBack) return;
    if (this._worldUiHidden) return;
    drawSuperChargeBar(this.opSuperBar, this.opSuperBarBack, {
      x, y, charge: this.opSuperCharge, maxCharge: this.opMaxSuperCharge,
      player: this.opponent,
    });
  }

  hideWorldUi() {
    this._worldUiHidden = true;
    resetHealthBarAnimation(this.opHealthBar);
    resetSuperBarAnimation(this.opSuperBar, this.opponent);
    try {
      this.opPlayerName?.setVisible(false);
    } catch (_) {}
    try {
      this.opHealthText?.setVisible(false);
    } catch (_) {}
    try {
      this.opHealthBar?.setVisible(false);
      this.opHealthBar?.clear?.();
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

  startDeathPresentation(meta = {}) {
    if (
      !this.opponent ||
      !this.opponent.active ||
      this._deathPresentationActive
    )
      return;

    this._deathPresentationActive = true;
    this._movementVfxState = null;
    this._wallSlideVfxAt = 0;
    this._runDustVfxAt = 0;
    this._fastFallVfxAt = 0;
    this._spawnPresented = true;
    this.opCurrentHealth = 0;
    if (Number.isFinite(meta?.x) && Number.isFinite(meta?.y)) {
      this.opponent.x = meta.x;
      this.opponent.y = meta.y;
    }
    this.hideWorldUi();

    if (this.movementTween) {
      try {
        this.movementTween.remove();
      } catch (_) {}
      this.movementTween = null;
    }
    if (this.effects) {
      this.scene.events.off("update", this._onSceneUpdate, this);
      this.effects = null;
    }

    try {
      this.scene.sound.play("sfx-death", { volume: 0.46 });
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

    this.scene.time.delayedCall(1500, () => {
      if (!this.opponent) return;
      this._corpseRemoved = true;
      try {
        this.opponent.setVisible(false);
      } catch (_) {}
    });
  }

  handleRespawn(meta = {}) {
    if (!this.opponent) return;
    this._deathPresentationActive = false;
    this._corpseRemoved = false;
    this._worldUiHidden = false;
    this._spawnPresented = true;
    this._movementVfxState = null;
    this._wallSlideVfxAt = 0;
    this._runDustVfxAt = 0;
    this._fastFallVfxAt = 0;
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
      if (Number.isFinite(meta?.x) && Number.isFinite(meta?.y)) {
        const serverX = Number(meta.x);
        const serverY = Number(meta.y);

        this.opponent.body?.reset?.(serverX, serverY);
      }
      this.opponent.setVelocity?.(0, 0);
      this.opponent.setVisible(true);
      this.opponent.setAlpha(1);
      this.opponent.body.enable = true;
      this.opponent.anims.play(
        resolveAnimKey(this.scene, this.character, "idle", "idle", this.skinId),
        true,
      );
      spawnSpawnBurst(this.scene, this.opponent, {
        tint: 0xffffff,
        accent: 0xb8ecff,
        depth: 27,
      });
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
    if (this.healthUpdateListener) {
      socket.off("health-update", this.healthUpdateListener);
      this.healthUpdateListener = null;
    }
    if (this.superUpdateListener) {
      socket.off("super-update", this.superUpdateListener);
      this.superUpdateListener = null;
    }
    if (this.specialListener) {
      socket.off("player:special", this.specialListener);
      this.specialListener = null;
    }
    if (this.movementTween) {
      this.movementTween.remove();
      this.movementTween = null;
    }
    if (this.effects) {
      this.scene.events.off("update", this._onSceneUpdate, this);
      this.effects = null;
    }
    if (this.opponent) {
      this.opponent.destroy();
    }
    if (this.opPlayerName) {
      this.opPlayerName.destroy();
    }
    if (this.opHealthText) {
      this.opHealthText.destroy();
    }
    if (this.opHealthBar) {
      this.opHealthBar.destroy();
    }
    if (this.opSuperBar) {
      this.opSuperBar.destroy();
    }
    if (this.opSuperBarBack) {
      this.opSuperBarBack.destroy();
    }
    if (Array.isArray(this._botColliders)) {
      for (const collider of this._botColliders) {
        try {
          collider?.destroy?.();
        } catch (_) {}
      }
      this._botColliders = [];
    }
  }
}
