const { COLLISION_PACKET_TOLERANCE } = require('../../../shared/physics/movementPrecision');
const { sweepMovement } = require('../../../shared/physics/sweptCollision');
const { resolveStomp } = require('./stomp');
const { acceptDash } = require('../../../shared/physics/dash');
const { FALL_OUT_DEPTH } = require('../../../shared/gameConstants');
const {
  WORLD_MARGIN,
  POSITION_HISTORY_DEPTH,
  POSITION_HISTORY_MS,
  MOVE_PLAUSIBLE_SPEED_H,
  MOVE_PLAUSIBLE_SPEED_V,
  MOVE_PLAUSIBLE_LAG_PAD_H,
  MOVE_PLAUSIBLE_LAG_PAD_V,
  MOVE_CLAMP_WINDOW_MS,
  MOVE_CLAMP_MAX_IN_WINDOW,
  MAX_MOVEMENT_CREDIT_MS,
} = require("../gameRoomConfig");
const { isMovementSuppressed } = require("./abilityRuntimeManager");
const netTestLogger = require("./netTestLogger");

const { characterBody } = require("../../../shared/physics/duelGeometry");
const { DUCK_HEIGHT_RATIO, DUCK_REENTRY_DELAY_MS } = require("../../../shared/physics/ducking");
// Packets sent before the client applied a correction still carry the rejected
// path. Dropping them (instead of re-correcting) prevents correction cascades.
// The timeout keeps a client that never acknowledges from being frozen.
const CORRECTION_ACK_TIMEOUT_MS = 1000;
// Sub-pixel/flip-offset disagreements against a face are clamped silently;
// only genuine penetration is worth yanking the client's position.
const DASH_COLLISION_CORRECTION_PX = 2;
// Latency allowance for judging contact with a moving platform.
const MOVING_SURFACE_LAG_S = 0.2;
const movementPhysics = require("../../../shared/physics/movementPhysics.json");
const effectManager = require("./effects/effectManager");

function updateBodyGeometry(player, room) {
  const body = characterBody(player.char_class, player.flip);
  // Ground contact is derived from the map, not the client's grounded flag.
  const feet = player.y + body.offsetY + body.halfHeight;
  // Packets describe the client's past, so allow for a moving surface's travel.
  player.grounded = (room.geometry?.colliders || []).some(surface => {
    const lag = surface.motion ? surface.peakSpeed * MOVING_SURFACE_LAG_S : 0;
    const lagX = surface.motion?.axis === 'x' ? lag : 0, lagY = surface.motion?.axis === 'y' ? lag : 0;
    return surface.enabled !== false && surface.collision?.none !== true &&
      surface.collision?.up !== false && Math.abs(feet - surface.top) <= 8 + lagY &&
      player.x + body.offsetX + body.halfWidth > surface.left - lagX &&
      player.x + body.offsetX - body.halfWidth < surface.right + lagX;
  });
  const wasDucking = player.ducking === true;
  player.ducking = wasDucking && player.grounded;
  if (wasDucking && !player.ducking) {
    player._duckAvailableAt = Date.now() + DUCK_REENTRY_DELAY_MS;
  }
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
  // A server teleport (spawn/respawn) supersedes any unacknowledged correction.
  player._correctionSentAt = 0;
}

function movementStats(player) {
  return (player._movementStats ||= {
    budget: 0, collision: 0, staleDropped: 0, maxErrorPx: 0,
  });
}

function correctPosition(room, player, sequence, detail = {}) {
  if (!player.socketId) return;
  const stats = movementStats(player);
  const reason = detail.reason === "collision" ? "collision" : "budget";
  stats[reason] += 1;
  const errorPx = Number(detail.errorPx) || 0;
  if (errorPx > stats.maxErrorPx) stats.maxErrorPx = errorPx;
  player._correctionId = (Number(player._correctionId) || 0) + 1;
  player._correctionSentAt = Date.now();
  room.io?.to(player.socketId).emit("game:correction", {
    x: player.x, y: player.y, sequence,
    correctionId: player._correctionId,
    ...detail, reason,
  });
}

// A packet tagged with an older correction was sent before the client saw the
// latest correction. Untagged packets (older clients) are always processed.
function isPreCorrectionPacket(player, inputData, now) {
  const ack = Number(inputData?.correctionAck);
  const latest = Number(player._correctionId) || 0;
  if (!Number.isFinite(ack) || ack >= latest) return false;
  return now - (Number(player._correctionSentAt) || 0) < CORRECTION_ACK_TIMEOUT_MS;
}
const MOVEMENT_FX_TYPES = new Set(["jump", "land", "turn", "wall-jump"]);

function applyMovementVfxState(playerData, inputData) {
  if (!playerData || !inputData) return;
  if (typeof inputData.ducking === "boolean") {
    const now = Date.now();
    const requested = inputData.ducking === true && inputData.grounded === true;
    if (playerData.ducking === true && !requested) {
      playerData._duckAvailableAt = now + DUCK_REENTRY_DELAY_MS;
    }
    playerData.ducking = requested && (
      playerData.ducking === true || now >= Number(playerData._duckAvailableAt || 0)
    );
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

function clampToRoomBounds(x, y, room) {
  const world = room.geometry.world;
  const minX = world.x - WORLD_MARGIN;
  const maxX = world.x + world.width + WORLD_MARGIN;
  const minY = world.y - WORLD_MARGIN;
  const maxY = world.y + world.height + WORLD_MARGIN;
  return {
    x: Math.max(minX, Math.min(maxX, Number(x) || 0)),
    y: Math.max(minY, Math.min(maxY, Number(y) || 0)),
  };
}

// One sample per accepted position (humans) or simulation step (bots), kept
// for POSITION_HISTORY_MS so hit validation can rewind across a full RTT plus
// the remote interpolation delay. Duplicate per-tick samples are not recorded:
// they turned linear rewinds between packets into steps.
function pushPositionHistory(playerData, now = Date.now()) {
  if (!playerData) return;
  const history = (playerData._posHistory ||= []);
  history.push({
    x: Number(playerData.x) || 0,
    y: Number(playerData.y) || 0,
    t: now,
  });
  while (
    history.length > POSITION_HISTORY_DEPTH ||
    (history.length > 2 && history[1].t < now - POSITION_HISTORY_MS)
  ) {
    history.shift();
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
  // Clamping already bounds every packet to the movement budget. Freezing all
  // input on top of that only desynchronised the server and caused a large
  // snap-back once input resumed, so repeated clamps are reported, not punished.
  if (playerData._movementClampCount >= MOVE_CLAMP_MAX_IN_WINDOW) {
    playerData._movementClampWindowStart = now;
    playerData._movementClampCount = 0;
    if (room.DEV_TIMING_DIAG && !room._netTestEnabled) {
      console.warn(
        `[GameRoom ${room.matchId}] repeated movement clamps for ${playerData.name}`,
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
  // Fighters stand at their spawns until FIGHT: before the countdown starts
  // and while it runs, movement packets cannot move them.
  if (room.status === "waiting" || Number(playerData._controlLockUntil || 0) > now) {
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
  if (isPreCorrectionPacket(playerData, inputData, now)) {
    movementStats(playerData).staleDropped += 1;
    return;
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
    const acceptedDash = acceptDash(playerData, inputData, now);
    const prevInputX = Number(playerData.x);
    const prevInputY = Number(playerData.y);
    const bounded = clampToRoomBounds(inputData.x, inputData.y, room);
    let rawX = bounded.x;
    let rawY = bounded.y;
    const {x:minX, y:minY} = clampToRoomBounds(-Infinity, -Infinity, room);
    const {x:maxX, y:maxY} = clampToRoomBounds(Infinity, Infinity, room);
    if (!playerData._movementBudget) resetMovementBudget(playerData, playerData.lastInput || now);
    const budget = playerData._movementBudget;
    const dtMove = Math.max(0, Math.min(MAX_MOVEMENT_CREDIT_MS, now - budget.at));
    budget.at = now;

    const dashAge = now - (playerData._dashUntil || 0);
    const dashMotion = playerData._dashUntil && dashAge < movementPhysics.dashCoastMs;
    let dashCollision = null;
    let collisionClamped = false;
    let collisionErrorPx = 0;
    if (dashMotion && room.geometry?.colliders) {
      const shape = characterBody(playerData.char_class, playerData.flip);
      const halfWidth = playerData._bodyHalfWidth || shape.halfWidth;
      const halfHeight = playerData._bodyHalfHeight || shape.halfHeight;
      const offsetX = playerData._bodyCenterOffsetX ?? shape.offsetX;
      const offsetY = playerData._bodyCenterOffsetY ?? shape.offsetY;
      const resolved = sweepMovement({ x: playerData.x + offsetX - halfWidth,
        y: playerData.y + offsetY - halfHeight, width: halfWidth * 2, height: halfHeight * 2 },
        // Moving platforms are where the client saw them, not where they are now.
        rawX - playerData.x, rawY - playerData.y, room.geometry.colliders.filter(c => !c.motion));
      const nextX = resolved.x - offsetX + halfWidth, nextY = resolved.y - offsetY + halfHeight;
      const tolerance = Math.max(COLLISION_PACKET_TOLERANCE, DASH_COLLISION_CORRECTION_PX);
      collisionClamped = Math.abs(nextX - rawX) > tolerance || Math.abs(nextY - rawY) > tolerance;
      collisionErrorPx = Math.hypot(nextX - rawX, nextY - rawY);
      rawX = nextX; rawY = nextY; dashCollision = resolved.hits;
    }

    // Distance credit is replenished by elapsed server time, never by packet count.
    // Server-issued impulses temporarily expand the allowance for knockback.
    const impulse = playerData._movementImpulse;
    const impulseSpeed = impulse?.until > now ? impulse.speed : 0;
    const modifiers = effectManager.getModifiers(playerData, now);
    const speedMult = Math.max(1, Math.min(movementPhysics.maxSpeedMult, Number(modifiers.speedMult) || 1));
    const dashSpeedAllowance = dashMotion
      ? Math.max(0, movementPhysics.dashHorizontalSpeed - Math.max(0, dashAge) * movementPhysics.dashCoastDrag) : 0;
    // Riding a moving platform adds its speed to the rider's own.
    const carried = room.geometry?.platformSpeed || { x: 0, y: 0 };
    const speedX = Math.max(MOVE_PLAUSIBLE_SPEED_H, movementPhysics.wallKickFull * speedMult, dashSpeedAllowance) + impulseSpeed + carried.x;
    const dashVerticalSpeed = playerData.dashX === 0 && playerData.dashY > 0
      ? movementPhysics.dashDownSpeed : movementPhysics.dashMaxSpeed;
    const speedY = MOVE_PLAUSIBLE_SPEED_V + impulseSpeed + carried.y;
    budget.x = Math.min(MOVE_PLAUSIBLE_LAG_PAD_H + speedX * MAX_MOVEMENT_CREDIT_MS / 1000 + (playerData._dashUntil > now ? movementPhysics.dashHorizontalSpeed * movementPhysics.dashDurationMs / 1000 : 0), budget.x + speedX * dtMove / 1000);
    budget.y = Math.min(MOVE_PLAUSIBLE_LAG_PAD_V + speedY * MAX_MOVEMENT_CREDIT_MS / 1000 + (playerData._dashUntil > now ? dashVerticalSpeed * movementPhysics.dashDurationMs / 1000 : 0), budget.y + speedY * dtMove / 1000);
    if (acceptedDash) {
      const distance = movementPhysics.dashHorizontalSpeed * movementPhysics.dashDurationMs / 1000;
      budget.x += distance;
      budget.y += dashVerticalSpeed * movementPhysics.dashDurationMs / 1000;
    }
    const dx = rawX - playerData.x, dy = rawY - playerData.y;
    const moveX = Math.sign(dx) * Math.min(Math.abs(dx), budget.x);
    const moveY = Math.sign(dy) * Math.min(Math.abs(dy), budget.y);
    playerData.x = Math.max(minX, Math.min(maxX, playerData.x + moveX));
    playerData.y = Math.max(minY, Math.min(maxY, playerData.y + moveY));
    budget.x -= Math.abs(moveX);
    budget.y -= Math.abs(moveY);
    if (moveX !== dx || moveY !== dy) {
      noteMovementClampViolation(room, playerData, now);
      netTestLogger.noteInputClamp(room, playerData, {
        absDX: Math.abs(dx), maxDX: Math.abs(moveX),
        absDY: Math.abs(dy), maxDY: Math.abs(moveY), dtMove,
      });
      correctPosition(room, playerData, packetSeq, {
        reason: "budget",
        errorPx: Math.hypot(dx - moveX, dy - moveY),
      });
    }

    if (typeof inputData.flip !== "undefined")
      playerData.flip = !!inputData.flip;
    if (typeof inputData.animation === "string") {
      playerData.animation = inputData.animation.slice(0, 80);
    }
    if (Number.isFinite(Number(inputData.vx))) {
      const velocityLimit = Math.max(MOVE_PLAUSIBLE_SPEED_H, dashSpeedAllowance);
      playerData.vx = Math.max(-velocityLimit, Math.min(velocityLimit, Number(inputData.vx)));
    }
    if (Number.isFinite(Number(inputData.vy))) {
      playerData.vy = Math.max(-MOVE_PLAUSIBLE_SPEED_V, Math.min(MOVE_PLAUSIBLE_SPEED_V, Number(inputData.vy)));
    }
    if (typeof inputData.grounded === "boolean") {
      playerData.grounded = inputData.grounded;
      if (inputData.grounded) {
        playerData._lastGroundTime = now;
      }
    }
    if (inputData.loaded === true) playerData.loaded = true;
    updateBodyGeometry(playerData, room);
    playerData._lastPositionPacketAt = now;

    if (dashCollision?.left || dashCollision?.right) playerData.vx = 0;
    if (dashCollision?.up || dashCollision?.down) playerData.vy = 0;
    if (collisionClamped) {
      correctPosition(room, playerData, packetSeq, {
        reason: 'collision', contacts: dashCollision, errorPx: collisionErrorPx,
      });
    }
    resolveStomp(room, playerData, now);
    pushPositionHistory(playerData, now);
    netTestLogger.noteInput(room, playerData, now, {
      dx: rawX - prevInputX,
      dy: rawY - prevInputY,
    });
    playerData.lastInput = now;
    // Falling out of the world is decided here, as for bots in their physics step.
    const world = room.geometry.world;
    if (playerData.isAlive && playerData.y > world.y + world.height + FALL_OUT_DEPTH) {
      room._handlePlayerDeath(playerData, { cause: "fall", at: now });
    }
    return;
  }

  // Malformed position packets must not enter the legacy unvalidated movement path.
}

// Bots move every simulation step on the server.
function recordBotHistory(playerData, now = Date.now()) {
  if (!playerData?.isAlive || !Number.isFinite(Number(playerData.x)) ||
      !Number.isFinite(Number(playerData.y))) return;
  pushPositionHistory(playerData, now);
}

module.exports = {
  CORRECTION_ACK_TIMEOUT_MS,
  movementStats,
  updateBodyGeometry,
  resetMovementBudget,
  handlePlayerInput,
  pushPositionHistory,
  recordBotHistory,
};
