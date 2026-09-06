import { THORG_SWEEP } from "../../shared/thorgSweep";

export function getThorgVisualPose(body) {
  const scale = body?._thorgVisualScale || 1;
  return { x: body.x, y: body.y - THORG_SWEEP.footOffset * (scale - 1), scale };
}

// Grow a render-only copy. Never change the physics sprite's origin or scale:
// Arcade derives its collider from those values on the following physics step.
export function setThorgRageVisual(scene, body, enabled) {
  body._thorgVisualScale = enabled ? THORG_SWEEP.rageScale : 1;
  if (!enabled) {
    body._thorgRageVisualCleanup?.();
    return;
  }
  if (body._thorgRageVisualCleanup) return;
  const visual = scene.add.sprite(body.x, body.y, body.texture.key, body.frame.name);
  visual.setVisible(false);
  visual.setDepth(body.depth);
  let hiddenAlpha = null;
  const restore = () => {
    if (hiddenAlpha !== null) {
      body.alpha = hiddenAlpha;
      hiddenAlpha = null;
    }
  };
  const render = () => {
    restore();
    if (!body.active || (body._thorgRageUntil && body._thorgRageUntil <= Date.now())) { cleanup(); return; }
    if (String(body.frame?.name).startsWith("dying")) { cleanup(); return; }
    const pose = getThorgVisualPose(body);
    visual.setTexture(body.texture.key, body.frame.name);
    visual.setPosition(pose.x, pose.y);
    visual.setOrigin(body.originX, body.originY);
    visual.setScale(body.scaleX * pose.scale, body.scaleY * pose.scale);
    visual.setFlip(body.flipX, body.flipY);
    visual.setRotation(body.rotation);
    visual.setDepth(body.depth);
    visual.setVisible(body.visible);
    visual.setAlpha(body.alpha);
    visual.setTint(body.tintTopLeft, body.tintTopRight, body.tintBottomLeft, body.tintBottomRight);
    hiddenAlpha = body.alpha;
    body.alpha = 0;
  };
  const cleanup = () => {
    restore();
    scene.events.off("prerender", render);
    scene.events.off("render", restore);
    scene.events.off("shutdown", cleanup);
    body.off?.("destroy", cleanup);
    visual.destroy();
    body._thorgVisualScale = 1;
    delete body._thorgRageVisualCleanup;
  };
  body._thorgRageVisualCleanup = cleanup;
  scene.events.on("prerender", render);
  scene.events.on("render", restore);
  scene.events.once("shutdown", cleanup);
  body.once?.("destroy", cleanup);
}
