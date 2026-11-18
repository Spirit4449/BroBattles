function canvasViewport(scene) {
  const camera = scene?.cameras?.main;
  const canvas = scene?.game?.canvas;
  if (!camera || !canvas) return null;
  const rect = canvas.getBoundingClientRect();
  return {
    camera,
    rect,
    scaleX: rect.width / Math.max(1, Number(scene.scale?.width) || rect.width),
    scaleY: rect.height / Math.max(1, Number(scene.scale?.height) || rect.height),
  };
}

export function worldToPage(scene, x, y) {
  const viewport = canvasViewport(scene);
  if (!viewport) return null;
  const { camera, rect, scaleX, scaleY } = viewport;
  return {
    x: rect.left + (camera.x + (x - camera.worldView.x) * camera.zoom) * scaleX,
    y: rect.top + (camera.y + (y - camera.worldView.y) * camera.zoom) * scaleY,
  };
}

export function pageToWorld(scene, x, y) {
  const viewport = canvasViewport(scene);
  if (!viewport || !viewport.scaleX || !viewport.scaleY) return null;
  const { camera, rect, scaleX, scaleY } = viewport;
  return camera.getWorldPoint((x - rect.left) / scaleX, (y - rect.top) / scaleY);
}
