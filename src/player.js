// player.js
// NOTE: Refactored to remove circular dependency on game.js.
// socket now comes from standalone socket.js and opponentPlayers are passed into createPlayer.
import socket from "./socket";
function pdbg() {
  /* logging disabled */
}
import { lushyPeaksObjects, base, platform } from "./maps/lushyPeaks";
import {
  mangroveMeadowObjects,
  tinyPlatform1,
  tinyPlatform2,
  tinyPlatform3,
  tinyPlatform4,
  tinyPlatform5,
  tinyPlatform6,
} from "./maps/mangroveMeadow";
import {
  createFor as createCharacterFor,
  getTextureKey,
  getCharacterClassByKey,
  resolveAnimKey,
  getStats,
  getEffectsClass,
} from "./characters";
import { spawnDust, spawnHealthMarker, spawnWallKickCloud } from "./effects";
import { bindLocalSocketEvents } from "./players/localSocketEvents";
import { createLocalStateSync } from "./players/localStateSync";
// Globals
let player;
let cursors;
let keySpace; // Spacebar for jump
let keyJ; // J for attack
let canWallJump = true;
let isMoving = false;
let isJumping = false;
let isAttacking = false;
let canAttack = true;
// SFX state
let sfxWalkCooldown = 0;
let wasOnGround = false;
let wallSlideLoopSfx = null;
let wallSlideLoopPlaying = false;

let frame;

let maxHealth = 8000;
let currentHealth = 8000; // Client-side copy (display only)
let dead = false;

let healthBarWidth = 60;
let healthBar;
let healthText;
// Ammo/Cooldown bar (client-side only)
let ammoBar; // graphics
let ammoBarBack; // background graphics
let ammoBarWidth = 60;
let ammoCooldownMs = 1200; // time between shots
let ammoReloadMs = 1200; // time to reload one charge
let ammoCapacity = 1; // number of segments
let ammoCharges = 1; // current charges available
let nextFireTime = 0; // timestamp (ms) when we can fire again
let reloadTimerMs = 0; // accumulates while reloading toward ammoReloadMs
let ammoBarShakeUntil = 0;
let lastNoAmmoSfxAt = 0;

let superBar;
let superBarBack;
let superCharge = 0;
let maxSuperCharge = 100;
let keyI;
let _specialNotReadyFlash = 0; // timestamp until "not ready" red flash expires
let movementSpeedMult = 1;
let movementJumpMult = 1;

let playerName;

let indicatorTriangle;

let username;
let gameId = window.location.pathname.split("/").filter(Boolean).pop();

let scene;
// Persist the selected character so movement helpers can resolve anim keys
let currentCharacter;

let spawn;
let playersInTeam;
let spawnPlatform;
let mapObjects;
let map;
let opponentPlayersRef; // injected from game.js to avoid circular import
let dustTimer = 0;
const dustInterval = 70; // ms between dust puffs when running

// Body config and flip-offset applier hoisted for use across functions
let bodyConfig = null;
let applyFlipOffsetLocal = null;
let charEffects = null; // per-character, per-player effects handler (e.g., Draven fire)
let charCtrl = null; // active character controller instance
let disposeLocalSocketEvents = null;

const localStateSync = createLocalStateSync({
  Phaser,
  getPlayer: () => player,
  getDead: () => dead,
  setDead: (value) => {
    dead = value;
  },
  getMaxHealth: () => maxHealth,
  setMaxHealth: (value) => {
    maxHealth = value;
  },
  getCurrentHealth: () => currentHealth,
  setCurrentHealth: (value) => {
    currentHealth = value;
  },
  getSuperCharge: () => superCharge,
  setSuperCharge: (value) => {
    superCharge = value;
  },
  getMaxSuperCharge: () => maxSuperCharge,
  setMaxSuperCharge: (value) => {
    maxSuperCharge = value;
  },
  getAmmoCapacity: () => ammoCapacity,
  setAmmoCapacity: (value) => {
    ammoCapacity = value;
  },
  getAmmoCharges: () => ammoCharges,
  setAmmoCharges: (value) => {
    ammoCharges = value;
  },
  getAmmoCooldownMs: () => ammoCooldownMs,
  setAmmoCooldownMs: (value) => {
    ammoCooldownMs = value;
  },
  getAmmoReloadMs: () => ammoReloadMs,
  setAmmoReloadMs: (value) => {
    ammoReloadMs = value;
  },
  getReloadTimerMs: () => reloadTimerMs,
  setReloadTimerMs: (value) => {
    reloadTimerMs = value;
  },
  getNextFireTime: () => nextFireTime,
  setNextFireTime: (value) => {
    nextFireTime = value;
  },
  setMovementSpeedMult: (value) => {
    movementSpeedMult = value;
  },
  setMovementJumpMult: (value) => {
    movementJumpMult = value;
  },
  updateHealthBar: () => updateHealthBar(),
});

// Create player function
export function createPlayer(
  sceneParam,
  name,
  character,
  spawnPlatformParam,
  spawnParam,
  playersInTeamParam,
  mapParam,
  opponentPlayersParam,
) {
  if (disposeLocalSocketEvents) {
    try {
      disposeLocalSocketEvents();
    } catch (_) {}
    disposeLocalSocketEvents = null;
  }

  username = name;
  scene = sceneParam;
  spawn = spawnParam;
  playersInTeam = playersInTeamParam;
  spawnPlatform = spawnPlatformParam;
  map = mapParam;
  opponentPlayersRef = opponentPlayersParam;
  // Remember the chosen character for animation resolution in update loop
  currentCharacter = character;
  pdbg();
  cursors = scene.input.keyboard.createCursorKeys();
  // Bind additional keys once
  try {
    keySpace = scene.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE,
    );
    keyJ = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J);
  } catch (e) {
    // Fallback to string names if KeyCodes not available (shouldn't happen in Phaser 3)
    keySpace = scene.input.keyboard.addKey("SPACE");
    keyJ = scene.input.keyboard.addKey("J");
  }
  try {
    keyI = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.I);
  } catch (e) {
    keyI = scene.input.keyboard.addKey("I");
  }

  try {
    wallSlideLoopSfx = scene.sound?.add("sfx-sliding", {
      loop: true,
      volume: 0.3,
    });
    wallSlideLoopPlaying = false;
  } catch (_) {
    wallSlideLoopSfx = null;
    wallSlideLoopPlaying = false;
  }

  // Animations are registered globally in game.js via setupAll(scene)

  // Create player sprite using the character class factory so each class
  // owns its own texture key without duplicating it here.
  const CharCls = getCharacterClassByKey(character);
  player = CharCls
    ? CharCls.createSprite(scene)
    : scene.physics.add.sprite(-100, -100, getTextureKey(character));
  player.username = username; // Attach username for collision detection
  player.setCollideWorldBounds(true);
  player.anims.play(resolveAnimKey(scene, currentCharacter, "idle"), true); // Play idle animation
  // Hide until we've configured frame/body and spawn to avoid a mid-air first render
  player.setVisible(false);
  pdbg();

  // Apply character stats (health, ammo, sprite/body sizing)
  const stats = getStats(character);
  // Prefer server-provided per-match stats when available
  const sessionStats =
    (typeof window !== "undefined" &&
      window.__MATCH_SESSION__ &&
      window.__MATCH_SESSION__.stats) ||
    null;
  if (sessionStats && typeof sessionStats.health === "number") {
    maxHealth = sessionStats.health;
  } else if (typeof stats.baseHealth === "number") {
    maxHealth = stats.baseHealth;
  }
  currentHealth = maxHealth;
  ammoCooldownMs = stats.ammoCooldownMs ?? ammoCooldownMs;
  ammoReloadMs = stats.ammoReloadMs ?? ammoReloadMs;
  ammoCapacity = Math.max(1, stats.ammoCapacity ?? ammoCapacity);
  ammoCharges = ammoCapacity;
  nextFireTime = 0;
  reloadTimerMs = 0;
  if (stats.spriteScale && stats.spriteScale !== 1) {
    player.setScale(stats.spriteScale);
  }

  // Establish frame/body sizing BEFORE computing spawn so height math is correct
  frame = player.frame;
  const bs = (stats && stats.body) || {};
  bodyConfig = bs; // persist for use in movement function
  const widthShrink = bs.widthShrink ?? 35;
  const heightShrink = bs.heightShrink ?? 10;
  const bw = Math.max(4, frame.width - widthShrink);
  const bh = Math.max(4, frame.height - heightShrink);
  player.body.setSize(bw, bh);
  // Helper to adjust body offset when flipping
  applyFlipOffsetLocal = () => {
    if (!player || !player.body) return;
    const cfg = bodyConfig || {};
    const flipOffset = cfg.flipOffset || 0; // falsy -> 0
    const extra = player.flipX ? flipOffset : 0;
    const frameW = frame ? frame.width : player.width;
    const bodyW = player.body.width;
    const ox = frameW / 2 - bodyW / 2 + (cfg.offsetXFromHalf ?? 0) + extra;
    const oy = cfg.offsetY ?? 10;
    player.body.setOffset(ox, oy);
  };
  applyFlipOffsetLocal();

  // Listener to detect if player leaves the world bounds
  scene.events.on("update", () => {
    if (player.y > scene.physics.world.bounds.bottom + 50) {
      setTimeout(() => {
        // Request a suicide if player falls out (treat as self-hit to 99999)
        if (!dead) {
          socket.emit("hit", {
            attacker: username,
            target: username,
            damage: 99999,
            gameId,
          });
          pdbg();
        }
      }, 500);
    }
  });

  // Now that position is finalized (spawn set using body-aware math), reveal the sprite
  player.setVisible(true);

  // Frame/body already configured above prior to spawn for correct initial grounding

  // Player name text anchored to physics body top (not frame height)
  const bodyTop = player.body ? player.body.y : player.y - player.height / 2;
  playerName = scene.add.text(player.x, bodyTop - 50, username);
  playerName.setStyle({
    font: "bold 8pt Arial",
    fill: "#000000",
  });
  playerName.setOrigin(0.5, 0);

  // Health text
  healthText = scene.add.text(0, 0, "", {
    fontFamily: "Arial",
    fontSize: "10px",
    color: "#FFFFFF", // White
    stroke: "#000000", // Black
    strokeThickness: 4,
  });

  // Health bar
  healthBar = scene.add.graphics();
  // Ammo bar background & fill (render order: background, fill)
  ammoBarBack = scene.add.graphics();
  ammoBar = scene.add.graphics();
  superBarBack = scene.add.graphics();
  superBar = scene.add.graphics();

  // Triangle to show which one is the user. Dissapears when the player moves
  indicatorTriangle = scene.add.graphics();

  // Arrow above the body top so it's consistent across different frame paddings
  const triangle = new Phaser.Geom.Triangle(
    player.x,
    bodyTop - 10, // Top point
    player.x - 13,
    bodyTop - 20, // Left point
    player.x + 13,
    bodyTop - 20, // Right point
  );
  indicatorTriangle.fillStyle(0x99ab2c); // Green color
  indicatorTriangle.fillTriangleShape(triangle);

  // Character controller wiring (centralized per character)
  const ammoHooks = {
    // stats
    getAmmoCapacity: () => ammoCapacity,
    getAmmoCooldownMs: () => ammoCooldownMs,
    getAmmoReloadMs: () => ammoReloadMs,
    // state
    getCharges: () => ammoCharges,
    getNextFireTime: () => nextFireTime,
    // actions
    triggerNoAmmoFeedback: (playSound = true) => {
      const now = Date.now();
      ammoBarShakeUntil = now + 180;
      if (!playSound) return;
      if (now - lastNoAmmoSfxAt < 120) return;
      lastNoAmmoSfxAt = now;
      try {
        scene?.sound?.play("sfx-noammo", { volume: 0.2, rate: 1.06 });
      } catch (_) {}
    },
    tryConsume: () => {
      const now = Date.now();
      if (!canAttack) {
        if (ammoCharges <= 0) ammoHooks.triggerNoAmmoFeedback(true);
        else if (now < nextFireTime) ammoHooks.triggerNoAmmoFeedback(false);
        return false;
      }
      if (now < nextFireTime) {
        ammoHooks.triggerNoAmmoFeedback(false);
        return false;
      }
      if (ammoCharges <= 0) {
        ammoHooks.triggerNoAmmoFeedback(true);
        return false;
      }
      ammoCharges -= 1;
      nextFireTime = now + ammoCooldownMs;
      // start/restart reloading if not full
      if (ammoCharges < ammoCapacity && reloadTimerMs <= 0) reloadTimerMs = 0;
      return true;
    },
    grantCharge: (n = 1) => {
      ammoCharges = Math.min(ammoCapacity, ammoCharges + n);
      if (ammoCharges >= ammoCapacity) reloadTimerMs = 0;
      drawAmmoBar();
    },
    setCanAttack: (v) => (canAttack = v),
    setIsAttacking: (v) => (isAttacking = v),
    // view
    drawAmmoBar: () => drawAmmoBar(),
  };

  const ctrl = createCharacterFor(character, {
    scene,
    player,
    username,
    gameId,
    opponentPlayersRef,
    mapObjects,
    ammoHooks,
  });
  charCtrl = ctrl;
  if (ctrl && ctrl.attachInput) ctrl.attachInput();

  // Left-click → attack, Right-click → special (register once per scene)
  if (!scene._mouseCombatAttached) {
    scene._mouseCombatAttached = true;

    scene.input.on("pointerdown", (pointer) => {
      if (dead) return;
      if ((player?._movementLockedUntil || 0) > Date.now()) return;
      if (pointer.button === 2) {
        // Right-click: special ONLY — never falls through to attack
        if (superCharge >= maxSuperCharge) {
          socket.emit("game:special");
        } else {
          _specialNotReadyFlash = Date.now() + 500; // 500ms red flash on bar
        }
        return;
      }
      if (pointer.button === 0) {
        // Left-click: attack
        const dir = player && player.flipX ? -1 : 1;
        try {
          if (charCtrl && typeof charCtrl.attack === "function") {
            charCtrl.attack(dir);
          } else if (
            charCtrl &&
            typeof charCtrl.handlePointerDown === "function"
          ) {
            charCtrl.handlePointerDown();
          }
        } catch (_) {}
      }
    });

    // Prevent the browser context menu on right-click over the canvas
    scene.game.canvas.addEventListener("contextmenu", (e) =>
      e.preventDefault(),
    );
  }

  // Per-character effects: instantiate if the character provides an Effects class
  const EffectsCls = getEffectsClass(currentCharacter);
  charEffects = EffectsCls ? new EffectsCls(scene, player) : null;

  disposeLocalSocketEvents = bindLocalSocketEvents({
    socket,
    getUsername: () => username,
    getScene: () => scene,
    getPlayer: () => player,
    getCurrentCharacter: () => currentCharacter,
    getGameId: () => gameId,
    getPlayersInTeam: () => playersInTeam,
    getOpponentPlayersRef: () => opponentPlayersRef,
    resolveAnimKey,
    spawnHealthMarker,
    updateHealthBar,
    getCurrentHealth: () => currentHealth,
    setCurrentHealthValue: (value) => {
      currentHealth = value;
    },
    getMaxHealth: () => maxHealth,
    setMaxHealth: (value) => {
      maxHealth = value;
    },
    getDead: () => dead,
    setDead: (value) => {
      dead = value;
    },
    getSuperCharge: () => superCharge,
    setSuperCharge: (value) => {
      superCharge = value;
    },
    setMaxSuperCharge: (value) => {
      maxSuperCharge = value;
    },
    getWallSlideLoopSfx: () => wallSlideLoopSfx,
    getWallSlideLoopPlaying: () => wallSlideLoopPlaying,
    setWallSlideLoopPlaying: (value) => {
      wallSlideLoopPlaying = value;
    },
    onDebug: pdbg,
  });

  if (!scene._localSocketEventsCleanupBound) {
    scene._localSocketEventsCleanupBound = true;
    scene.events.once("shutdown", () => {
      if (disposeLocalSocketEvents) {
        try {
          disposeLocalSocketEvents();
        } catch (_) {}
        disposeLocalSocketEvents = null;
      }
      scene._localSocketEventsCleanupBound = false;
    });
    scene.events.once("destroy", () => {
      if (disposeLocalSocketEvents) {
        try {
          disposeLocalSocketEvents();
        } catch (_) {}
        disposeLocalSocketEvents = null;
      }
      scene._localSocketEventsCleanupBound = false;
    });
  }
}

// Function to set health of player from another file
function setCurrentHealth(damage) {
  // Deprecated: server authoritative. Kept for compatibility (no-op display update only)
  currentHealth -= damage;
  if (currentHealth < 0) currentHealth = 0;
  updateHealthBar();
}
function updateHealthBar() {
  if (currentHealth <= 0) currentHealth = 0;
  const healthPercentage = currentHealth / maxHealth;
  const displayedWidth = healthBarWidth * healthPercentage;
  pdbg();

  healthBar.clear(); // Clear the graphics before redrawing

  const healthBarX = player.x - healthBarWidth / 2;
  const bodyTop = player.body ? player.body.y : player.y - player.height / 2;
  // Always anchor to bodyTop so it doesn't jump when dead
  const y = bodyTop - 20; // just above body

  if (!dead) {
    healthText.setText(`${currentHealth}`);
  } else {
    // Show 0 instead of blank when dead
    healthText.setText(`0`);
    playerName.setPosition(player.x, playerName.y + 30);
  }

  // Draw the background rectangle with the default fill color
  healthBar.fillStyle(0x595959);
  healthBar.fillRect(healthBarX, y, healthBarWidth, 9);

  // Draw the health bar background (stroke)
  healthBar.lineStyle(3, 0x000000);
  healthBar.strokeRoundedRect(healthBarX, y, healthBarWidth, 9, 3);

  // Draw the filled part of the health bar (green)
  healthBar.fillStyle(0x99ab2c);
  healthBar.fillRoundedRect(healthBarX, y, displayedWidth, 9, 3);

  healthText.setPosition(player.x - healthText.width / 2, y - 8);
  healthText.setDepth(2);

  // Draw ammo bar underneath health (only for local player & when alive)
  drawAmmoBar(healthBarX, y + 11);
  drawSuperBar(healthBarX, y + 18);
}

function drawSuperBar(x, y) {
  if (!superBar || !superBarBack) return;
  superBarBack.clear();
  superBar.clear();

  const width = 60;
  const height = 4;

  // Background
  superBarBack.fillStyle(0x222222, 0.65);
  superBarBack.fillRect(x, y, width, height);
  superBarBack.strokeRoundedRect(x, y, width, height, 3);

  // Fill
  const percent =
    maxSuperCharge > 0
      ? Phaser.Math.Clamp(superCharge / maxSuperCharge, 0, 1)
      : 0;
  const isFlashing = Date.now() < _specialNotReadyFlash;
  if (isFlashing && percent < 1) {
    // Red flash when right-clicked while special isn't charged
    const pulse = 0.65 + 0.35 * Math.abs(Math.sin(Date.now() / 75));
    superBar.fillStyle(0xff4444, pulse);
    superBar.fillRect(x, y, width * Math.max(percent, 0.18), height);
  } else if (percent > 0) {
    const isFull = percent >= 1;

    if (isFull) {
      const time = scene.time.now;
      // Cool pulse effect: Gold glow breathing
      const glowAlpha = 0.3 + 0.3 * Math.sin(time / 200);

      // Outer glow
      superBar.fillStyle(0xffd700, glowAlpha);
      superBar.fillRect(x - 2, y - 2, width + 4, height + 4);

      // Main bar solid gold
      superBar.fillStyle(0xffd700, 1);
      superBar.fillRect(x, y, width, height);

      // White rim pulse
      superBar.lineStyle(1, 0xffffff, glowAlpha + 0.2);
      superBar.strokeRect(x, y, width, height);
    } else {
      // Charging yellow
      superBar.fillStyle(0xffff00, 1);
      superBar.fillRect(x, y, width * percent, height);
    }
  }

  superBar.setDepth(2);
  superBarBack.setDepth(1);
}

function drawAmmoBar(forcedX, forcedY) {
  if (!ammoBar || !ammoBarBack) return;
  const shakeX =
    Date.now() < ammoBarShakeUntil ? Phaser.Math.Between(-3, 3) : 0;
  const x =
    (forcedX !== undefined ? forcedX : player.x - ammoBarWidth / 2) + shakeX;
  const bodyTop = player.body ? player.body.y : player.y - player.height / 2;
  const y = forcedY !== undefined ? forcedY : bodyTop - 9; // just under health bar
  ammoBarBack.clear();
  ammoBar.clear();

  // Background
  ammoBarBack.fillStyle(0x222222, 0.65);
  ammoBarBack.fillRoundedRect(x, y, ammoBarWidth, 6, 3);
  ammoBarBack.lineStyle(2, 0x000000, 0.9);
  ammoBarBack.strokeRoundedRect(x, y, ammoBarWidth, 6, 3);

  // Draw segmented charges (like Brawl Stars)
  const gap = 2;
  const segmentWidth = (ammoBarWidth - gap * (ammoCapacity - 1)) / ammoCapacity;
  for (let i = 0; i < ammoCapacity; i++) {
    const segX = x + i * (segmentWidth + gap);
    // Determine fill for this segment
    let percent = 0;
    if (i < ammoCharges) {
      percent = 1; // full charge
    } else if (i === ammoCharges) {
      // currently reloading this segment: percent based on reload progress
      percent = Phaser.Math.Clamp(reloadTimerMs / ammoReloadMs, 0, 1);
    } else {
      percent = 0; // future segments empty
    }
    // Colors
    const emptyColor = 0x333333;
    const readyColor = 0xff4040;
    const chargingColor = 0xb32121;
    const fillColor = percent >= 1 ? readyColor : chargingColor;
    // Fill base (empty)
    ammoBar.fillStyle(emptyColor, 0.5);
    ammoBar.fillRoundedRect(segX, y, segmentWidth, 6, 2);
    // Fill current percent
    if (percent > 0) {
      ammoBar.fillStyle(fillColor, 0.95);
      ammoBar.fillRoundedRect(segX, y, segmentWidth * percent, 6, 2);
    }
  }
  ammoBar.setDepth(2);
  ammoBarBack.setDepth(1);
}

export function handlePlayerMovement(scene) {
  // Movement tuning knobs (edit to change the feel):
  // Enforce facing lock (e.g., Draven splash) BEFORE any movement logic mutates flip state
  if (player && player._lockFlip && player._lockedFlipX !== undefined) {
    if (player.flipX !== player._lockedFlipX) {
      player.flipX = player._lockedFlipX;
      if (applyFlipOffsetLocal) applyFlipOffsetLocal();
    }
  }
  // - maxSpeed: top horizontal running speed. Higher = faster.
  const maxSpeed = 260 * Math.max(0.5, movementSpeedMult || 1);
  // - accel: how fast you speed up on ground. Higher = snappier starts.
  const accel = 3500;
  // - airAccel: acceleration in air. Higher = more air control; lower = floatier.
  const airAccel = 3300;
  // - dragGround: how quickly you slow when you release input on ground.
  //   Higher = stop sooner; lower = glide longer.
  const dragGround = 1300;
  // - dragAir: subtle slowdown in air (prevents infinite drift).
  const dragAir = 200;
  // - jumpSpeed: base jump power (lower to make jumps less powerful).
  let jumpSpeed = 450; // was stronger before; keep lower for smaller hops
  // - jumpBoost: small bonus based on current horizontal speed (running jumps feel punchier).
  const jumpBoost = 10;
  // - coyoteTimeMs: grace window to jump just after leaving a ledge (more forgiving platforming).
  const coyoteTimeMs = 130;
  // - wallJumpCooldownMs: delay before another wall jump is allowed.
  const wallJumpCooldownMs = 320;
  // - wallSlideMaxFallSpeed: cap downward speed while touching a wall (slower slide).
  const wallSlideMaxFallSpeed = 160;
  // - wallKickLockMs: short window after a wall jump where opposite input is ignored
  //   so the horizontal kick isn't immediately canceled by collisions or input.
  const wallKickLockMs = 160;
  // - wallJumpGraceMs/wallJumpGracePx: allow wall jump shortly after leaving wall.
  const wallJumpGraceMs = 120;
  const wallJumpGracePx = 50;
  // - wall kick strength: small when jumping with up-only, full when up+away.
  const wallKickSmall = 150;
  const wallKickFull = 360;
  // - fallGravityFactor: gravity multiplier while falling (fast-fall). 1.0 = off.
  const fallGravityFactor = 1.35;
  // Ensure body uses our drag settings once
  if (player.body) {
    const onGround = player.body.touching.down;
    player.setDragX(onGround ? dragGround : dragAir);
    player.setMaxVelocity(maxSpeed, 1000);
  }
  // Track last grounded time for coyote jumping
  player._lastGroundTime = player.body.touching.down
    ? Date.now()
    : player._lastGroundTime || 0;

  // Keys. Player can use either arrow keys or WASD
  const keyA = scene.input.keyboard.addKey("A");
  const keyD = scene.input.keyboard.addKey("D");
  const keyW = scene.input.keyboard.addKey("W");
  let leftKey = cursors.left.isDown || keyA.isDown;
  let rightKey = cursors.right.isDown || keyD.isDown;
  let upKey = cursors.up.isDown || keyW.isDown || (keySpace && keySpace.isDown);

  const touchingWallNow =
    !!player.body.touching.left ||
    !!player.body.touching.right ||
    !!player.body.blocked.left ||
    !!player.body.blocked.right;
  const touchingLeftNow = !!player.body.touching.left || !!player.body.blocked.left;
  const touchingRightNow =
    !!player.body.touching.right || !!player.body.blocked.right;
  const nowWallTs = Date.now();
  if (touchingWallNow) {
    player._lastWallTouchTime = nowWallTs;
    player._lastWallTouchSide = touchingLeftNow ? "left" : "right";
    player._lastWallTouchX = player.x;
  }
  const wallTouchAge = nowWallTs - (player._lastWallTouchTime || 0);
  const wallTouchDx = Math.abs((player._lastWallTouchX ?? player.x) - player.x);
  const wallJumpGraceActive =
    !touchingWallNow &&
    wallTouchAge <= wallJumpGraceMs &&
    wallTouchDx <= wallJumpGracePx;
  const wallSide = touchingLeftNow
    ? "left"
    : touchingRightNow
      ? "right"
      : wallJumpGraceActive
        ? player._lastWallTouchSide
        : null;

  const nowTs = Date.now();
  const movementLocked = (player?._movementLockedUntil || 0) > nowTs;
  if (movementLocked) {
    leftKey = false;
    rightKey = false;
    upKey = false;
    if (player.body) {
      player.setAccelerationX(0);
      player.setVelocityX(0);
      player.body.allowGravity = false;
    }

    const startedAt = Number(player._dravenInfernoStartedAt || nowTs);
    const baseX = Number.isFinite(player._dravenInfernoBaseX)
      ? player._dravenInfernoBaseX
      : player.x;
    const baseY = Number.isFinite(player._dravenInfernoBaseY)
      ? player._dravenInfernoBaseY
      : player.y;
    const riseT = Phaser.Math.Clamp((nowTs - startedAt) / 320, 0, 1);
    const lift = Number(player._dravenInfernoLift || 125);
    const hoverY =
      baseY -
      lift * Phaser.Math.Easing.Cubic.Out(riseT) +
      Math.sin((nowTs - startedAt) / 120) * 8;
    player.x = baseX;
    player.y = hoverY;

    if (scene.anims?.exists("draven-special")) {
      try {
        if (player.anims?.currentAnim?.key !== "draven-special") {
          player.anims.play("draven-special", true);
        }
      } catch (_) {}
    }
  } else if (
    player &&
    player.body &&
    player._dravenInfernoPrevGravity !== undefined
  ) {
    const prevGravity =
      typeof player._dravenInfernoPrevGravity === "boolean"
        ? player._dravenInfernoPrevGravity
        : true;
    player.body.allowGravity = prevGravity;
    delete player._dravenInfernoPrevGravity;
  }

  // Fast-fall gravity: apply extra gravity only when falling (vy > 0) and airborne.
  try {
    const worldG = scene.physics?.world?.gravity?.y || 0;
    const isAirborne = !player.body.touching.down;
    const isFalling = (player.body.velocity.y || 0) > 5;
    const touchingWall =
      player.body.touching.left || player.body.touching.right;
    if (isAirborne && isFalling && !touchingWall && fallGravityFactor > 1) {
      // Additive per-body gravity so total ~= worldG * fallGravityFactor
      player.body.setGravityY(worldG * (fallGravityFactor - 1));
    } else {
      // Reset any extra gravity when not falling
      player.body.setGravityY(0);
    }
  } catch (_) {}

  // Handle attack on J (edge-triggered)
  try {
    if (keyJ && Phaser.Input.Keyboard.JustDown(keyJ) && !dead) {
      if (!((player?._movementLockedUntil || 0) > Date.now())) {
        // Prefer a unified attack(direction) if provided; otherwise fall back to pointer-based handler
        const dir = player && player.flipX ? -1 : 1;
        if (charCtrl && typeof charCtrl.attack === "function") {
          charCtrl.attack(dir);
        } else if (
          charCtrl &&
          typeof charCtrl.handlePointerDown === "function"
        ) {
          charCtrl.handlePointerDown();
        }
      }
    }
    // Handle special on I
    if (keyI && Phaser.Input.Keyboard.JustDown(keyI) && !dead) {
      if (!((player?._movementLockedUntil || 0) > Date.now())) {
        if (superCharge >= maxSuperCharge) {
          socket.emit("game:special");
        }
      }
    }
  } catch (_) {}

  // Left movement
  if (leftKey) {
    if (indicatorTriangle) {
      indicatorTriangle.clear(); // Removes indicator triangle if the player has moved
    }
    // Apply acceleration left (respect wall-kick lock)
    const lockActive = (player._wallKickLockUntil || 0) > Date.now();
    const onGround = player.body.touching.down;
    const a = onGround ? accel : airAccel;
    if (lockActive && (player.body.velocity.x || 0) > 0) {
      // Currently being kicked to the right; ignore opposite input briefly
      player.setAccelerationX(0);
    } else {
      player.setAccelerationX(-a);
    }
    player.setDragX(onGround ? dragGround : dragAir);
    const wasFlip = player.flipX;
    if (!player._lockFlip) {
      player.flipX = true; // Mirrors the body of the player
    } else if (player._lockedFlipX !== undefined) {
      player.flipX = player._lockedFlipX; // enforce locked facing
    }
    if (player.flipX !== wasFlip && applyFlipOffsetLocal)
      applyFlipOffsetLocal();
    isMoving = true; // Sets the isMoving to true
    if (player.body.touching.down && !isAttacking && !dead) {
      // If the player is not in the air or attacking or dead, it plays the running animation
      player.anims.play(
        resolveAnimKey(scene, currentCharacter, "running"),
        true,
      );
      // Footstep SFX throttled
      sfxWalkCooldown += scene.game.loop.delta;
      if (sfxWalkCooldown >= 280) {
        sfxWalkCooldown = 0;
        scene.sound.play("sfx-step", { volume: 2 });
      }
    }
    // Right movement
  } else if (rightKey) {
    if (indicatorTriangle) {
      indicatorTriangle.clear(); // Removes indicator triangle if the player has moved
    }
    const wasFlip = player.flipX;
    if (!player._lockFlip) {
      player.flipX = false; // Undo mirror
    } else if (player._lockedFlipX !== undefined) {
      player.flipX = player._lockedFlipX; // keep locked
    }
    if (player.flipX !== wasFlip && applyFlipOffsetLocal)
      applyFlipOffsetLocal();
    const onGroundRight = player.body.touching.down;
    const aRight = onGroundRight ? accel : airAccel;
    const lockActiveRight = (player._wallKickLockUntil || 0) > Date.now();
    if (lockActiveRight && (player.body.velocity.x || 0) < 0) {
      // Currently being kicked to the left; ignore opposite input briefly
      player.setAccelerationX(0);
    } else {
      player.setAccelerationX(aRight);
    }
    player.setDragX(onGroundRight ? dragGround : dragAir);
    isMoving = true; // Sets moving variable
    if (player.body.touching.down && !isAttacking && !dead) {
      // If the player is not in the air or attacking or dead, it plays the running animation
      player.anims.play(
        resolveAnimKey(scene, currentCharacter, "running"),
        true,
      );
      // Footstep SFX throttled
      sfxWalkCooldown += scene.game.loop.delta;
      if (sfxWalkCooldown >= 280) {
        sfxWalkCooldown = 0;
        scene.sound.play("sfx-step", { volume: 2 });
      }
    }
  } else {
    stopMoving(); // If no key is being pressed, it calls the stop moving function
  }

  // Jumping
  const now = Date.now();
  if (
    upKey &&
    (player.body.touching.down ||
      now - (player._lastGroundTime || 0) <= coyoteTimeMs) &&
    !dead
  ) {
    // If player is touching ground and jumping
    if (indicatorTriangle) {
      indicatorTriangle.clear(); // Removes indicator triangle if the player has jumped
    }
    // Slight jump boost when moving fast to feel snappier transitions
    const vx = Math.abs(player.body.velocity.x || 0);
    const boost = Phaser.Math.Clamp((vx / maxSpeed) * jumpBoost, 0, jumpBoost);
    jumpSpeed = (360 + boost) * Math.max(0.5, movementJumpMult || 1); // slightly higher base for a stronger jump
    jump(); // Calls jump
    scene.sound.play("sfx-jump", { volume: 3 });
  } else if (
    // Wall jump can trigger while holding up (no re-press required).
    !dead &&
    wallSide &&
    !player.body.touching.down &&
    canWallJump &&
    upKey
  ) {
    const awayPressed = wallSide === "left" ? rightKey : leftKey;
    wallJump(wallSide, awayPressed); // Calls walljump
    scene.sound.play("sfx-walljump", { volume: 4 });
  }
  if (
    !dead &&
    (touchingLeftNow || touchingRightNow) &&
    !isAttacking
  ) {
    player.anims.play(resolveAnimKey(scene, currentCharacter, "sliding"), true); // Plays sliding animation
  }

  const isWallSliding =
    !dead &&
    !player.body.touching.down &&
    (touchingLeftNow || touchingRightNow) &&
    (player.body.velocity.y || 0) > 20;
  updateWallSlideAudio(isWallSliding);

  // Wall slide: when touching a wall and airborne, limit fall speed for a slower slide
  if (
    !player.body.touching.down &&
    (touchingLeftNow || touchingRightNow)
  ) {
    if (player.body.velocity.y > wallSlideMaxFallSpeed) {
      player.setVelocityY(wallSlideMaxFallSpeed);
    }
  }

  // Check if the jump animation has completed
  if (
    !player.anims.isPlaying &&
    !player.body.touching.down &&
    !player.body.touching.left &&
    !player.body.touching.right &&
    !isAttacking
  ) {
    fall(); // Plays falling animation if the player is not touching a wall or if any other animation is playing
  }

  // If no movement animations are playing, play the 'idle' animation
  if (
    !isMoving &&
    player.body.touching.down &&
    !isJumping &&
    !isAttacking &&
    !dead
  ) {
    idle();
  }

  updateHealthBar(); // Updates the health bar after the new player position
  // Keep name anchored to body top regardless of frame padding
  const uiTop = player.body ? player.body.y : player.y - player.height / 2;
  playerName.setPosition(player.x, uiTop - 22);

  // Landing detection (transition airborne -> grounded)
  const onGround = player.body.touching.down;
  if (!wasOnGround && onGround && !dead) {
    scene.sound.play("sfx-land", { volume: 4 });
  }
  wasOnGround = onGround;
  if (onGround) player._lastGroundTime = Date.now();

  // Ammo reload tick
  if (ammoCharges < ammoCapacity) {
    reloadTimerMs += scene.game.loop.delta;
    if (reloadTimerMs >= ammoReloadMs) {
      reloadTimerMs = 0;
      ammoCharges = Math.min(ammoCapacity, ammoCharges + 1);
    }
  } else {
    reloadTimerMs = 0; // full, no reload progress
  }
  // Redraw ammo bar periodically (cheap draw)
  if (!dead) drawAmmoBar();

  // Per-character effects update (e.g., Draven fire trail)
  if (charEffects) {
    charEffects.update(scene.game.loop.delta, isMoving, dead);
  }

  dustTimer += scene.game.loop.delta;

  // Ground running dust (only while on ground & moving)
  if (
    !dead &&
    isMoving &&
    player.body.touching.down &&
    dustTimer >= dustInterval
  ) {
    dustTimer = 0;
    // Spawn at the physics body's bottom to account for per-character frame sizing
    const bodyBottom = player.body
      ? player.body.y + player.body.height
      : player.y + player.height / 2;
    const dustY = bodyBottom - 2; // slight lift to avoid z-fighting
    const dustX = player.x + (player.flipX ? -18 : 18) * 0.3;
    spawnDust(scene, dustX, dustY);
    if (Math.random() < 0.3) {
      // occasional extra puff for variability
      spawnDust(
        scene,
        dustX + Phaser.Math.Between(-6, 6),
        dustY + Phaser.Math.Between(-2, 2),
      );
    }
  }

  function stopMoving() {
    // Stop applying acceleration and let drag slow the player naturally
    player.setAccelerationX(0);
    const onGround = player.body.touching.down;
    player.setDragX(onGround ? dragGround : dragAir);
    // Maintain locked facing if an attack is forcing orientation
    if (player._lockFlip && player._lockedFlipX !== undefined) {
      player.flipX = player._lockedFlipX;
    }
    isMoving = false;
  }

  function jump() {
    if (!isAttacking) {
      player.anims.play(
        resolveAnimKey(scene, currentCharacter, "jumping"),
        true,
      );
    }
    pdbg();
    player.setVelocityY(-jumpSpeed);
    isMoving = true;
    isJumping = true;
  }

  function wallJump(wallSideParam, awayPressed) {
    updateWallSlideAudio(false);
    // More powerful wall jump using physics impulses (no tween)
    canWallJump = false;
    const fromLeft = wallSideParam === "left";
    const horizKickMag = awayPressed ? wallKickFull : wallKickSmall;
    const horizKick = fromLeft ? horizKickMag : -horizKickMag;
    const vertKick = Math.max(jumpSpeed + 30, 220); // slightly less vertical pop

    // Face away from the wall and fix body offset
    if (!player._lockFlip) {
      const wasFlip = player.flipX;
      player.flipX = !fromLeft;
      if (player.flipX !== wasFlip && applyFlipOffsetLocal)
        applyFlipOffsetLocal();
    } else if (player._lockedFlipX !== undefined) {
      // Reinforce locked facing
      if (player.flipX !== player._lockedFlipX) {
        player.flipX = player._lockedFlipX;
        if (applyFlipOffsetLocal) applyFlipOffsetLocal();
      }
    }

    // Play a jump-like animation
    if (!isAttacking) {
      player.anims.play(
        resolveAnimKey(scene, currentCharacter, "jumping"),
        true,
      );
    }
    pdbg();

    // Apply velocity impulses
    // Nudge away from the wall first so we don't remain embedded and lose the kick
    const sep = 8;

    // Visual-only kickback cloud at wall contact point.
    try {
      const body = player.body;
      const contactX = body
        ? body.x + (fromLeft ? 0 : body.width)
        : player.x + (fromLeft ? -player.width * 0.5 : player.width * 0.5);
      const contactY = body
        ? body.y + body.height * 0.62
        : player.y + player.height * 0.18;
      // direction indicates kick direction away from wall.
      spawnWallKickCloud(scene, contactX, contactY, fromLeft ? 1 : -1);
    } catch (_) {}

    player.x += fromLeft ? sep : -sep;
    player.setVelocityX(horizKick);
    player.setVelocityY(-vertKick);
    player.setDragX(dragAir);

    // Small lockout to prevent immediate re-wall-jumping
    scene.time.delayedCall(wallJumpCooldownMs, () => {
      canWallJump = true;
    });
    // During a short lock window, ignore opposite input so the kick carries
    player._wallKickLockUntil = Date.now() + wallKickLockMs;
  }

  function fall() {
    updateWallSlideAudio(false);
    if (!isAttacking) {
      player.anims.play(
        resolveAnimKey(scene, currentCharacter, "falling"),
        true,
      );
    }
    pdbg();
    isJumping = false;
  }

  function idle() {
    updateWallSlideAudio(false);
    player.anims.play(resolveAnimKey(scene, currentCharacter, "idle"), true);
    pdbg();
  }

  function updateWallSlideAudio(shouldPlay) {
    if (!wallSlideLoopSfx) return;
    if (shouldPlay) {
      if (!wallSlideLoopPlaying) {
        try {
          wallSlideLoopSfx.play();
          wallSlideLoopPlaying = true;
        } catch (_) {}
      }
      return;
    }
    if (wallSlideLoopPlaying) {
      try {
        wallSlideLoopSfx.stop();
      } catch (_) {}
      wallSlideLoopPlaying = false;
    }
  }
}

export function setSuperStats(charge, maxCharge) {
  return localStateSync.setSuperStats(charge, maxCharge);
}

export function applyAuthoritativeState(state) {
  return localStateSync.applyAuthoritativeState(state);
}

export function getAmmoSyncState() {
  return localStateSync.getAmmoSyncState();
}

export function setPowerupMobility(speedMult = 1, jumpMult = 1) {
  return localStateSync.setPowerupMobility(speedMult, jumpMult);
}

export { player, frame, currentHealth, setCurrentHealth, dead };
