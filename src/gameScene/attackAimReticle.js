import { RENDER_LAYERS } from "./renderLayers";

const RETICLE_RENDERERS = new Map();

const RETICLE_PALETTES = {
  basic: {
    shadowColor: 0x111111,
    shadowAlpha: 0.14,
    fillColor: 0xffffff,
    fillAlpha: 0.2,
    lineColor: 0xffffff,
    lineAlpha: 0.22,
    accentColor: 0xffffff,
    accentAlpha: 0.92,
  },
  empty: {
    shadowColor: 0x4d0000,
    shadowAlpha: 0.2,
    fillColor: 0xff3030,
    fillAlpha: 0.2,
    lineColor: 0xff6b6b,
    lineAlpha: 0.3,
    accentColor: 0xff3030,
    accentAlpha: 0.96,
  },
  special: {
    shadowColor: 0xffaa00,
    shadowAlpha: 0.16,
    fillColor: 0xffc52e,
    fillAlpha: 0.18,
    lineColor: 0xffef9c,
    lineAlpha: 0.22,
    accentColor: 0xffdd55,
    accentAlpha: 0.98,
  },
};

function getPalette(state) {
  if (state?.ammoAvailable === false && state?.paletteKey !== "special") {
    return RETICLE_PALETTES.empty;
  }
  return RETICLE_PALETTES[
    state?.paletteKey === "special" ? "special" : "basic"
  ];
}

class BaseAttackReticleRenderer {
  constructor(scene) {
    this.scene = scene;
    this.shadow = scene.add.graphics();
    this.main = scene.add.graphics();
    this.accent = scene.add.graphics();
    this.crosshair = scene.add.graphics();
    this.setVisible(false);
    this.setDepth(RENDER_LAYERS.RETICLES);
  }

  setDepth(depth = RENDER_LAYERS.RETICLES) {
    this.shadow.setDepth(depth);
    this.main.setDepth(depth + 0.1);
    this.accent.setDepth(depth + 0.2);
    this.crosshair.setDepth(depth + 0.3);
  }

  setVisible(visible) {
    const next = visible !== false;
    this.shadow.setVisible(next);
    this.main.setVisible(next);
    this.accent.setVisible(next);
    this.crosshair.setVisible(next);
  }

  clear() {
    this.shadow.clear();
    this.main.clear();
    this.accent.clear();
    this.crosshair.clear();
  }

  destroy() {
    this.shadow.destroy();
    this.main.destroy();
    this.accent.destroy();
    this.crosshair.destroy();
  }

  render(state) {
    this.clear();
    if (!state) return;
    this.setVisible(true);
  }
}

// Preserve attack identity while keeping the preview local enough to read in motion.
export function getAttackGuideStyle(state) {
  const range = Number(state.config?.reticleRange) || Number(state.range) || 240;
  const defaultLength = Math.min(
    state.kind === "throw" ? 400 : 420,
    range * (state.kind === "throw" ? 0.85 : 0.5),
  );
  return {
    length: state.config?.showFullReticleRange === true
      ? range
      : Math.max(Number(state.config?.reticleMinLength) || 0, defaultLength),
    width: Math.max(4, Math.min(16, (Number(state.config?.reticleThickness) || 18) * 0.28)),
  };
}

function dedupePathPoints(points) {
  const result = [];
  for (const point of points || []) {
    const next = { x: Number(point?.x), y: Number(point?.y) };
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) continue;
    const previous = result[result.length - 1];
    if (!previous || Math.hypot(next.x - previous.x, next.y - previous.y) > 0.35) {
      result.push(next);
    }
  }
  return result;
}

// The projectile dwells at a surface before peeling away. Round that zero-speed
// turn with two eased quadratic halves so the guide communicates the rebound
// instead of drawing a sharp, straight-cut corner through the impact point.
function roundBounceCorners(points, impacts, radius = 30) {
  const rounded = dedupePathPoints(points);
  for (const impact of (impacts || []).filter((entry) => !entry?.terminal)) {
    if (rounded.length < 5) break;
    let contactIndex = 1;
    let closest = Infinity;
    for (let i = 1; i < rounded.length - 1; i += 1) {
      const distance = Math.hypot(
        rounded[i].x - Number(impact.x),
        rounded[i].y - Number(impact.y),
      );
      if (distance < closest) {
        closest = distance;
        contactIndex = i;
      }
    }
    let before = contactIndex;
    let after = contactIndex;
    let distance = 0;
    while (before > 0 && distance < radius) {
      distance += Math.hypot(
        rounded[before].x - rounded[before - 1].x,
        rounded[before].y - rounded[before - 1].y,
      );
      before -= 1;
    }
    distance = 0;
    while (after < rounded.length - 1 && distance < radius) {
      distance += Math.hypot(
        rounded[after + 1].x - rounded[after].x,
        rounded[after + 1].y - rounded[after].y,
      );
      after += 1;
    }
    if (before === contactIndex || after === contactIndex) continue;
    const start = rounded[before];
    const contact = rounded[contactIndex];
    const end = rounded[after];
    const curve = [];
    for (let i = 0; i <= 4; i += 1) {
      const t = i / 4;
      const inverse = 1 - t;
      curve.push({
        x: inverse * inverse * start.x + 2 * inverse * t * contact.x + t * t * contact.x,
        y: inverse * inverse * start.y + 2 * inverse * t * contact.y + t * t * contact.y,
      });
    }
    for (let i = 1; i <= 4; i += 1) {
      const t = i / 4;
      const inverse = 1 - t;
      curve.push({
        x: inverse * inverse * contact.x + 2 * inverse * t * contact.x + t * t * end.x,
        y: inverse * inverse * contact.y + 2 * inverse * t * contact.y + t * t * end.y,
      });
    }
    rounded.splice(before, after - before + 1, ...curve);
  }
  return rounded;
}

function drawDirectionGuide(renderer, points, palette, limit = 240, width = 5) {
  let travelled = 0;
  for (let i = 1; i < points.length && travelled < limit; i += 1) {
    const start = points[i - 1], end = points[i];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!length) continue;
    const visibleLength = Math.min(length, limit - travelled);
    // Subdivide straight lines too, so their opacity fades with distance.
    for (let d = 0; d < visibleLength; d += 8) {
      const next = Math.min(d + 8, visibleLength);
      const alpha = 0.18 + 0.82 * Math.pow(1 - (travelled + d) / limit, 0.65);
      const line = new Phaser.Geom.Line(
        start.x + (end.x - start.x) * d / length,
        start.y + (end.y - start.y) * d / length,
        start.x + (end.x - start.x) * next / length,
        start.y + (end.y - start.y) * next / length,
      );
      renderer.shadow.lineStyle(width + (palette.shadowColor === 0xffaa00 ? 10 : 4), palette.shadowColor === 0xffaa00 ? 0xffaa00 : 0x101725, alpha * 0.55);
      renderer.shadow.strokeLineShape(line);
      renderer.main.lineStyle(width, palette.accentColor, alpha * 0.5);
      renderer.main.strokeLineShape(line);
      renderer.accent.lineStyle(3, palette.accentColor, alpha);
      renderer.accent.strokeLineShape(line);
    }
    travelled += visibleLength;
  }
}

function getPolylineLength(points) {
  let length = 0;
  for (let i = 1; i < (points || []).length; i += 1) {
    length += Math.hypot(
      Number(points[i]?.x) - Number(points[i - 1]?.x),
      Number(points[i]?.y) - Number(points[i - 1]?.y),
    );
  }
  return length;
}

class LineAttackReticleRenderer extends BaseAttackReticleRenderer {
  render(state) {
    super.render(state);
    if (!state) return;
    const { length, width } = getAttackGuideStyle(state);
    const startX = state.baseX + (state.anchorX - state.baseX) * 0.65;
    const startY = state.baseY + (state.anchorY - state.baseY) * 0.65;
    drawDirectionGuide(this, [
      { x: startX, y: startY },
      { x: startX + state.unitX * length, y: startY + state.unitY * length },
    ], getPalette(state), length, width);
  }
}

class ThrowAttackReticleRenderer extends BaseAttackReticleRenderer {
  render(state) {
    super.render(state);
    if (!state) return;
    const { length, width } = getAttackGuideStyle(state);
    // Use the actual sampled trajectory, preserving gravity and the launch curvature.
    const preview = state.throwPreview || {};
    const points = roundBounceCorners(
      preview.points || [],
      preview.impacts || [],
      Math.max(8, Number(state.config?.bounceCurveRadius) || 30),
    );
    const offsetY = Number(state.config?.reticlePathOffsetY) || 0;
    // A uniform visual offset lowers the attachment point without bending the
    // sampled physical trajectory near the character.
    const displayed = offsetY
      ? points.map(point => ({ x: point.x, y: point.y + offsetY }))
      : points;
    const sampledLength = getPolylineLength(displayed);
    const maxLength = Math.max(
      length,
      Number(state.config?.reticleMaxLength) || length,
    );
    const visibleLength = state.config?.showPathToImpact === true &&
      (preview.impacts || []).length
      ? Math.min(sampledLength, maxLength)
      : length;
    drawDirectionGuide(
      this,
      displayed,
      getPalette(state),
      Math.max(length, visibleLength),
      width,
    );
    const cue = state.centerCue;
    if (cue?.proximity > 0) {
      const palette = getPalette(state);
      const x = state.baseX;
      const y = state.baseY + offsetY;
      const radius = 7 + cue.proximity * 3;
      this.crosshair.lineStyle(2, palette.accentColor, 0.18 + cue.proximity * 0.42);
      this.crosshair.strokeEllipse(x, y, radius * 2, radius * 2);
      if (cue.held) {
        this.crosshair.fillStyle(palette.accentColor, 0.65);
        this.crosshair.fillEllipse(x, y, 4, 4);
      }
    }
  }
}

class SplashAttackReticleRenderer extends BaseAttackReticleRenderer {
  render(state) {
    super.render(state);
    if (!state) return;
    const palette = getPalette(state);

    const radius = Math.max(8, Number(state.coneRadius) || 150);
    const innerRadius = Math.max(0, Number(state.coneInnerRadius) || 0);
    const spreadDeg = Math.max(8, Number(state.coneSpreadDeg) || 56);
    const halfSpread = Phaser.Math.DegToRad(spreadDeg / 2);
    const angle = Number(state.angle) || 0;
    const startAngle = angle - halfSpread;
    const endAngle = angle + halfSpread;
    const cx = Number(state.anchorX) || 0;
    const cy = Number(state.anchorY) || 0;
    const steps = 24;
    const outerPoints = [];

    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const current = Phaser.Math.Linear(startAngle, endAngle, t);
      outerPoints.push(
        new Phaser.Geom.Point(
          cx + Math.cos(current) * radius,
          cy + Math.sin(current) * radius,
        ),
      );

    }

    // Radial bands retain the actual cone angle and reach, fading out from the player.
    const bands = 12;
    for (let band = 0; band < bands; band += 1) {
      const near = innerRadius + (radius - innerRadius) * band / bands;
      const far = innerRadius + (radius - innerRadius) * (band + 1) / bands;
      const points = [];
      for (let i = 0; i <= steps; i += 1) {
        const a = startAngle + (endAngle - startAngle) * i / steps;
        points.push(new Phaser.Geom.Point(cx + Math.cos(a) * far, cy + Math.sin(a) * far));
      }
      for (let i = steps; i >= 0; i -= 1) {
        const a = startAngle + (endAngle - startAngle) * i / steps;
        points.push(new Phaser.Geom.Point(cx + Math.cos(a) * near, cy + Math.sin(a) * near));
      }
      this.shadow.fillStyle(0x101725, 0.12 * (1 - band / bands));
      this.shadow.fillPoints(points, true);
      this.main.fillStyle(palette.fillColor, 0.3 * (1 - band / bands));
      this.main.fillPoints(points, true);
    }
    for (const a of [startAngle, endAngle]) {
      drawDirectionGuide(this, [
        { x: cx + Math.cos(a) * innerRadius, y: cy + Math.sin(a) * innerRadius },
        { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius },
      ], palette, radius - innerRadius, 4);
    }
    // A quiet outer arc still communicates the precise reach of the cone.
    this.accent.lineStyle(2, palette.accentColor, 0.38);
    this.accent.strokePoints(outerPoints, false);
  }
}

class RoundAttackReticleRenderer extends BaseAttackReticleRenderer {
  render(state) {
    super.render(state);
    if (!state) return;
    const palette = getPalette(state);
    const visualScale = Number(state.visualScale) || 1;
    const reveal = 1;
    const radius = reveal * visualScale * Math.max(
      16,
      Number(state.roundRadius) || Number(state.range) || 60,
    );
    const radiusY = Math.max(16, Number(state.config?.radiusY) * visualScale * reveal || radius);
    const cx = Number(state.baseX ?? state.anchorX) || 0;
    const cy = (Number(state.baseY ?? state.anchorY) || 0) +
      (Number(state.config?.reticleOffsetY) || 0) * visualScale -
      (state.character === "thorg" ? 37.8 * (visualScale - 1) : 0);

    // Concentric fills fade radially; the outer ellipse marks the true attack footprint.
    this.shadow.lineStyle(palette.shadowColor === 0xffaa00 ? 12 : 5, palette.shadowColor === 0xffaa00 ? 0xffaa00 : 0x101725, 0.45);
    this.shadow.strokeEllipse(cx, cy, radius * 2, radiusY * 2);
    for (let band = 10; band >= 1; band -= 1) {
      const scale = band / 10;
      this.main.fillStyle(palette.fillColor, 0.035);
      this.main.fillEllipse(cx, cy, radius * scale * 2, radiusY * scale * 2);
    }
    this.accent.lineStyle(3, palette.accentColor, 0.85);
    this.accent.strokeEllipse(cx, cy, radius * 2, radiusY * 2);
  }
}

class CustomAttackReticleRenderer extends BaseAttackReticleRenderer {
  render(state) {
    super.render(state);
    if (!state) return;
    const renderer = state?.config?.customRenderer;
    if (typeof renderer === "function") {
      renderer({
        scene: this.scene,
        shadow: this.shadow,
        main: this.main,
        accent: this.accent,
        crosshair: this.crosshair,
        state,
      });
      return;
    }
  }
}

function registerAttackReticleRenderer(kind, RendererClass) {
  const key = String(kind || "")
    .toLowerCase()
    .trim();
  if (!key || typeof RendererClass !== "function") return;
  RETICLE_RENDERERS.set(key, RendererClass);
}

function resolveRenderer(kind) {
  const key = String(kind || "")
    .toLowerCase()
    .trim();
  return (
    RETICLE_RENDERERS.get(key) ||
    (key === "throw"
      ? ThrowAttackReticleRenderer
      : key === "splash"
        ? SplashAttackReticleRenderer
        : key === "round"
          ? RoundAttackReticleRenderer
          : key === "custom"
            ? CustomAttackReticleRenderer
            : LineAttackReticleRenderer)
  );
}

function createAttackAimReticleController(scene, { getAmmoCharges } = {}) {
  let renderer = null;
  let rendererKind = "";

  const ensureRenderer = (kind) => {
    const nextKind = String(kind || "line").toLowerCase();
    if (renderer && rendererKind === nextKind) return renderer;
    if (renderer) renderer.destroy();
    const RendererClass = resolveRenderer(nextKind);
    renderer = new RendererClass(scene);
    rendererKind = nextKind;
    return renderer;
  };

  return {
    update(state) {
      if (!state) {
        this.hide();
        return;
      }
      const activeRenderer = ensureRenderer(state.kind || state?.config?.kind);
      const renderedState = state?.paletteKey === "special" || state?.family === "special" ||
        typeof getAmmoCharges !== "function"
        ? state
        : { ...state, ammoAvailable: Number(getAmmoCharges()) >= 1 };
      activeRenderer.render(renderedState);
      activeRenderer.setVisible(true);
    },
    hide() {
      if (!renderer) return;
      renderer.clear();
      renderer.setVisible(false);
    },
    destroy() {
      if (!renderer) return;
      renderer.destroy();
      renderer = null;
      rendererKind = "";
    },
  };
}

registerAttackReticleRenderer("line", LineAttackReticleRenderer);
registerAttackReticleRenderer("throw", ThrowAttackReticleRenderer);
registerAttackReticleRenderer("splash", SplashAttackReticleRenderer);
registerAttackReticleRenderer("round", RoundAttackReticleRenderer);
registerAttackReticleRenderer("custom", CustomAttackReticleRenderer);

export { registerAttackReticleRenderer, createAttackAimReticleController };
