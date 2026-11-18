let enabled = false;
const shapes = new Set();

export function trackDebugShape(shape) {
  if (!shape) return shape;
  shapes.add(shape);
  shape.setVisible(enabled);
  shape.once("destroy", () => shapes.delete(shape));
  return shape;
}

export function isAttackDebugDraw() {
  return enabled;
}

export function setAttackDebugDraw(value) {
  enabled = !!value;
  for (const shape of shapes) shape.setVisible(enabled);
}
