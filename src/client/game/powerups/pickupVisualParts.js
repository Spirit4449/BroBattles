
export function pickupVisualParts(visual, { includeOmen = true } = {}) {
  const { container, sprite, glow, glowOuter, glowCore, omenBase, omenRing, omenEcho } = visual;
  const parts = [container || sprite, glow, glowOuter, glowCore];
  if (includeOmen) parts.push(omenBase, omenRing, omenEcho);
  return parts.filter(Boolean);
}

export function destroyVisualParts(parts) {
  for (const part of parts) {
    try {
      part?.destroy?.();
    } catch (_) {}
  }
}
