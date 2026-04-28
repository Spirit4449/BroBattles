const DEFAULT_ONE_SHOT_MS = 520;
const DEFAULT_SPECIAL_MS = 900;
const ACTION_PATTERN = /throw|attack|slash|special/i;

function nowPerf() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

function nowMs() {
  return Date.now();
}

export function toLogicalAnimation(animation, character = "") {
  const raw = String(animation || "").toLowerCase();
  const char = String(character || "").toLowerCase();
  if (!raw) return "idle";
  const suffix =
    char && raw.startsWith(`${char}-`) ? raw.slice(char.length + 1) : raw;
  if (/special|ultimate|ult/.test(suffix)) return "special";
  if (/throw|attack|slash/.test(suffix)) return "throw";
  if (/slide|wall/.test(suffix)) return "sliding";
  if (/jump/.test(suffix)) return "jumping";
  if (/fall/.test(suffix)) return "falling";
  if (/run|walk|move/.test(suffix)) return "running";
  if (/dying|death|dead/.test(suffix)) return "dying";
  if (/idle|stand/.test(suffix)) return "idle";
  return suffix || "idle";
}

export function isActionAnimation(animation) {
  return ACTION_PATTERN.test(String(animation || ""));
}

export function getAnimationDurationMs(scene, key, fallbackMs = DEFAULT_ONE_SHOT_MS) {
  const anim = scene?.anims?.get?.(key);
  if (!anim) return fallbackMs;
  const frames = Array.isArray(anim.frames) ? anim.frames : [];
  const explicitDuration = frames.reduce(
    (sum, frame) => sum + Math.max(0, Number(frame?.duration) || 0),
    0,
  );
  if (explicitDuration > 0) return explicitDuration + 30;
  const frameRate = Math.max(1, Number(anim.frameRate) || 12);
  const frameCount = Math.max(1, frames.length || 1);
  return Math.round((frameCount / frameRate) * 1000) + 30;
}

export function markOneShotAnimation(
  sprite,
  logical = "throw",
  durationMs = DEFAULT_ONE_SHOT_MS,
  { remote = false } = {},
) {
  if (!sprite) return;
  const ms = Math.max(80, Number(durationMs) || DEFAULT_ONE_SHOT_MS);
  const state = sprite._bbAnimationState || {};
  state.oneShot = toLogicalAnimation(logical);
  state.currentLogical = state.oneShot;
  state.oneShotUntilMs = nowMs() + ms;
  state.oneShotUntilPerf = nowPerf() + ms;
  state.remote = !!remote;
  sprite._bbAnimationState = state;
  if (remote) {
    sprite._remoteActionAnimUntil = state.oneShotUntilPerf;
  }
}

export function noteAnimationPlayed(sprite, logical = "idle") {
  if (!sprite) return;
  const state = sprite._bbAnimationState || {};
  state.currentLogical = toLogicalAnimation(logical);
  state.updatedAt = nowMs();
  if (state.currentLogical === "jumping") {
    state.jumpPlayedAirborne = true;
  }
  if (state.currentLogical === "idle" || state.currentLogical === "running") {
    state.jumpPlayedAirborne = false;
  }
  sprite._bbAnimationState = state;
}

export function resetAirborneJumpAnimation(sprite) {
  if (!sprite) return;
  const state = sprite._bbAnimationState || {};
  state.jumpPlayedAirborne = false;
  sprite._bbAnimationState = state;
}

export function playCharacterAnimation({
  scene,
  sprite,
  character,
  skinId = "",
  resolveAnimKey,
  logical = "idle",
  fallback = "idle",
  force = true,
  lockMs = 0,
  remote = false,
}) {
  if (!scene || !sprite?.anims || typeof resolveAnimKey !== "function") {
    return null;
  }
  const wanted = toLogicalAnimation(logical, character);
  const key = resolveAnimKey(scene, character, wanted, fallback, skinId);
  try {
    const currentKey = sprite.anims?.currentAnim?.key || "";
    if (
      (wanted === "throw" || wanted === "special") &&
      currentKey === key &&
      sprite.anims?.isPlaying === false
    ) {
      return key;
    }
    if (
      wanted === "jumping" &&
      sprite._bbAnimationState?.jumpPlayedAirborne &&
      !sprite.body?.touching?.down &&
      currentKey !== key
    ) {
      return key;
    }
    sprite.anims.play(key, force);
    noteAnimationPlayed(sprite, wanted);
    if (lockMs > 0) {
      const fallbackMs =
        wanted === "special" ? DEFAULT_SPECIAL_MS : DEFAULT_ONE_SHOT_MS;
      const duration = Math.max(
        Number(lockMs) || 0,
        getAnimationDurationMs(scene, key, fallbackMs),
      );
      markOneShotAnimation(sprite, wanted, duration, { remote });
    }
    return key;
  } catch (_) {
    return null;
  }
}

export function clearExpiredOneShot(sprite) {
  const state = sprite?._bbAnimationState;
  if (!state?.oneShot) return;
  if (nowMs() < Number(state.oneShotUntilMs || 0)) return;
  state.oneShot = null;
  state.oneShotUntilMs = 0;
  state.oneShotUntilPerf = 0;
}

export function deriveMovementAnimation({
  grounded = false,
  moving = false,
  wallSliding = false,
  vx = 0,
  vy = 0,
  dead = false,
  movementLocked = false,
  specialLocked = false,
  fallback = "idle",
} = {}) {
  if (dead) return "dying";
  if (movementLocked || specialLocked) return fallback;
  if (wallSliding && !grounded) return "sliding";
  if (!grounded) return Number(vy) < -20 ? "jumping" : "falling";
  if (moving || Math.abs(Number(vx) || 0) > 20) return "running";
  return "idle";
}

export function getPresentedAnimation(sprite, fallback = "idle") {
  clearExpiredOneShot(sprite);
  const state = sprite?._bbAnimationState;
  if (state?.oneShot && nowMs() < Number(state.oneShotUntilMs || 0)) {
    return state.oneShot;
  }
  if (state?.currentLogical && !isActionAnimation(state.currentLogical)) {
    return state.currentLogical;
  }
  return fallback;
}

export function chooseRemoteAnimationState({
  animation = "idle",
  previousPosition,
  currentPosition,
  sprite,
  character = "",
} = {}) {
  const logical = toLogicalAnimation(animation, character);
  const currentX = currentPosition?.x ?? previousPosition?.x ?? sprite?.x ?? 0;
  const previousX = previousPosition?.x ?? currentPosition?.x ?? sprite?.x ?? 0;
  const currentY = currentPosition?.y ?? previousPosition?.y ?? sprite?.y ?? 0;
  const previousY = previousPosition?.y ?? currentPosition?.y ?? sprite?.y ?? 0;
  const vx = Number(currentPosition?.vx);
  const vy = Number(currentPosition?.vy);
  const grounded =
    typeof currentPosition?.grounded === "boolean"
      ? currentPosition.grounded
      : undefined;
  const dx = currentX - previousX;
  const dy = currentY - previousY;
  const actionActive =
    Number(sprite?._remoteActionAnimUntil || 0) > nowPerf() ||
    Number(sprite?._bbAnimationState?.oneShotUntilPerf || 0) > nowPerf();

  if ((logical === "throw" || logical === "special") && actionActive) {
    return logical;
  }
  if (logical === "sliding") {
    return grounded === false ? "sliding" : "idle";
  }
  if (logical === "jumping" || logical === "falling") {
    return grounded === false ? logical : "idle";
  }
  if (grounded === false || Math.abs(dy) > 2.2 || Math.abs(vy) > 85) {
    return dy < 0 || vy < -20 ? "jumping" : "falling";
  }
  if (Math.abs(dx) > 0.7 || Math.abs(vx) > 20) return "running";
  return logical === "running" ? "running" : "idle";
}
