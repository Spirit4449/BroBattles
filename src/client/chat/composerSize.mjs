// scrollHeight includes padding, but excludes borders.
export function composerHeight(scrollHeight, style, maxLines = 5) {
  const px = (value) => Number.parseFloat(value) || 0;
  const borders = px(style.borderTopWidth) + px(style.borderBottomWidth);
  const padding = px(style.paddingTop) + px(style.paddingBottom);
  const lineHeight = px(style.lineHeight) || px(style.fontSize) * 1.35;
  const min = px(style.minHeight);
  const max = Math.max(min, lineHeight * maxLines + padding + borders);
  return Math.max(min, Math.min(scrollHeight + borders, max));
}
