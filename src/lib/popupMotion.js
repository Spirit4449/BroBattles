const POPUP_MOTION_MS = 150;

function prefersReducedMotion() {
  return Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
  );
}

export function dismissPopup(element, onDismissed) {
  if (!element) {
    onDismissed?.();
    return;
  }

  let finished = false;
  let fallbackTimer = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    element.removeEventListener("animationend", handleAnimationEnd);
    element.classList.remove("bb-popup-closing");
    onDismissed?.();
  };
  const handleAnimationEnd = (event) => {
    if (event.target === element) finish();
  };

  if (prefersReducedMotion()) {
    finish();
    return;
  }

  element.classList.add("bb-popup-closing");
  element.addEventListener("animationend", handleAnimationEnd);
  fallbackTimer = window.setTimeout(finish, POPUP_MOTION_MS + 60);
}

