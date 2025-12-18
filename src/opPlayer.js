// opplayer.js

import { base, platform } from "./maps/lushyPeaks";
import {
  getTextureKey,
  resolveAnimKey,
  getStats,
  getEffectsClass,
} from "./characters";
import { performSpecial } from "./characters/special";
import { player } from "./player";
import socket from "./socket";
import { spawnHealthMarker } from "./effects";

export default class OpPlayer {
  constructor(
    scene,
    character,
    username,
    team,
    spawnPlatform,
    spawn,
    playersInTeam,
    map
  ) {
    this.scene = scene;
    this.character = character;
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
    this.createOpPlayer();
  }

  createOpPlayer() {
    // Creates the sprite
    const textureKey = getTextureKey(this.character);
    this.opponent = this.scene.physics.add.sprite(-100, -100, textureKey);
    this.opponent.username = this.username; // Attach username for collision detection
    // Avoid first-frame pop: hide until frame/body configured and spawn applied
    this.opponent.setVisible(false);
    const stats = getStats(this.character);
    this.bodyConfig = (stats && stats.body) || {};
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
      resolveAnimKey(this.scene, this.character, "idle"),
      true
    );

    // Configure frame/body BEFORE computing spawn for correct initial grounding
    this.opFrame = this.opponent.frame;
    const bs = this.bodyConfig;
    const widthShrink = bs.widthShrink ?? 35;
    const heightShrink = bs.heightShrink ?? 10;
    this.opponent.body.setSize(
      this.opFrame.width - widthShrink,
      this.opFrame.height - heightShrink
    );
    this.applyFlipOffset();

    // Per-character effects: instantiate if available for this character
    const EffectsCls = getEffectsClass(this.character);
    if (EffectsCls) {
      this.effects = new EffectsCls(this.scene, this.opponent);
      this.scene.events.on("update", this._onSceneUpdate, this);
    }

    // Reveal only after position is finalized (spawn set and UI anchored)
    this.opponent.setVisible(true);

    // Sets the text of the name to username
    const bodyTop = this.opponent.body
      ? this.opponent.body.y
      : this.opponent.y - this.opponent.height / 2;
    this.opPlayerName = this.scene.add.text(
      this.opponent.x,
      bodyTop - 44,
      this.username
    );
    this.opPlayerName.setStyle({
      font: "bold 8pt Arial",
      fill: "#000000",
    });
    this.opPlayerName.setOrigin(0.5, 0);
    this.opPlayerName.setDepth(3); // above health text

    this.opHealthText = this.scene.add.text(0, 0, "", {
      fontFamily: "Arial",
      fontSize: "10px",
      color: "#FFFFFF",
      stroke: "#000000",
      strokeThickness: 4,
    });

    this.opHealthBar = this.scene.add.graphics();
    this.opSuperBarBack = this.scene.add.graphics();
    this.opSuperBar = this.scene.add.graphics();

    // Initially updates health bar and name positioning
    this.updateHealthBar();
    this.updateUIPosition();

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
          });
          // Play damage sound for everyone (lower volume for remote players)
          if (delta < 0) {
            try {
              // Use character-specific hit sound if available, else generic
              const charHitKey = `${this.character}-hit`;
              const key = this.scene.sound.get(charHitKey)
                ? charHitKey
                : "sfx-damage";
              // If this is NOT the local player (which it isn't, since this is OpPlayer), play at lower volume
              this.scene.sound.play(key, { volume: 0.4 });
            } catch (_) {}
          }
        }
        if (this.opCurrentHealth <= 0) {
          this.opCurrentHealth = 0;
          this.updateHealthBar(true); // show dead styling & 0
          // Stop effects if any
          if (this.effects) {
            // no explicit destroy needed, just stop updating
            this.scene.events.off("update", this._onSceneUpdate, this);
            this.effects = null;
          }
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
        performSpecial(
          data.character,
          this.scene,
          this.opponent,
          this.playersInTeam,
          [player], // Target local player
          this.username,
          null,
          false // isOwner
        );
      }
    };
    socket.on("player:special", this.specialListener);
  }

  _onSceneUpdate() {
    if (this.effects && this.opponent) {
      // Determine simple moving state: horizontal velocity or recent tweening
      const moving =
        (this.opponent.body && Math.abs(this.opponent.body.velocity.x) > 5) ||
        !!this.movementTween;
      const isDead = this.opCurrentHealth <= 0;
      this.effects.update(this.scene.game.loop.delta, moving, isDead);
    }
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
    const oy = bs.offsetY ?? 10;
    this.opponent.body.setOffset(ox, oy);
  }

  // Public helper to sync UI positions immediately (used after teleports/initial position set)
  updateUIPosition() {
    if (!this.opponent) return;
    const bodyTop = this.opponent.body
      ? this.opponent.body.y
      : this.opponent.y - this.opponent.height / 2;
    if (this.opPlayerName) {
      this.opPlayerName.setPosition(this.opponent.x, bodyTop - 44);
    }
    this.updateHealthBar(false);
  }

  updateHealthBar(dead = false, healthBarY) {
    if (!this.opHealthText || !this.opHealthText.active) return;
    if (this.opCurrentHealth < 0) {
      // Prevents health from going negative
      this.opCurrentHealth = 0;
    }
    // Sets percentage of health
    const healthPercentage = Math.max(
      0,
      Math.min(1, this.opCurrentHealth / this.opMaxHealth)
    );
    const displayedWidth = this.opHealthBarWidth * healthPercentage;

    // Clears previous health bar graphics
    this.opHealthBar.clear();

    // Sets x in the center
    const healthBarX = this.opponent.x - this.opHealthBarWidth / 2;
    // If no explicit Y provided, anchor to the sprite's body top so it doesn't jump
    const bodyTop = this.opponent.body
      ? this.opponent.body.y
      : this.opponent.y - this.opponent.height / 2;
    const y =
      typeof healthBarY === "number" && !Number.isNaN(healthBarY)
        ? healthBarY
        : bodyTop - 21;
    if (dead === false) {
      this.opHealthText.setText(`${this.opCurrentHealth}`);
    } else {
      this.opHealthText.setText(`0`);
    }
    this.opHealthBar.fillStyle(0x595959);
    this.opHealthBar.fillRect(healthBarX, y, this.opHealthBarWidth, 9);

    // Creates a black border around healthbar
    this.opHealthBar.lineStyle(3, 0x000000);
    this.opHealthBar.strokeRoundedRect(
      healthBarX,
      y,
      this.opHealthBarWidth,
      9,
      3
    );

    // Teammates should be green, opponents red
    const isTeammate =
      this.team === "teammate" || this.team === "ally" || this.team === true;
    this.opHealthBar.fillStyle(isTeammate ? 0x99ab2c : 0xbb5c39);
    this.opHealthBar.fillRoundedRect(healthBarX, y, displayedWidth, 9, 3);

    this.opHealthText.setPosition(
      this.opponent.x - this.opHealthText.width / 2,
      y - 8
    );
    this.opHealthText.setDepth(2);

    this.drawSuperBar(healthBarX, y + 11);
  }

  drawSuperBar(x, y) {
    if (!this.opSuperBar || !this.opSuperBarBack) return;
    this.opSuperBarBack.clear();
    this.opSuperBar.clear();

    const width = 60;
    const height = 4;

    // Background
    this.opSuperBarBack.fillStyle(0x222222, 0.65);
    this.opSuperBarBack.fillRect(x, y, width, height);

    // Fill
    const percent =
      this.opMaxSuperCharge > 0
        ? Phaser.Math.Clamp(this.opSuperCharge / this.opMaxSuperCharge, 0, 1)
        : 0;
    if (percent > 0) {
      const isFull = percent >= 1;

      if (isFull) {
        const time = this.scene.time.now;
        // Cool pulse effect: Gold glow breathing
        const glowAlpha = 0.3 + 0.3 * Math.sin(time / 200);

        // Outer glow
        this.opSuperBar.fillStyle(0xffd700, glowAlpha);
        this.opSuperBar.fillRect(x - 2, y - 2, width + 4, height + 4);

        // Main bar solid gold
        this.opSuperBar.fillStyle(0xffd700, 1);
        this.opSuperBar.fillRect(x, y, width, height);

        // White rim pulse
        this.opSuperBar.lineStyle(1, 0xffffff, glowAlpha + 0.2);
        this.opSuperBar.strokeRect(x, y, width, height);
      } else {
        // Charging yellow
        this.opSuperBar.fillStyle(0xffff00, 1);
        this.opSuperBar.fillRect(x, y, width * percent, height);
      }
    }

    this.opSuperBar.setDepth(2);
    this.opSuperBarBack.setDepth(1);
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
  }
}
