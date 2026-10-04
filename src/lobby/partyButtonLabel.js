const widthAnimations = new WeakMap();

export function setPartyButtonLabel(button, label) {
  if (!button || button.textContent.trim() === label.trim()) return;

  // Capture the current animated width so quick state changes stay smooth.
  const previousWidth = getComputedStyle(button).width;
  widthAnimations.get(button)?.cancel();
  button.textContent = label;
  const nextWidth = getComputedStyle(button).width;

  if (
    previousWidth === nextWidth ||
    !button.animate ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) return;

  const animation = button.animate(
    [{ width: previousWidth }, { width: nextWidth }],
    { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  );
  widthAnimations.set(button, animation);
}
