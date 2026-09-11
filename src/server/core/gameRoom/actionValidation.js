function sanitizeActionPayload(actionData) {
  if (!actionData || typeof actionData !== "object") return null;
  const typeRaw = String(actionData.type || "").trim();
  if (!typeRaw) return null;

  const sanitized = {
    type: typeRaw,
  };

  if (actionData.id != null) {
    sanitized.id = String(actionData.id).slice(0, 128);
  }
  if (Number.isFinite(Number(actionData.sequence))) {
    sanitized.sequence = Number(actionData.sequence);
  }
  if (Number.isFinite(Number(actionData.timestamp))) {
    sanitized.timestamp = Number(actionData.timestamp);
  }
  if (Number.isFinite(Number(actionData.direction))) {
    sanitized.direction = Number(actionData.direction) < 0 ? -1 : 1;
  }
  if (Number.isFinite(Number(actionData.angle))) {
    sanitized.angle = Number(actionData.angle);
  }
  if (typeof actionData.flip === "boolean") {
    sanitized.flip = !!actionData.flip;
  }
  if (typeof actionData.animation === "string") {
    sanitized.animation = String(actionData.animation).slice(0, 80);
  }
  if (typeof actionData.returning === "boolean") {
    sanitized.returning = actionData.returning;
  }
  if (typeof actionData.ownerEcho === "boolean") {
    sanitized.ownerEcho = actionData.ownerEcho;
  }
  if (typeof actionData.destroyOnHit === "boolean") {
    sanitized.destroyOnHit = actionData.destroyOnHit;
  }

  const copyVec2 = (key) => {
    const entry = actionData[key];
    if (!entry || typeof entry !== "object") return;
    const x = Number(entry.x);
    const y = Number(entry.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    sanitized[key] = { x, y };
  };

  copyVec2("origin");
  copyVec2("start");
  copyVec2("target");
  copyVec2("anchor");

  const passThroughNumeric = [
    "speed",
    "range",
    "startup",
    "releaseMs",
    "count",
    "spreadDeg",
    "collisionRadius",
    "damage",
    "windupMs",
    "strikeMs",
    "activeWindowMs",
    "followAfterWindupMs",
    "rotationSpeed",
    "scale",
    "gravity",
    "maxLifetimeMs",
    "embedMs",
    "forwardDistance",
    "outwardDuration",
    "returnSpeed",
    "endYOffset",
    "ctrl1YOffset",
    "ctrl2YOffset",
    "coneRadius",
    "coneSpreadDeg",
    "coneInnerRadius",
    "initialVy",
    "maxBounces",
    "bounceDampingY",
    "bounceDampingX",
    "airDrag",
    "minBounceSpeed",
    "floorY",
    "worldMinX",
    "worldMaxX",
    "pullDurationMs",
    "pullLockPaddingMs",
    "pulledStopDistance",
    "slowDurationMs",
    "slowSpeedMult",
    "slowJumpMult",
  ];
  for (const key of passThroughNumeric) {
    if (Number.isFinite(Number(actionData[key]))) {
      sanitized[key] = Number(actionData[key]);
    }
  }

  if (actionData?.burn && typeof actionData.burn === "object") {
    const burn = {};
    const burnDurationMs = Number(actionData.burn.durationMs);
    const burnTotalDamage = Number(actionData.burn.totalDamage);
    const burnGroundMs = Number(actionData.burn.groundBurnMs);
    if (Number.isFinite(burnDurationMs)) burn.durationMs = burnDurationMs;
    if (Number.isFinite(burnTotalDamage)) burn.totalDamage = burnTotalDamage;
    if (Number.isFinite(burnGroundMs)) burn.groundBurnMs = burnGroundMs;
    if (Object.keys(burn).length) sanitized.burn = burn;
  }

  if (Array.isArray(actionData?.projectiles)) {
    const projectiles = [];
    for (const entry of actionData.projectiles) {
      if (!entry || typeof entry !== "object") continue;
      const item = {};
      const numericKeys = [
        "index",
        "angle",
        "range",
        "speed",
        "collisionRadius",
        "damage",
        "scale",
        "gravity",
        "maxLifetimeMs",
        "embedMs",
      ];
      for (const key of numericKeys) {
        const value = Number(entry[key]);
        if (Number.isFinite(value)) item[key] = value;
      }
      if (entry?.burn && typeof entry.burn === "object") {
        const burn = {};
        const burnDurationMs = Number(entry.burn.durationMs);
        const burnTotalDamage = Number(entry.burn.totalDamage);
        const burnGroundMs = Number(entry.burn.groundBurnMs);
        if (Number.isFinite(burnDurationMs)) burn.durationMs = burnDurationMs;
        if (Number.isFinite(burnTotalDamage))
          burn.totalDamage = burnTotalDamage;
        if (Number.isFinite(burnGroundMs)) burn.groundBurnMs = burnGroundMs;
        if (Object.keys(burn).length) item.burn = burn;
      }
      if (Object.keys(item).length) projectiles.push(item);
    }
    if (projectiles.length) sanitized.projectiles = projectiles;
  }

  if (Array.isArray(actionData?.mapCollisionRects)) {
    const mapCollisionRects = [];
    for (const rect of actionData.mapCollisionRects) {
      if (!rect || typeof rect !== "object") continue;
      const left = Number(rect.left);
      const right = Number(rect.right);
      const top = Number(rect.top);
      const bottom = Number(rect.bottom);
      if (![left, right, top, bottom].every(Number.isFinite)) continue;
      mapCollisionRects.push({ left, right, top, bottom });
    }
    if (mapCollisionRects.length)
      sanitized.mapCollisionRects = mapCollisionRects;
  }

  return sanitized;
}

module.exports = { sanitizeActionPayload };
