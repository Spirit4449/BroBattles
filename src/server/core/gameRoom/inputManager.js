const {
  WORLD_BOUNDS,
  POSITION_HISTORY_DEPTH,
  SERVER_AUTHORITATIVE_MOVEMENT_V2,
  INPUT_INTENT_MAX_QUEUE,
  MOVE_PLAUSIBLE_SPEED_H,
  MOVE_PLAUSIBLE_SPEED_V,
  MOVE_PLAUSIBLE_LAG_PAD_H,
  MOVE_PLAUSIBLE_LAG_PAD_V,
} = require("../gameRoomConfig");
const { isMovementSuppressed } = require("./abilityRuntimeManager");

function isAuthoritativeV2Enabled(room) {
  let runtimeFlag;
  try {
    const runtime = room?.runtimeConfig?.get?.() || {};
    runtimeFlag = runtime?.netcode?.serverAuthoritativeMovementV2;
  } catch (_) {}
  if (typeof runtimeFlag === "boolean") return runtimeFlag;
  return !!SERVER_AUTHORITATIVE_MOVEMENT_V2;
}

function ingestIntentInput(playerData, inputData, now) {
  const intentRaw = inputData?.intent;
  if (!intentRaw || typeof intentRaw !== "object") return false;

  const seq = Number(inputData.inputSeq);
  const clientMonoTime = Number(inputData.clientMonoTime);
  const intent = {
    left: !!intentRaw.left,
    right: !!intentRaw.right,
    up: !!intentRaw.up,
    down: !!intentRaw.down,
    jump: !!intentRaw.jump,
    seq: Number.isFinite(seq) ? seq : null,
    clientMonoTime: Number.isFinite(clientMonoTime) ? clientMonoTime : null,
    timestamp: now,
  };

  playerData.inputBuffer.push(intent);
  if (playerData.inputBuffer.length > INPUT_INTENT_MAX_QUEUE) {
    playerData.inputBuffer.splice(
      0,
      playerData.inputBuffer.length - INPUT_INTENT_MAX_QUEUE,
    );
  }
  if (intent.seq != null) playerData._lastReceivedInputSeq = intent.seq;
  return true;
}

function handlePlayerInput(room, socketId, inputData) {
  const playerData = room.players.get(socketId);
  if (!playerData || !playerData.isAlive || playerData.connected === false) {
    return;
  }

  if (!inputData || typeof inputData !== "object") return;

  const now = Date.now();
  const infernoActive = isMovementSuppressed(playerData, now);
  const useAuthoritativeV2 = isAuthoritativeV2Enabled(room);

  if (typeof inputData.flip !== "undefined") playerData.flip = !!inputData.flip;
  if (typeof inputData.animation === "string") {
    playerData.animation = inputData.animation;
  }
  if (inputData.loaded === true) playerData.loaded = true;
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

  if (infernoActive) {
    playerData.lastInput = now;
    return;
  }

  if (useAuthoritativeV2 && ingestIntentInput(playerData, inputData, now)) {
    playerData.lastInput = now;
    return;
  }

  if (
    typeof inputData.x === "number" &&
    typeof inputData.y === "number" &&
    Number.isFinite(inputData.x) &&
    Number.isFinite(inputData.y)
  ) {
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
        if (room.DEV_TIMING_DIAG) {
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

    if (!playerData._posHistory) playerData._posHistory = [];
    playerData._posHistory.push({ x: playerData.x, y: playerData.y, t: now });
    if (playerData._posHistory.length > POSITION_HISTORY_DEPTH) {
      playerData._posHistory.shift();
    }
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

module.exports = {
  handlePlayerInput,
  processPlayerMovement,
};
