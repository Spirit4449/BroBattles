import { RENDER_LAYERS } from "../scene/renderLayers.js";
import { fillPixelBlob, rasterizePixelBlob } from "../powerups/pixelShapes.js";
import { PIXEL_INK, snapPixel } from "../scene/pixelBar.js";
import { playerAnchor, rigRingDrop } from "../characters/shared/rig.js";

// Team marker: a pixel-art oval on the floor around each player's feet, blue
// for your team, white for yourself and red for the other team. It sits
// beside the sprite rather than on it, so the artwork is never filtered.

export const FOOT_RING_ALLY = 0x3d8bff;
export const FOOT_RING_ENEMY = 0xff413f;
export const FOOT_RING_SELF = 0xffffff;

const WIDTH_PER_BODY = 1.55;
// Bodies wider than a typical character (Thorg's is ~50px) widen the ring
// only gently past this knee, and never beyond the cap, so a bulky hitbox
// doesn't turn the marker into a huge disc.
const KNEE_BODY_WIDTH = 34;
const WIDTH_PER_BODY_PAST_KNEE = 0.35;
const MAX_RING_WIDTH = 64;
// A ring lying flat on the platform's top surface, seen almost side-on.
const HEIGHT_PER_WIDTH = 0.26;
// One world pixel per cell, like the health bars, so edges stay fine and the
// ring moves in 1px steps with its owner instead of jumping a coarse grid.
const CELL = 1;
const ELLIPSE_POINTS = 48;
// Moving rolls two light glints around the rim, like the powerup rings drift.
// Radians per world pixel travelled; small, so a sprint is under a turn a second.
const SPIN_PER_PX = 0.012;
const GLINT_HALF_ANGLE = 0.26;
// Redraw only when the glints move a visible step, and ignore teleports.
const SPIN_STEPS = 96;
const MAX_STEP_PX = 40;
// The soles sit a third of the way down from the ring's back edge, so it
// lies on the floor around the feet instead of hovering behind them. A rig's
// `ringDrop` overrides it for wide stances (Thorg) that read better centred.
const DROP_PER_RADIUS = 0.35;

export function footRingColor(isAlly, isSelf = false) {
  if (isSelf) return FOOT_RING_SELF;
  return isAlly ? FOOT_RING_ALLY : FOOT_RING_ENEMY;
}

// Body bottom-centre from the sprite's current transform, matching Arcade's
// Body.preUpdate so the ring never trails a frame behind the sprite.
export function footPoint(sprite) {
  const body = sprite?.body;
  if (!body) return null;
  const x = sprite.x + sprite.scaleX * (body.offset.x - sprite.displayOriginX) + body.width / 2;
  const y = sprite.y + sprite.scaleY * (body.offset.y - sprite.displayOriginY) + body.height;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

// Even cell counts keep the oval centred on a grid line.
export function footRingSize(bodyWidth, cell = CELL) {
  const evenCells = value => Math.max(2, 2 * Math.round(value / cell / 2)) * cell;
  const body = Math.max(0, Number(bodyWidth) || 0);
  const target = Math.min(body, KNEE_BODY_WIDTH) * WIDTH_PER_BODY
    + Math.max(0, body - KNEE_BODY_WIDTH) * WIDTH_PER_BODY_PAST_KNEE;
  const width = Math.max(12 * cell, Math.min(evenCells(MAX_RING_WIDTH), evenCells(target)));
  return { width, height: Math.max(6 * cell, evenCells(width * HEIGHT_PER_WIDTH)) };
}

// Mixes a colour toward white for the rim's glints.
function lighten(color, amount) {
  const mix = shift => {
    const c = (color >> shift) & 255;
    return Math.round(c + (255 - c) * amount) << shift;
  };
  return mix(16) | mix(8) | mix(0);
}

// The oval's cells, rasterized once per size: `cell`-sized pixels centred on (0, 0).
export function rasterizeFootRing(width, height, cell = CELL) {
  const rx = width / 2, ry = height / 2;
  const points = [];
  for (let i = 0; i < ELLIPSE_POINTS; i++) {
    const a = (i / ELLIPSE_POINTS) * Math.PI * 2;
    points.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
  }
  return { blob: rasterizePixelBlob(points, { ringCount: 4, cell, grow: 0 }), rx, ry };
}

// Angular distance from a rim cell to the nearer of two opposite glints.
function glintDistance(x, y, rx, ry, phase) {
  const angle = Math.atan2(y / ry, x / rx);
  const d = Math.abs(((angle - phase) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2);
  return d;
}

// A dark pixel outline, the health bars' ink, keeps it readable on light and
// dark floors alike. The front (lower) rim is thicker and brighter than the
// back so it reads as lying on the floor. `phase` places the two glints.
export function drawPixelFootRing(g, { blob, rx, ry }, color, phase = 0) {
  const { cell, cols, rows, depth, originX, originY } = blob;
  const inside = (col, row) => col >= 0 && row >= 0 && col < cols && row < rows && depth[row * cols + col] > 0;

  // Outline: every empty cell touching the oval, heavier under the front.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (inside(col, row)) continue;
      if (!(inside(col - 1, row) || inside(col + 1, row) || inside(col, row - 1) || inside(col, row + 1))) continue;
      const front = originY + (row + 0.5) * cell > 0;
      g.fillStyle(PIXEL_INK, front ? 0.75 : 0.58);
      g.fillRect(originX + col * cell, originY + row * cell, cell, cell);
    }
  }
  const rim = (d, y) => (y > 0 ? d <= 3 : d <= 2);
  fillPixelBlob(g, blob, color, 0.22, (d, _x, y) => !rim(d, y));
  fillPixelBlob(g, blob, color, 0.6, (d, _x, y) => d === 2 && y < 0);
  fillPixelBlob(g, blob, color, 0.85, (d, _x, y) => d === 1 && y < 0);
  fillPixelBlob(g, blob, color, 1, (d, _x, y) => d <= 3 && y > 0);
  const glint = (d, x, y) => rim(d, y) && glintDistance(x, y, rx, ry, phase) < GLINT_HALF_ANGLE;
  fillPixelBlob(g, blob, lighten(color, 0.35), 0.45, glint);
  fillPixelBlob(g, blob, lighten(color, 0.5), 0.35, (d, x, y) =>
    d === 1 && glint(d, x, y) && glintDistance(x, y, rx, ry, phase) < GLINT_HALF_ANGLE * 0.45);
}

// Rolls the glints with horizontal travel: moving right turns the front rim
// right. Returns the new phase.
export function advanceSpin(phase, dx) {
  if (!Number.isFinite(dx) || Math.abs(dx) > MAX_STEP_PX) return phase;
  return (phase - dx * SPIN_PER_PX) % (Math.PI * 2);
}

// `hidden` reports states where the owner keeps a sprite but no marker
// belongs, such as a corpse.
export function attachTeamFootRing(scene, sprite, { isAlly, isSelf = false, hidden = () => false } = {}) {
  if (!scene?.add?.graphics || !sprite) return null;
  const color = footRingColor(isAlly, isSelf);
  const ring = scene.add.graphics().setDepth(RENDER_LAYERS.PLAYER - 1).setVisible(false);
  let shape = null;
  let phase = 0;
  let drawnStep = null;
  let lastX = null;

  const draw = bodyWidth => {
    // Sized once from the standing body, so ducking never resizes it.
    if (!shape) {
      const size = footRingSize(bodyWidth);
      shape = rasterizeFootRing(size.width, size.height);
    }
    const step = Math.round((phase / (Math.PI * 2)) * SPIN_STEPS);
    if (step === drawnStep) return;
    drawnStep = step;
    ring.clear();
    drawPixelFootRing(ring, shape, color, (step / SPIN_STEPS) * Math.PI * 2);
  };

  const sync = () => {
    const foot = !sprite.active || !sprite.visible || hidden() || !sprite.body ? null : playerAnchor(sprite, "feet");
    if (!foot || !(sprite.alpha > 0)) {
      ring.setVisible(false);
      lastX = null;
      return;
    }
    if (lastX !== null) phase = advanceSpin(phase, sprite.x - lastX);
    lastX = sprite.x;
    draw(sprite.body.width);
    // The rig's feet anchor: the stand point the health bar also centres on.
    const drop = rigRingDrop(sprite) ?? DROP_PER_RADIUS;
    ring.setPosition(snapPixel(foot.x), snapPixel(foot.y + shape.ry * drop));
    ring.setAlpha(sprite.alpha);
    ring.setVisible(true);
  };

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    scene.events?.off("postupdate", sync);
    ring.destroy();
  };
  scene.events?.on("postupdate", sync);
  sprite.once?.("destroy", destroy);
  scene.events?.once?.("shutdown", destroy);
  return { ring, sync, destroy };
}
