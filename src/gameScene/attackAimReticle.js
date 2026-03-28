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
  special: {
    shadowColor: 0x2a1b00,
    shadowAlpha: 0.16,
    fillColor: 0xffef9c,
    fillAlpha: 0.18,
    lineColor: 0xffef9c,
    lineAlpha: 0.22,
    accentColor: 0xfff8c9,
    accentAlpha: 0.98,
  },
};

function getPalette(state) {
  return RETICLE_PALETTES[state?.paletteKey === "special" ? "special" : "basic"];
}

class BaseAttackReticleRenderer {
  constructor(scene) {
    this.scene = scene;
    this.shadow = scene.add.graphics();
    this.main = scene.add.graphics();
    this.accent = scene.add.graphics();
    this.crosshair = scene.add.graphics();
    this.setVisible(false);
    this.setDepth(36);
  }

  setDepth(depth = 36) {
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

class LineAttackReticleRenderer extends BaseAttackReticleRenderer {
  render(state) {
    super.render(state);
    if (!state) return;
    const palette = getPalette(state);

    const thickness = Math.max(
      12,
      Number(state?.config?.reticleThickness) || 18,
    );
    const half = thickness / 2;
    const nx = -Number(state.unitY) || 0;
    const ny = Number(state.unitX) || 0;
    const startX = Number(state.anchorX) || 0;
    const startY = Number(state.anchorY) || 0;
    const endX = Number(state.endX) || startX;
    const endY = Number(state.endY) || startY;
    const points = [
      new Phaser.Geom.Point(startX + nx * half, startY + ny * half),
      new Phaser.Geom.Point(endX + nx * half, endY + ny * half),
      new Phaser.Geom.Point(endX - nx * half, endY - ny * half),
      new Phaser.Geom.Point(startX - nx * half, startY - ny * half),
    ];

    this.shadow.fillStyle(palette.shadowColor, palette.shadowAlpha);
    this.shadow.fillPoints(points, true);
    this.shadow.lineStyle(thickness + 4, palette.shadowColor, 0.1);
    this.shadow.strokeLineShape(
      new Phaser.Geom.Line(startX, startY, endX, endY),
    );

    this.main.fillStyle(palette.fillColor, palette.fillAlpha);
    this.main.fillPoints(points, true);
    this.main.lineStyle(thickness, palette.lineColor, palette.lineAlpha);
    this.main.strokeLineShape(new Phaser.Geom.Line(startX, startY, endX, endY));

    this.accent.lineStyle(2.2, palette.accentColor, palette.accentAlpha);
    this.accent.strokePoints(points, true);
  }
}

class ThrowAttackReticleRenderer extends BaseAttackReticleRenderer {
  render(state) {
    super.render(state);
    if (!state) return;
    const palette = getPalette(state);

    const points = Array.isArray(state?.throwPreview?.points)
      ? state.throwPreview.points
      : [];
    if (!points.length) return;

    const thickness = Math.max(
      12,
      Number(state?.config?.reticleThickness) || 16,
    );
    this.shadow.lineStyle(thickness + 5, palette.shadowColor, 0.1);
    this.main.lineStyle(thickness, palette.lineColor, palette.lineAlpha);
    this.accent.lineStyle(2.4, palette.accentColor, palette.accentAlpha);

    this.shadow.beginPath();
    this.main.beginPath();
    this.accent.beginPath();
    points.forEach((point, index) => {
      const x = Number(point?.x) || 0;
      const y = Number(point?.y) || 0;
      if (index === 0) {
        this.shadow.moveTo(x, y);
        this.main.moveTo(x, y);
        this.accent.moveTo(x, y);
      } else {
        this.shadow.lineTo(x, y);
        this.main.lineTo(x, y);
        this.accent.lineTo(x, y);
      }
    });
    this.shadow.strokePath();
    this.main.strokePath();
    this.accent.strokePath();
  }
}

class SplashAttackReticleRenderer extends BaseAttackReticleRenderer {
  render(state) {
    super.render(state);
    if (!state) return;
    const palette = getPalette(state);

    const radius = Math.max(20, Number(state.coneRadius) || 150);
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
    const innerPoints = [];

    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const current = Phaser.Math.Linear(startAngle, endAngle, t);
      outerPoints.push(
        new Phaser.Geom.Point(
          cx + Math.cos(current) * radius,
          cy + Math.sin(current) * radius,
        ),
      );
      if (innerRadius > 0) {
        innerPoints.push(
          new Phaser.Geom.Point(
            cx + Math.cos(current) * innerRadius,
            cy + Math.sin(current) * innerRadius,
          ),
        );
      }
    }

    const polygon = [
      ...(innerRadius > 0 ? innerPoints : [new Phaser.Geom.Point(cx, cy)]),
      ...outerPoints.slice().reverse(),
    ];

    this.shadow.fillStyle(palette.shadowColor, palette.shadowAlpha);
    this.shadow.fillPoints(polygon, true);

    this.main.fillStyle(palette.fillColor, palette.fillAlpha);
    this.main.fillPoints(polygon, true);

    this.accent.lineStyle(2.2, palette.accentColor, palette.accentAlpha);
    this.accent.beginPath();
    outerPoints.forEach((point, index) => {
      if (index === 0) this.accent.moveTo(point.x, point.y);
      else this.accent.lineTo(point.x, point.y);
    });
    this.accent.strokePath();
    if (innerRadius > 0) {
      this.accent.beginPath();
      innerPoints.forEach((point, index) => {
        if (index === 0) this.accent.moveTo(point.x, point.y);
        else this.accent.lineTo(point.x, point.y);
      });
      this.accent.strokePath();
    }
    this.accent.strokeLineShape(
      new Phaser.Geom.Line(
        cx + Math.cos(startAngle) * innerRadius,
        cy + Math.sin(startAngle) * innerRadius,
        cx + Math.cos(startAngle) * radius,
        cy + Math.sin(startAngle) * radius,
      ),
    );
    this.accent.strokeLineShape(
      new Phaser.Geom.Line(
        cx + Math.cos(endAngle) * innerRadius,
        cy + Math.sin(endAngle) * innerRadius,
        cx + Math.cos(endAngle) * radius,
        cy + Math.sin(endAngle) * radius,
      ),
    );
  }
}

class RoundAttackReticleRenderer extends BaseAttackReticleRenderer {
  render(state) {
    super.render(state);
    if (!state) return;
    const palette = getPalette(state);
    const radius = Math.max(16, Number(state.roundRadius) || Number(state.range) || 60);
    const cx = Number(state.baseX) || Number(state.anchorX) || 0;
    const cy = Number(state.baseY) || Number(state.anchorY) || 0;

    this.shadow.fillStyle(palette.shadowColor, palette.shadowAlpha);
    this.shadow.fillCircle(cx, cy, radius + 4);
    this.main.fillStyle(palette.fillColor, palette.fillAlpha);
    this.main.fillCircle(cx, cy, radius);
    this.accent.lineStyle(2.4, palette.accentColor, palette.accentAlpha);
    this.accent.strokeCircle(cx, cy, radius);
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
  const key = String(kind || "").toLowerCase().trim();
  if (!key || typeof RendererClass !== "function") return;
  RETICLE_RENDERERS.set(key, RendererClass);
}

function resolveRenderer(kind) {
  const key = String(kind || "").toLowerCase().trim();
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

function createAttackAimReticleController(scene) {
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
      activeRenderer.render(state);
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

module.exports = {
  registerAttackReticleRenderer,
  createAttackAimReticleController,
};
