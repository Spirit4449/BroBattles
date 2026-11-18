export function replayClass(element, className) {
  if (!element?.classList) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

export function prefersReducedMotion() {
  try {
    return typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch (_) {
    return false;
  }
}
