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

const { characterBody } = require("../../../shared/duelGeometry");
const { DUCK_HEIGHT_RATIO } = require("../../../shared/ducking");
const MAX_MOVEMENT_CREDIT_MS = 500;
const movementPhysics = require("../../../shared/movementPhysics.json");
const effectManager = require("./effects/effectManager");

function updateBodyGeometry(player, room) {
  const body = characterBody(player.char_class, player.flip);
  // Ground contact is derived from the map, not the client's grounded flag.
  const feet = player.y + body.offsetY + body.halfHeight;
  player.grounded = (room.geometry?.colliders || []).some(surface =>
    surface.enabled !== false && surface.collision?.none !== true &&
    surface.collision?.up !== false && Math.abs(feet - surface.top) <= 8 &&
    player.x + body.offsetX + body.halfWidth > surface.left &&
    player.x + body.offsetX - body.halfWidth < surface.right);
  player.ducking = player.ducking === true && player.grounded;
  const height = body.height * (player.ducking ? DUCK_HEIGHT_RATIO : 1);
  player._bodyHalfWidth = body.halfWidth;
  player._bodyHalfHeight = height / 2;
  player._bodyCenterOffsetX = body.offsetX;
  player._bodyCenterOffsetY = body.offsetY + (body.height - height) / 2;
  player._lastWidth = body.displayWidth;
  player._lastHeight = body.displayHeight;
}

function resetMovementBudget(player, now = Date.now()) {
  player._movementBudget = { at: now, x: MOVE_PLAUSIBLE_LAG_PAD_H, y: MOVE_PLAUSIBLE_LAG_PAD_V };
  player.lastInput = now;
}

function correctPosition(room, player, sequence) {
  if (!player.socketId) return;
  room.io?.to(player.socketId).emit("game:correction", {
    x: player.x, y: player.y, sequence,
  });
}
const MOVEMENT_FX_TYPES = new Set(["jump", "land", "turn", "wall-jump"]);

function applyMovementVfxState(playerData, inputData) {
  if (!playerData || !inputData) return;
  if (typeof inputData.ducking === "boolean") {
    playerData.ducking = inputData.ducking === true && inputData.grounded === true;
  }
  if (typeof inputData.wallSliding === "boolean") {
    playerData.wallSliding = inputData.wallSliding;
  }
  if (
    inputData.wallSide === null ||
    inputData.wallSide === "left" ||
    inputData.wallSide === "right"
  ) {
    playerData.wallSide = inputData.wallSide;
  }

  const rawSequence = Number(inputData.movementFxSeq);
  if (!Number.isFinite(rawSequence)) return;
  const sequence = Math.max(
    0,
    Math.min(2147483646, Math.floor(rawSequence)),
  );
  if (sequence === playerData.movementFxSeq) return;

  const type = MOVEMENT_FX_TYPES.has(inputData.movementFxType)
    ? inputData.movementFxType
    : null;
  const rawDirection = Number(inputData.movementFxDirection) || 0;
  playerData.movementFxSeq = sequence;
  playerData.movementFxType = type;
  playerData.movementFxDirection = Math.sign(rawDirection);
  playerData.movementFxWallSide =
    inputData.movementFxWallSide === "left" ||
    inputData.movementFxWallSide === "right"
      ? inputData.movementFxWallSide
      : null;
  playerData.movementFxFallDistance = Math.max(
    0,
    Math.min(5000, Math.round(Number(inputData.movementFxFallDistance) || 0)),
  );
  playerData.movementFxImpactVelocity = Math.max(
    0,
    Math.min(
      3000,
      Math.round(Number(inputData.movementFxImpactVelocity) || 0),
    ),
  );
}

function clampToRoomBounds(x, y, room = null) {
  const world = room?.geometry?.world;
  const margin = Number(WORLD_BOUNDS?.margin) || 0;
  const minX = (world?.x || 0) - margin;
  const maxX = world ? world.x + world.width + margin : Number(WORLD_BOUNDS?.width) + margin;
  const minY = (world?.y || 0) - margin;
  const maxY = world ? world.y + world.height + margin : Number(WORLD_BOUNDS?.height) + margin;
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
  playerData._movementClampCount =
    Number(playerData._movementClampCount || 0) + 1;
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
  if (room.status === "finished") return;
  const playerData = room.players.get(socketId);
  if (!playerData || !playerData.isAlive || playerData.connected === false) {
    return;
  }

  if (!inputData || typeof inputData !== "object") return;

  const now = Date.now();
  if (Number(playerData._movementViolationUntil || 0) > now) return;
  if (Number(playerData._controlLockUntil || 0) > now) {
    playerData.vx = 0;
    playerData.vy = 0;
    playerData.lastInput = now;
    return;
  }
  const infernoActive = isMovementSuppressed(playerData, now);
  const packetSeq = Number(inputData?.sequence);
  const packetTimestamp = Number(inputData?.timestamp);
  if (Number.isFinite(packetSeq)) {
    const lastSeq = Number(playerData._lastPositionSeq);
    if (Number.isFinite(lastSeq) && packetSeq <= lastSeq) {
      return;
    }
    if (!Number.isSafeInteger(packetSeq) || packetSeq < 0) return;
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
    applyMovementVfxState(playerData, inputData);
    if (inputData.loaded === true) playerData.loaded = true;
    if (typeof inputData.animation === "string") {
      playerData.animation = inputData.animation.slice(0, 80);
    }
    if (Number.isFinite(Number(inputData.vx))) {
      playerData.vx = Math.max(-MOVE_PLAUSIBLE_SPEED_H, Math.min(MOVE_PLAUSIBLE_SPEED_H, Number(inputData.vx)));
    }
    if (Number.isFinite(Number(inputData.vy))) {
      playerData.vy = Math.max(-MOVE_PLAUSIBLE_SPEED_V, Math.min(MOVE_PLAUSIBLE_SPEED_V, Number(inputData.vy)));
    }
    if (typeof inputData.grounded === "boolean") {
      playerData.grounded = inputData.grounded;
    }
    updateBodyGeometry(playerData, room);
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
    applyMovementVfxState(playerData, inputData);
    const prevInputX = Number(playerData.x);
    const prevInputY = Number(playerData.y);
    const bounded = clampToRoomBounds(inputData.x, inputData.y, room);
    let rawX = bounded.x;
    const rawY = bounded.y;
    const {x:minX, y:minY} = clampToRoomBounds(-Infinity, -Infinity, room);
    const {x:maxX, y:maxY} = clampToRoomBounds(Infinity, Infinity, room);
    if (!playerData._movementBudget) resetMovementBudget(playerData, playerData.lastInput || now);
    const budget = playerData._movementBudget;
    const dtMove = Math.max(0, Math.min(MAX_MOVEMENT_CREDIT_MS, now - budget.at));
    budget.at = now;

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

    // Distance credit is replenished by elapsed server time, never by packet count.
    // Server-issued impulses temporarily expand the allowance for knockback.
    const impulse = playerData._movementImpulse;
    const impulseSpeed = impulse?.until > now ? impulse.speed : 0;
    const modifiers = effectManager.getModifiers(playerData, now);
    const speedMult = Math.max(1, Math.min(movementPhysics.maxSpeedMult, Number(modifiers.speedMult) || 1));
    const speedX = Math.max(MOVE_PLAUSIBLE_SPEED_H, movementPhysics.wallKickFull * speedMult) + impulseSpeed;
    const speedY = MOVE_PLAUSIBLE_SPEED_V + impulseSpeed;
    budget.x = Math.min(MOVE_PLAUSIBLE_LAG_PAD_H + speedX * MAX_MOVEMENT_CREDIT_MS / 1000, budget.x + speedX * dtMove / 1000);
    budget.y = Math.min(MOVE_PLAUSIBLE_LAG_PAD_V + speedY * MAX_MOVEMENT_CREDIT_MS / 1000, budget.y + speedY * dtMove / 1000);
    const dx = rawX - playerData.x, dy = rawY - playerData.y;
    const moveX = Math.sign(dx) * Math.min(Math.abs(dx), budget.x);
    const moveY = Math.sign(dy) * Math.min(Math.abs(dy), budget.y);
    playerData.x = Math.max(minX, Math.min(maxX, playerData.x + moveX));
    playerData.y = Math.max(minY, Math.min(maxY, playerData.y + moveY));
    budget.x -= Math.abs(moveX);
    budget.y -= Math.abs(moveY);
    if (moveX !== dx || moveY !== dy) {
      noteMovementClampViolation(room, playerData, now);
      correctPosition(room, playerData, packetSeq);
    }

    if (typeof inputData.flip !== "undefined")
      playerData.flip = !!inputData.flip;
    if (typeof inputData.animation === "string") {
      playerData.animation = inputData.animation.slice(0, 80);
    }
    if (Number.isFinite(Number(inputData.vx))) {
      const nextVx = Math.max(-MOVE_PLAUSIBLE_SPEED_H, Math.min(MOVE_PLAUSIBLE_SPEED_H, Number(inputData.vx)));
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
      playerData.vy = Math.max(-MOVE_PLAUSIBLE_SPEED_V, Math.min(MOVE_PLAUSIBLE_SPEED_V, Number(inputData.vy)));
    }
    if (typeof inputData.grounded === "boolean") {
      playerData.grounded = inputData.grounded;
      if (inputData.grounded) {
        playerData._lastGroundTime = now;
        playerData._simCanJump = true;
      }
    }
    if (inputData.loaded === true) playerData.loaded = true;
    updateBodyGeometry(playerData, room);
    playerData._lastPositionPacketAt = now;

    pushPositionHistory(playerData, now);
    netTestLogger.noteInput(room, playerData, now, {
      dx: rawX - prevInputX,
      dy: rawY - prevInputY,
    });
    playerData.lastInput = now;
    return;
  }

  // Malformed position packets must not enter the legacy unvalidated movement path.
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
  if (room.status === "finished") return;
  const playerData = room.players.get(socketId);
  if (!playerData || !playerData.isAlive || playerData.connected === false) return;
  if (!intentData || typeof intentData !== "object") return;
  if (Number(playerData._controlLockUntil || 0) > Date.now()) {
    return;
  }

  if (!playerData._inputIntentQueue) playerData._inputIntentQueue = [];
  const sequence = Number(intentData.sequence);
  const normalizedIntent = {
    left: !!intentData.left,
    right: !!intentData.right,
    direction: Math.sign(Number(intentData.direction) || 0),
    jumpHeld: !!intentData.jumpHeld,
    jumpPressed: !!intentData.jumpPressed,
    grounded: playerData.grounded === true,
    ducking: intentData.ducking === true && playerData.grounded === true,
    facing: Number(intentData.facing) === -1 ? -1 : 1,
    vx: playerData.vx || 0,
    vy: playerData.vy || 0,
    movementLocked: !!intentData.movementLocked,
    animation:
      typeof intentData.animation === "string" ? intentData.animation.slice(0, 80) : null,
    timestamp: Number(intentData.timestamp) || Date.now(),
    sequence: Number.isFinite(sequence) ? sequence : -1,
  };

  playerData._inputIntentQueue.push(normalizedIntent);
  if (playerData._inputIntentQueue.length > 20) {
    playerData._inputIntentQueue.shift();
  }

  playerData._currentInputIntent = normalizedIntent;
  playerData.ducking = normalizedIntent.ducking;
  updateBodyGeometry(playerData, room);
  playerData._lastInputIntent = normalizedIntent;
  playerData._lastInputSeq = normalizedIntent.sequence;
  netTestLogger.noteIntent(room, playerData, intentData);
}

function drainLatestIntent(playerData) {
  if (!playerData) return null;
  let latest = playerData._currentInputIntent || null;
  if (
    Array.isArray(playerData._inputIntentQueue) &&
    playerData._inputIntentQueue.length
  ) {
    latest =
      playerData._inputIntentQueue[playerData._inputIntentQueue.length - 1];
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
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
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
  updateBodyGeometry,
  resetMovementBudget,
  handlePlayerInput,
  handlePlayerInputIntent,
  processPlayerMovement,
  advancePlayerKinematics,
};
