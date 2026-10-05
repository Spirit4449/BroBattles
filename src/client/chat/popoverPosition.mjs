export function positionChatPopover(anchor, width, height, viewportWidth, viewportHeight) {
  const gap = 6;
  const margin = 8;
  const below = anchor.bottom + gap;
  const above = below + height > viewportHeight - margin;
  return {
    left: Math.max(margin, Math.min(anchor.right - width, viewportWidth - width - margin)),
    top: Math.max(margin, Math.min(above ? anchor.top - height - gap : below, viewportHeight - height - margin)),
    above,
  };
}
