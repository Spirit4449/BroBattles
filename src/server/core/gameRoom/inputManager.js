const {
  WORLD_BOUNDS,
  POSITION_HISTORY_DEPTH,
  MOVE_PLAUSIBLE_SPEED_H,
  MOVE_PLAUSIBLE_SPEED_V,
  MOVE_PLAUSIBLE_LAG_PAD_H,
  MOVE_PLAUSIBLE_LAG_PAD_V,
  MOVE_CLAMP_WINDOW_MS,
  MOVE_CLAMP_MAX_IN_WINDOW,
  MOVE_CLAMP_SUPPRESS_MS,
} = require("../gameRoomConfig");
const { isMovementSuppressed } = require("./abilityRuntimeManager");
const netTestLogger = require("./netTestLogger");

function clampToRoomBounds(x, y) {
  const margin = Number(WORLD_BOUNDS?.margin) || 0;
  const minX = -margin;
  const maxX = Number(WORLD_BOUNDS?.width) + margin;
  const minY = -margin;
  const maxY = Number(WORLD_BOUNDS?.height) + margin;
  return {
    x: Math.max(minX, Math.min(maxX, Number(x) || 0)),
    y: Math.max(minY, Math.min(maxY, Number(y) || 0)),
  };
}

function pushPositionHistory(playerData, now = Date.now()) {
  if (!playerData) return;
  if (!playerData._posHistory) playerData._posHistory = [];
  playerData._posHistory.push({
    x: Number(playerData.x) || 0,
    y: Number(playerData.y) || 0,
    t: now,
  });
  if (playerData._posHistory.length > POSITION_HISTORY_DEPTH) {
    playerData._posHistory.shift();
  }
}

function noteMovementClampViolation(room, playerData, now) {
  const windowStart = Number(playerData._movementClampWindowStart || 0);
  if (!windowStart || now - windowStart > MOVE_CLAMP_WINDOW_MS) {
    playerData._movementClampWindowStart = now;
    playerData._movementClampCount = 0;
  }
  playerData._movementClampCount = Number(playerData._movementClampCount || 0) + 1;
  if (playerData._movementClampCount >= MOVE_CLAMP_MAX_IN_WINDOW) {
    playerData._movementViolationUntil = now + MOVE_CLAMP_SUPPRESS_MS;
    playerData._movementClampWindowStart = now;
    playerData._movementClampCount = 0;
    if (room.DEV_TIMING_DIAG && !room._netTestEnabled) {
      console.warn(
        `[GameRoom ${room.matchId}] movement temporarily suppressed for ${playerData.name} due to repeated clamp violations`,
      );
    }
  }
}

function handlePlayerInput(room, socketId, inputData) {
  const playerData = room.players.get(socketId);
  if (!playerData || !playerData.isAlive || playerData.connected === false) {
    return;
  }

  if (!inputData || typeof inputData !== "object") return;

  const now = Date.now();
  if (Number(playerData._movementViolationUntil || 0) > now) return;
  const infernoActive = isMovementSuppressed(playerData, now);
  const packetSeq = Number(inputData?.sequence);
  const packetTimestamp = Number(inputData?.timestamp);
  if (Number.isFinite(packetSeq)) {
    const lastSeq = Number(playerData._lastPositionSeq);
    if (Number.isFinite(lastSeq) && packetSeq <= lastSeq) {
      return;
    }
    playerData._lastPositionSeq = packetSeq;
  }
  if (Number.isFinite(packetTimestamp)) {
    const lastTs = Number(playerData._lastPositionClientTs);
    if (Number.isFinite(lastTs) && packetTimestamp < lastTs - 5) {
      return;
    }
    playerData._lastPositionClientTs = packetTimestamp;
  }

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
    if (Number.isFinite(Number(inputData.width))) {
      playerData._lastWidth = Number(inputData.width);
    }
    if (Number.isFinite(Number(inputData.height))) {
      playerData._lastHeight = Number(inputData.height);
    }
    if (Number.isFinite(Number(inputData.bodyHalfWidth))) {
      playerData._bodyHalfWidth = Math.max(4, Number(inputData.bodyHalfWidth));
    }
    if (Number.isFinite(Number(inputData.bodyHalfHeight))) {
      playerData._bodyHalfHeight = Math.max(8, Number(inputData.bodyHalfHeight));
    }
    if (Number.isFinite(Number(inputData.bodyCenterOffsetX))) {
      playerData._bodyCenterOffsetX = Number(inputData.bodyCenterOffsetX);
    }
    if (Number.isFinite(Number(inputData.bodyCenterOffsetY))) {
      playerData._bodyCenterOffsetY = Number(inputData.bodyCenterOffsetY);
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
    const bounded = clampToRoomBounds(inputData.x, inputData.y);
    let rawX = bounded.x;
    const rawY = bounded.y;
    const minX = -(Number(WORLD_BOUNDS?.margin) || 0);
    const maxX =
      Number(WORLD_BOUNDS?.width) + (Number(WORLD_BOUNDS?.margin) || 0);
    const minY = -(Number(WORLD_BOUNDS?.margin) || 0);
    const maxY =
      Number(WORLD_BOUNDS?.height) + (Number(WORLD_BOUNDS?.margin) || 0);
    const dtMove = playerData.lastInput > 0 ? now - playerData.lastInput : 9999;

    const reportedVx = Number(inputData.vx);
    const activeIntentDir =
      Number(playerData?._lastInputIntent?.direction) ||
      Number(playerData?._currentInputIntent?.direction) ||
      0;
    const currentDir =
      Math.sign(Number(playerData.vx) || 0) || Math.sign(activeIntentDir);
    const reportedDir = Math.sign(reportedVx) || Math.sign(activeIntentDir);
    const sameDirection = currentDir !== 0 && reportedDir === currentDir;
    if (sameDirection) {
      const trailsBehind =
        (currentDir > 0 && rawX < playerData.x) ||
        (currentDir < 0 && rawX > playerData.x);
      if (trailsBehind && Math.abs(rawX - playerData.x) <= 42) {
        rawX = playerData.x;
      }
    }

    if (dtMove > 5 && dtMove < 2000) {
      const maxDX =
        MOVE_PLAUSIBLE_SPEED_H * (dtMove / 1000) + MOVE_PLAUSIBLE_LAG_PAD_H;
      const maxDY =
        MOVE_PLAUSIBLE_SPEED_V * (dtMove / 1000) + MOVE_PLAUSIBLE_LAG_PAD_V;
      const absDX = Math.abs(rawX - playerData.x);
      const absDY = Math.abs(rawY - playerData.y);
      if (absDX > maxDX || absDY > maxDY) {
        noteMovementClampViolation(room, playerData, now);
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

    if (typeof inputData.flip !== "undefined") playerData.flip = !!inputData.flip;
    if (typeof inputData.animation === "string") {
      playerData.animation = inputData.animation;
    }
    if (Number.isFinite(Number(inputData.vx))) {
      const nextVx = Number(inputData.vx);
      const currentVx = Number(playerData.vx) || 0;
      const keepCurrentVx =
        Math.sign(currentVx) !== 0 &&
        Math.sign(currentVx) === Math.sign(nextVx) &&
        Math.abs(nextVx) < Math.abs(currentVx) &&
        Math.abs(currentVx - nextVx) <= 80;
      if (!keepCurrentVx) {
        playerData.vx = nextVx;
      }
    }
    if (Number.isFinite(Number(inputData.vy))) {
      playerData.vy = Number(inputData.vy);
    }
    if (typeof inputData.grounded === "boolean") {
      playerData.grounded = inputData.grounded;
      if (inputData.grounded) {
        playerData._lastGroundTime = now;
        playerData._simCanJump = true;
      }
    }
    if (inputData.loaded === true) playerData.loaded = true;
    if (Number.isFinite(Number(inputData.width))) {
      playerData._lastWidth = Number(inputData.width);
    }
    if (Number.isFinite(Number(inputData.height))) {
      playerData._lastHeight = Number(inputData.height);
    }
    if (Number.isFinite(Number(inputData.bodyHalfWidth))) {
      playerData._bodyHalfWidth = Math.max(4, Number(inputData.bodyHalfWidth));
    }
    if (Number.isFinite(Number(inputData.bodyHalfHeight))) {
      playerData._bodyHalfHeight = Math.max(8, Number(inputData.bodyHalfHeight));
    }
    if (Number.isFinite(Number(inputData.bodyCenterOffsetX))) {
      playerData._bodyCenterOffsetX = Number(inputData.bodyCenterOffsetX);
    }
    if (Number.isFinite(Number(inputData.bodyCenterOffsetY))) {
      playerData._bodyCenterOffsetY = Number(inputData.bodyCenterOffsetY);
    }
    playerData._lastPositionPacketAt = now;

    pushPositionHistory(playerData, now);
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

function handlePlayerInputIntent(room, socketId, intentData) {
  const playerData = room.players.get(socketId);
  if (!playerData) return;
  if (!intentData || typeof intentData !== "object") return;

  if (!playerData._inputIntentQueue) playerData._inputIntentQueue = [];
  const sequence = Number(intentData.sequence);
  const normalizedIntent = {
    left: !!intentData.left,
    right: !!intentData.right,
    direction: Number(intentData.direction) || 0,
    jumpHeld: !!intentData.jumpHeld,
    jumpPressed: !!intentData.jumpPressed,
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
  };

  playerData._inputIntentQueue.push(normalizedIntent);
  if (playerData._inputIntentQueue.length > 20) {
    playerData._inputIntentQueue.shift();
  }

  playerData._currentInputIntent = normalizedIntent;
  playerData._lastInputIntent = normalizedIntent;
  playerData._lastInputSeq = normalizedIntent.sequence;
  netTestLogger.noteIntent(room, playerData, intentData);
}

function drainLatestIntent(playerData) {
  if (!playerData) return null;
  let latest = playerData._currentInputIntent || null;
  if (Array.isArray(playerData._inputIntentQueue) && playerData._inputIntentQueue.length) {
    latest = playerData._inputIntentQueue[playerData._inputIntentQueue.length - 1];
    playerData._inputIntentQueue.length = 0;
    playerData._currentInputIntent = latest;
  }
  return latest;
}

function advancePlayerKinematics(room, playerData, dtMs) {
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
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return;
  }

  const now = Date.now();
  const latestIntent = drainLatestIntent(playerData);
  if (latestIntent && typeof latestIntent.grounded === "boolean") {
    playerData.grounded = latestIntent.grounded;
    if (latestIntent.grounded) {
      playerData._lastGroundTime = now;
    }
  }

  playerData._simX = playerData.x;
  playerData._simY = playerData.y;

  pushPositionHistory(playerData, now);
}

module.exports = {
  handlePlayerInput,
  handlePlayerInputIntent,
  processPlayerMovement,
  advancePlayerKinematics,
};
