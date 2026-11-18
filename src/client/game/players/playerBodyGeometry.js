export function standingBodyHeight(sprite, frame, config) {
  return Math.max(4, (frame?.realHeight ?? sprite.height) - (config?.heightShrink || 0));
}

export function hudTopY(sprite, frame, config) {
  if (Number.isFinite(sprite._bbHudTopOffset)) return sprite.y + sprite._bbHudTopOffset;
  if (!sprite.body) return sprite.y - sprite.height / 2;
  if (!sprite._ducking || !frame || !config) return sprite.body.y;
  return sprite.body.bottom - standingBodyHeight(sprite, frame, config) * Math.abs(sprite.scaleY || 1) + 8;
}

export function applyBodyFlipOffset(sprite, frame, config = {}) {
  const body = sprite?.body;
  if (!body) return;
  const standing = standingBodyHeight(sprite, frame, config);
  const frameWidth = frame?.realWidth ?? sprite.width;
  const width = config.sourceUnits ? body.sourceWidth : body.width;
  const x = (frameWidth - width) / 2 + (config.offsetXFromHalf ?? 0) + (sprite.flipX ? config.flipOffset || 0 : 0);
  body.setOffset(x, config.offsetY + standing - (body.sourceHeight || standing));
}
