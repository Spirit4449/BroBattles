const {
  getResolvedCharacterAimConfig,
  getResolvedCharacterSpecialAimConfig,
  getResolvedCharacterAttackConfig,
  getResolvedCharacterSpecialConfig,
} = require("../../lib/characterTuning.js");

const ATTACK_AIM_HOLD_ACTIVATE_MS = 140;
const ATTACK_AIM_DRAG_ACTIVATE_PX = 16;

const DEFAULT_AIM_CONFIG = Object.freeze({
  family: "basic",
  kind: "line",
  attackKey: null,
  specialKey: null,
  defaultRange: 120,
  minRange: null,
  maxRange: null,
  radius: null,
  anchorForwardOffset: 24,
  anchorOffsetY: -6,
  reticleThickness: 18,
  angleMode: "free",
  minSpeedScale: 1,
  maxSpeedScale: 1,
  trajectorySamples: 24,
  previewStartBackOffset: 14,
  previewStartLiftY: -8,
  previewEndDropY: 300,
  previewArcHeight: 120,
  previewCurveMagnitude: 20,
  throwMinOffsetX: null,
  throwMaxOffsetX: null,
  throwMinOffsetY: null,
  throwMaxOffsetY: null,
  quickTargetOffsetX: null,
  quickTargetOffsetY: null,
  coneRadius: 150,
  coneSpreadDeg: 56,
  coneInnerRadius: 30,
});

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = cloneValue(entry);
    }
    return out;
  }
  return value;
}

function mergeObjects(base, overrides) {
  const out = cloneValue(base);
  if (!overrides || typeof overrides !== "object") return out;
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      out[key] &&
      typeof out[key] === "object" &&
      !Array.isArray(out[key])
    ) {
      out[key] = mergeObjects(out[key], value);
    } else {
      out[key] = cloneValue(value);
    }
  }
  return out;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Number(min) || 0;
  if (Number.isFinite(min) && n < min) return min;
  if (Number.isFinite(max) && n > max) return max;
  return n;
}

function lerp(a, b, t) {
  const start = Number.isFinite(Number(a)) ? Number(a) : 0;
  const end = Number.isFinite(Number(b)) ? Number(b) : start;
  return start + (end - start) * clamp(t, 0, 1);
}

function normalizeAngle(angle, fallback = 0) {
  const n = Number(angle);
  return Number.isFinite(n) ? n : fallback;
}

function getDefaultFacingAngle(player) {
  return player?.flipX ? Math.PI : 0;
}

function isSpecialFamily(family) {
  return String(family || "").toLowerCase() === "special";
}

function getAimConfig(character, family = "basic") {
  const special = isSpecialFamily(family);
  const overrides = special
    ? getResolvedCharacterSpecialAimConfig(character) || {}
    : getResolvedCharacterAimConfig(character) || {};
  const config = mergeObjects(DEFAULT_AIM_CONFIG, overrides);
  config.family = special ? "special" : "basic";
  return config;
}

function getAimTuning(character, config = {}, family = "basic") {
  if (isSpecialFamily(family)) {
    return getResolvedCharacterSpecialConfig(character, config.specialKey || null);
  }
  return getResolvedCharacterAttackConfig(character, config.attackKey || null);
}

function resolveRangeSettings(character, config = {}, family = "basic") {
  const tuning = getAimTuning(character, config, family) || {};
  const fallbackRange =
    Number(config.radius) ||
    Number(config.defaultRange) ||
    Number(tuning?.range) ||
    Number(tuning?.forwardDistance) ||
    DEFAULT_AIM_CONFIG.defaultRange;
  const minRange =
    Number(config.minRange) ||
    (String(config.kind || "line").toLowerCase() === "throw"
      ? fallbackRange
      : fallbackRange);
  const maxRange = Math.max(
    minRange,
    Number(config.maxRange) ||
      Number(config.radius) ||
      Number(config.defaultRange) ||
      fallbackRange,
  );
  const defaultRange = clamp(
    Number(config.radius) || Number(config.defaultRange) || fallbackRange,
    minRange,
    maxRange,
  );
  return {
    minRange,
    defaultRange,
    maxRange,
  };
}

function getPlayerAimBasePoint({ character, player, family = "basic" } = {}) {
  const config = getAimConfig(character, family);
  return {
    baseX: Number(player?.x) || 0,
    baseY: (Number(player?.y) || 0) + (Number(config.anchorOffsetY) || 0),
    config,
  };
}

function getPlayerAimBase(player, config = {}, angle = 0) {
  const point = {
    baseX: Number(player?.x) || 0,
    baseY: (Number(player?.y) || 0) + (Number(config.anchorOffsetY) || 0),
  };
  const unitX = Math.cos(angle);
  const unitY = Math.sin(angle);
  const forwardOffset = Number(config.anchorForwardOffset) || 0;
  return {
    baseX: point.baseX,
    baseY: point.baseY,
    anchorX: point.baseX + unitX * forwardOffset,
    anchorY: point.baseY + unitY * forwardOffset,
  };
}

function sampleThrowArcPoint(geometry, t) {
  const clampedT = clamp(t, 0, 1);
  const curve = Math.sin(Math.PI * clampedT) * geometry.curveMagnitude;
  return {
    x:
      geometry.startX +
      (geometry.endX - geometry.startX) * clampedT +
      geometry.normalX * curve,
    y:
      geometry.startY +
      (geometry.endY - geometry.startY) * clampedT +
      geometry.normalY * curve -
      geometry.arcHeight * Math.sin(Math.PI * clampedT),
  };
}

function buildThrowArcGeometry({
  originX = 0,
  originY = 0,
  angle = 0,
  range = 120,
  targetX = null,
  targetY = null,
  startBackOffset = 14,
  startLiftY = -8,
  endDropY = 300,
  arcHeight = 120,
  curveMagnitude = 20,
  samples = 24,
} = {}) {
  const resolvedTargetX = Number(targetX);
  const resolvedTargetY = Number(targetY);
  const hasTarget =
    Number.isFinite(resolvedTargetX) && Number.isFinite(resolvedTargetY);
  const safeRange = Math.max(1, Number(range) || 120);
  const resolvedAngle = hasTarget
    ? Math.atan2(resolvedTargetY - Number(originY), resolvedTargetX - Number(originX))
    : normalizeAngle(angle, 0);
  const forwardX = Math.cos(resolvedAngle);
  const forwardY = Math.sin(resolvedAngle);
  const normalX = -forwardY;
  const normalY = forwardX;

  const geometry = {
    angle: resolvedAngle,
    forwardX,
    forwardY,
    normalX,
    normalY,
    startX: Number(originX) - forwardX * (Number(startBackOffset) || 0),
    startY:
      Number(originY) -
      forwardY * (Number(startBackOffset) || 0) +
      (Number(startLiftY) || 0),
    endX: hasTarget ? resolvedTargetX : Number(originX) + forwardX * safeRange,
    endY: hasTarget
      ? resolvedTargetY
      : Number(originY) + forwardY * safeRange + (Number(endDropY) || 0),
    arcHeight: Number(arcHeight) || 0,
    curveMagnitude: Number(curveMagnitude) || 0,
    points: [],
  };

  const sampleCount = Math.max(4, Number(samples) || 24);
  for (let i = 0; i <= sampleCount; i += 1) {
    geometry.points.push(sampleThrowArcPoint(geometry, i / sampleCount));
  }

  return geometry;
}

function resolveAimAngle(
  config,
  defaultAngle,
  targetX,
  targetY,
  baseX,
  baseY,
  quick,
  quickUsesPointerAngle = false,
) {
  let angle = defaultAngle;
  const mode = String(config?.angleMode || "free").toLowerCase();
  if (
    !Number.isFinite(targetX) ||
    !Number.isFinite(targetY) ||
    (quick && !quickUsesPointerAngle)
  ) {
    return normalizeAngle(angle, defaultAngle);
  }
  if (mode === "locked-facing") {
    return normalizeAngle(defaultAngle, defaultAngle);
  }
  if (mode === "horizontal-only") {
    return targetX < baseX ? Math.PI : 0;
  }
  const dx = targetX - baseX;
  const dy = targetY - baseY;
  if (Math.hypot(dx, dy) > 0.001) {
    angle = Math.atan2(dy, dx);
  }
  return normalizeAngle(angle, defaultAngle);
}

function resolveThrowTarget(
  character,
  base,
  config,
  defaultAngle,
  targetX,
  targetY,
  quick,
  quickUsesPointerAngle = false,
) {
  const { minRange, defaultRange, maxRange } = resolveRangeSettings(
    character,
    config,
    config.family,
  );
  const hasPointer =
    Number.isFinite(Number(targetX)) && Number.isFinite(Number(targetY));
  const fallbackDx =
    quick && quickUsesPointerAngle && hasPointer
      ? Math.cos(defaultAngle) * defaultRange
      : Number.isFinite(Number(config.quickTargetOffsetX))
        ? Number(config.quickTargetOffsetX)
        : Math.cos(defaultAngle) * defaultRange;
  const fallbackDy =
    quick && quickUsesPointerAngle && hasPointer
      ? Math.sin(defaultAngle) * defaultRange
      : Number(config.quickTargetOffsetY) || 0;
  let dx =
    !quick && Number.isFinite(targetX)
      ? Number(targetX) - base.anchorX
      : fallbackDx;
  let dy =
    !quick && Number.isFinite(targetY)
      ? Number(targetY) - base.anchorY
      : fallbackDy;

  if (
    Number.isFinite(Number(config.throwMinOffsetX)) ||
    Number.isFinite(Number(config.throwMaxOffsetX))
  ) {
    dx = clamp(
      dx,
      Number.isFinite(Number(config.throwMinOffsetX))
        ? Number(config.throwMinOffsetX)
        : -Infinity,
      Number.isFinite(Number(config.throwMaxOffsetX))
        ? Number(config.throwMaxOffsetX)
        : Infinity,
    );
  }
  if (
    Number.isFinite(Number(config.throwMinOffsetY)) ||
    Number.isFinite(Number(config.throwMaxOffsetY))
  ) {
    dy = clamp(
      dy,
      Number.isFinite(Number(config.throwMinOffsetY))
        ? Number(config.throwMinOffsetY)
        : -Infinity,
      Number.isFinite(Number(config.throwMaxOffsetY))
        ? Number(config.throwMaxOffsetY)
        : Infinity,
    );
  }

  let dist = Math.hypot(dx, dy);
  if (dist < 0.001) {
    dx = fallbackDx;
    dy = fallbackDy;
    dist = Math.hypot(dx, dy);
  }
  if (dist > maxRange && dist > 0.001) {
    const ratio = maxRange / dist;
    dx *= ratio;
    dy *= ratio;
    dist = maxRange;
  }
  if (dist < minRange && dist > 0.001) {
    const ratio = minRange / dist;
    dx *= ratio;
    dy *= ratio;
    dist = minRange;
  }

  return {
    targetX: base.anchorX + dx,
    targetY: base.anchorY + dy,
    range: dist || defaultRange,
  };
}

function resolveAttackAimContext({
  character,
  player,
  family = "basic",
  pointerWorldX = null,
  pointerWorldY = null,
  quick = false,
  quickUsesPointerAngle = false,
} = {}) {
  const config = getAimConfig(character, family);
  const defaultAngle = getDefaultFacingAngle(player);
  const initialBase = getPlayerAimBase(player, config, defaultAngle);
  const targetX = Number(pointerWorldX);
  const targetY = Number(pointerWorldY);

  let angle = resolveAimAngle(
    config,
    defaultAngle,
    targetX,
    targetY,
    initialBase.baseX,
    initialBase.baseY,
    quick,
    quickUsesPointerAngle,
  );

  const base = getPlayerAimBase(player, config, angle);
  const { minRange, defaultRange, maxRange } = resolveRangeSettings(
    character,
    config,
    family,
  );
  const kind = String(config.kind || "line").toLowerCase();
  let appliedRange = defaultRange;
  let resolvedTargetX = Number.isFinite(targetX)
    ? targetX
    : base.anchorX + Math.cos(angle) * defaultRange;
  let resolvedTargetY = Number.isFinite(targetY)
    ? targetY
    : base.anchorY + Math.sin(angle) * defaultRange;
  let throwPreview = null;

  if (kind === "throw") {
    const throwTarget = resolveThrowTarget(
      character,
      base,
      config,
      angle,
      targetX,
      targetY,
      quick,
      quickUsesPointerAngle,
    );
    resolvedTargetX = throwTarget.targetX;
    resolvedTargetY = throwTarget.targetY;
    appliedRange = throwTarget.range;
    angle = Math.atan2(resolvedTargetY - base.anchorY, resolvedTargetX - base.anchorX);
    throwPreview = buildThrowArcGeometry({
      originX: base.anchorX,
      originY: base.anchorY,
      angle,
      range: appliedRange,
      targetX: resolvedTargetX,
      targetY: resolvedTargetY,
      startBackOffset: Number(config.previewStartBackOffset) || 0,
      startLiftY: Number(config.previewStartLiftY) || 0,
      endDropY: Number(config.previewEndDropY) || 0,
      arcHeight: Number(config.previewArcHeight) || 0,
      curveMagnitude: Number(config.previewCurveMagnitude) || 0,
      samples: Number(config.trajectorySamples) || 24,
    });
  } else {
    const rawDistance =
      Number.isFinite(targetX) && Number.isFinite(targetY)
        ? Math.hypot(targetX - base.anchorX, targetY - base.anchorY)
        : defaultRange;
    const allowDragRange =
      kind === "throw" || config.allowDragRange === true;
    appliedRange =
      !quick && allowDragRange
        ? clamp(rawDistance, minRange, maxRange)
        : defaultRange;
    resolvedTargetX = base.anchorX + Math.cos(angle) * appliedRange;
    resolvedTargetY = base.anchorY + Math.sin(angle) * appliedRange;
  }

  const rangeRatio =
    maxRange > minRange ? (appliedRange - minRange) / (maxRange - minRange) : 0;
  const speedScale = lerp(
    Number(config.minSpeedScale) || 1,
    Number(config.maxSpeedScale) || 1,
    rangeRatio,
  );
  const unitX = Math.cos(angle);
  const unitY = Math.sin(angle);
  const direction =
    unitX <= -0.1 ? -1 : unitX >= 0.1 ? 1 : player?.flipX ? -1 : 1;
  const coneRadius = Math.max(
    1,
    Number(config.coneRadius) || appliedRange || defaultRange,
  );
  const roundRadius = Math.max(
    1,
    Number(config.radius) || Number(config.defaultRange) || coneRadius,
  );

  return {
    character,
    family: config.family,
    kind,
    quick: !!quick,
    config,
    paletteKey: config.family === "special" ? "special" : "basic",
    angle,
    direction,
    unitX,
    unitY,
    baseX: base.baseX,
    baseY: base.baseY,
    anchorX: base.anchorX,
    anchorY: base.anchorY,
    pointerWorldX: resolvedTargetX,
    pointerWorldY: resolvedTargetY,
    range: appliedRange,
    minRange,
    maxRange,
    defaultRange,
    rangeRatio,
    speedScale,
    targetX: resolvedTargetX,
    targetY: resolvedTargetY,
    endX: throwPreview ? throwPreview.endX : resolvedTargetX,
    endY: throwPreview ? throwPreview.endY : resolvedTargetY,
    coneRadius,
    coneSpreadDeg: Math.max(1, Number(config.coneSpreadDeg) || 56),
    coneInnerRadius: Math.max(0, Number(config.coneInnerRadius) || 0),
    roundRadius,
    throwPreview,
  };
}

module.exports = {
  ATTACK_AIM_HOLD_ACTIVATE_MS,
  ATTACK_AIM_DRAG_ACTIVATE_PX,
  getAimConfig,
  getAttackAimConfig: (character) => getAimConfig(character, "basic"),
  getPlayerAimBasePoint,
  buildThrowArcGeometry,
  sampleThrowArcPoint,
  resolveAttackAimContext,
};
