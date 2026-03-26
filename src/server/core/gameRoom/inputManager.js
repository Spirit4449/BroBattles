const {
  WORLD_BOUNDS,
  POSITION_HISTORY_DEPTH,
  MOVE_PLAUSIBLE_SPEED_H,
  MOVE_PLAUSIBLE_SPEED_V,
  MOVE_PLAUSIBLE_LAG_PAD_H,
  MOVE_PLAUSIBLE_LAG_PAD_V,
} = require("../gameRoomConfig");
const { isMovementSuppressed } = require("./abilityRuntimeManager");
const netTestLogger = require("./netTestLogger");

function handlePlayerInput(room, socketId, inputData) {
  const playerData = room.players.get(socketId);
  if (!playerData || !playerData.isAlive || playerData.connected === false) {
    return;
  }

  if (!inputData || typeof inputData !== "object") return;

  const now = Date.now();
  const infernoActive = isMovementSuppressed(playerData, now);

  if (infernoActive) {
    if (inputData.loaded === true) playerData.loaded = true;
    if (typeof inputData.animation === "string") {
      playerData.animation = inputData.animation;
    }
    if (Number.isFinite(Number(inputData.vx))) {
      playerData.vx = Number(inputData.vx);
    }
    if (Number.isFinite(Number(inputData.vy))) {
      playerData.vy = Number(inputData.vy);
    }
    if (typeof inputData.grounded === "boolean") {
      playerData.grounded = inputData.grounded;
    }
    playerData._lastPositionPacketAt = now;
    playerData.lastInput = now;
    return;
  }

  if (
    typeof inputData.x === "number" &&
    typeof inputData.y === "number" &&
    Number.isFinite(inputData.x) &&
    Number.isFinite(inputData.y)
  ) {
    const prevInputX = Number(playerData.x);
    const prevInputY = Number(playerData.y);
    const minX = -WORLD_BOUNDS.margin;
    const maxX = WORLD_BOUNDS.width + WORLD_BOUNDS.margin;
    const minY = -WORLD_BOUNDS.margin;
    const maxY = WORLD_BOUNDS.height + WORLD_BOUNDS.margin;

    const rawX = Math.max(minX, Math.min(maxX, inputData.x));
    const rawY = Math.max(minY, Math.min(maxY, inputData.y));
    const dtMove = playerData.lastInput > 0 ? now - playerData.lastInput : 9999;

    if (dtMove > 5 && dtMove < 2000) {
      const maxDX =
        MOVE_PLAUSIBLE_SPEED_H * (dtMove / 1000) + MOVE_PLAUSIBLE_LAG_PAD_H;
      const maxDY =
        MOVE_PLAUSIBLE_SPEED_V * (dtMove / 1000) + MOVE_PLAUSIBLE_LAG_PAD_V;
      const absDX = Math.abs(rawX - playerData.x);
      const absDY = Math.abs(rawY - playerData.y);
      if (absDX > maxDX || absDY > maxDY) {
        netTestLogger.noteInputClamp(room, playerData, {
          absDX,
          maxDX,
          absDY,
          maxDY,
          dtMove,
        });
        if (room.DEV_TIMING_DIAG && !room._netTestEnabled) {
          console.warn(
            `[GameRoom ${room.matchId}] position jump clamped: ${playerData.name} dx=${absDX.toFixed(0)}>${maxDX.toFixed(0)} dy=${absDY.toFixed(0)}>${maxDY.toFixed(0)} dt=${dtMove}ms`,
          );
        }
        playerData.x = Math.max(
          minX,
          Math.min(maxX, playerData.x + Math.sign(rawX - playerData.x) * maxDX),
        );
        playerData.y = Math.max(
          minY,
          Math.min(maxY, playerData.y + Math.sign(rawY - playerData.y) * maxDY),
        );
      } else {
        playerData.x = rawX;
        playerData.y = rawY;
      }
    } else {
      playerData.x = rawX;
      playerData.y = rawY;
    }

    if (typeof inputData.flip !== "undefined")
      playerData.flip = !!inputData.flip;
    if (typeof inputData.animation === "string") {
      playerData.animation = inputData.animation;
    }
    if (Number.isFinite(Number(inputData.vx))) {
      playerData.vx = Number(inputData.vx);
    }
    if (Number.isFinite(Number(inputData.vy))) {
      playerData.vy = Number(inputData.vy);
    }
    if (typeof inputData.grounded === "boolean") {
      playerData.grounded = inputData.grounded;
    }
    if (inputData.loaded === true) playerData.loaded = true;
    playerData._lastPositionPacketAt = now;

    if (inputData.ammoState && typeof inputData.ammoState === "object") {
      const a = inputData.ammoState;
      playerData.ammoState = {
        capacity: Math.max(1, Number(a.capacity) || 1),
        charges: Math.max(0, Number(a.charges) || 0),
        cooldownMs: Math.max(50, Number(a.cooldownMs) || 1200),
        reloadMs: Math.max(100, Number(a.reloadMs) || 1200),
        reloadTimerMs: Math.max(0, Number(a.reloadTimerMs) || 0),
        nextFireInMs: Math.max(0, Number(a.nextFireInMs) || 0),
      };
    }

    if (!playerData._posHistory) playerData._posHistory = [];
    playerData._posHistory.push({ x: playerData.x, y: playerData.y, t: now });
    if (playerData._posHistory.length > POSITION_HISTORY_DEPTH) {
      playerData._posHistory.shift();
    }
    netTestLogger.noteInput(room, playerData, now, {
      dx: rawX - prevInputX,
      dy: rawY - prevInputY,
    });
    playerData.lastInput = now;
    return;
  }

  inputData.timestamp = now;
  playerData.inputBuffer.push(inputData);
  if (playerData.inputBuffer.length > 10) playerData.inputBuffer.shift();
  playerData.lastInput = now;
}

function processPlayerMovement(playerData, input) {
  const speed = 5;

  if (input.left) playerData.x -= speed;
  if (input.right) playerData.x += speed;
  if (input.up) playerData.y -= speed;
  if (input.down) playerData.y += speed;

  const minX = -WORLD_BOUNDS.margin;
  const maxX = WORLD_BOUNDS.width + WORLD_BOUNDS.margin;
  const minY = -WORLD_BOUNDS.margin;
  const maxY = WORLD_BOUNDS.height + WORLD_BOUNDS.margin;
  playerData.x = Math.max(minX, Math.min(maxX, playerData.x));
  playerData.y = Math.max(minY, Math.min(maxY, playerData.y));
}

/**
 * Phase 2: Handle input-intent messages for server-side movement simulation.
 * Non-breaking: server currently queues but doesn't use unless flag enabled.
 * Intent structure: { direction: [-1|0|1], isJumping: bool, timestamp, sequence }
 */
function handlePlayerInputIntent(room, socketId, intentData) {
  const playerData = room.players.get(socketId);
  if (!playerData) return;

  if (!intentData || typeof intentData !== "object") return;

  // Queue intent for server-side simulation (when USE_SERVER_MOVEMENT_SIMULATION_V1 enabled)
  if (!playerData._inputIntentQueue) playerData._inputIntentQueue = [];
  const sequence = Number(intentData.sequence);
  playerData._inputIntentQueue.push({
    left: !!intentData.left,
    right: !!intentData.right,
    direction: Number(intentData.direction) || 0,
    jumpHeld: !!intentData.jumpHeld,
    jumpPressed: !!intentData.jumpPressed,
    isJumping: !!intentData.isJumping,
    grounded:
      typeof intentData.grounded === "boolean" ? intentData.grounded : undefined,
    facing: Number(intentData.facing) === -1 ? -1 : 1,
    vx: Number(intentData.vx) || 0,
    vy: Number(intentData.vy) || 0,
    movementLocked: !!intentData.movementLocked,
    animation:
      typeof intentData.animation === "string" ? intentData.animation : null,
    timestamp: Number(intentData.timestamp) || Date.now(),
    sequence: Number.isFinite(sequence) ? sequence : -1,
  });

  // Keep queue limited to prevent memory leak
  if (playerData._inputIntentQueue.length > 20) {
    playerData._inputIntentQueue.shift();
  }

  // Store last intent for diagnostics
  playerData._lastInputIntent = intentData;
  playerData._lastInputSeq = Number.isFinite(sequence) ? sequence : -1;
  netTestLogger.noteIntent(room, playerData, intentData);
}

function advancePlayerKinematics(playerData, dtMs) {
  if (
    !playerData ||
    !playerData.isAlive ||
    playerData.connected === false ||
    playerData.loaded !== true
  ) {
    return;
  }

  const x = Number(playerData.x);
  const y = Number(playerData.y);
  const vx = Number(playerData.vx);
  const vy = Number(playerData.vy);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(vx) ||
    !Number.isFinite(vy)
  ) {
    return;
  }

  const packetAgeMs = Date.now() - Number(playerData._lastPositionPacketAt || 0);
  if (packetAgeMs > 1000) return;

  const dtSec = Math.max(0, Number(dtMs) || 0) / 1000;
  if (dtSec <= 0) return;

  const minX = -WORLD_BOUNDS.margin;
  const maxX = WORLD_BOUNDS.width + WORLD_BOUNDS.margin;
  const minY = -WORLD_BOUNDS.margin;
  const maxY = WORLD_BOUNDS.height + WORLD_BOUNDS.margin;

  playerData.x = Math.max(minX, Math.min(maxX, x + vx * dtSec));
  playerData.y = Math.max(minY, Math.min(maxY, y + vy * dtSec));

  if (!playerData._posHistory) playerData._posHistory = [];
  playerData._posHistory.push({
    x: playerData.x,
    y: playerData.y,
    t: Date.now(),
  });
  if (playerData._posHistory.length > POSITION_HISTORY_DEPTH) {
    playerData._posHistory.shift();
  }
}

module.exports = {
  handlePlayerInput,
  handlePlayerInputIntent,
  processPlayerMovement,
  advancePlayerKinematics,
};
