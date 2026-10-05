let fullscreenWirePromise = null;
let viewportVarsWired = false;
const FULLSCREEN_INTENT_KEY = "bb_fullscreen_intent";
const IOS_IMMERSIVE_CLASS = "bb-ios-immersive-mode";

function readFullscreenIntent() {
  try {
    return localStorage.getItem(FULLSCREEN_INTENT_KEY) === "1";
  } catch (_) {
    return false;
  }
}

function writeFullscreenIntent(enabled) {
  try {
    localStorage.setItem(FULLSCREEN_INTENT_KEY, enabled ? "1" : "0");
  } catch (_) {}
}

function getFullscreenElement() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement ||
    null
  );
}

function isAppleMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  const touchPoints = Number(navigator.maxTouchPoints || 0);
  return (
    /iPhone|iPad|iPod/i.test(ua) || (platform === "MacIntel" && touchPoints > 1)
  );
}

function supportsDocumentFullscreen() {
  const target = document.documentElement || document.body;
  if (!target) return false;
  return (
    typeof target.requestFullscreen === "function" ||
    typeof target.webkitRequestFullscreen === "function" ||
    typeof target.mozRequestFullScreen === "function" ||
    typeof target.msRequestFullscreen === "function"
  );
}

function shouldUseImmersiveFallback() {
  return isAppleMobileDevice() && !supportsDocumentFullscreen();
}

function isImmersiveFallbackActive() {
  return (
    document.documentElement?.classList?.contains?.(IOS_IMMERSIVE_CLASS) ||
    document.body?.classList?.contains?.(IOS_IMMERSIVE_CLASS) ||
    false
  );
}

function getVisualViewportSize() {
  const vv = window.visualViewport;
  const width = Math.max(
    1,
    Number(vv?.width) ||
      Number(window.innerWidth) ||
      Number(document.documentElement?.clientWidth) ||
      1,
  );
  const height = Math.max(
    1,
    Number(vv?.height) ||
      Number(window.innerHeight) ||
      Number(document.documentElement?.clientHeight) ||
      1,
  );
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

function applyViewportCssVars() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root) return;
  const size = getVisualViewportSize();
  root.style.setProperty("--bb-viewport-width", `${size.width}px`);
  root.style.setProperty("--bb-viewport-height", `${size.height}px`);
}

function wireViewportCssVars() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (viewportVarsWired) return;
  viewportVarsWired = true;
  applyViewportCssVars();
  const onChange = () => applyViewportCssVars();
  window.addEventListener("resize", onChange, { passive: true });
  window.addEventListener("orientationchange", onChange, { passive: true });
  window.visualViewport?.addEventListener?.("resize", onChange, {
    passive: true,
  });
  window.visualViewport?.addEventListener?.("scroll", onChange, {
    passive: true,
  });
}

function setImmersiveFallbackActive(enabled) {
  const active = !!enabled;
  document.documentElement?.classList?.toggle?.(IOS_IMMERSIVE_CLASS, active);
  document.body?.classList?.toggle?.(IOS_IMMERSIVE_CLASS, active);
  if (active) {
    try {
      window.scrollTo(0, 0);
    } catch (_) {}
  }
  applyViewportCssVars();
  try {
    window.dispatchEvent(new Event("resize"));
  } catch (_) {}
}

async function requestFullscreen(target) {
  if (!target) return false;
  if (typeof target.requestFullscreen === "function") {
    await target.requestFullscreen();
    return true;
  }
  if (typeof target.webkitRequestFullscreen === "function") {
    await target.webkitRequestFullscreen();
    return true;
  }
  if (typeof target.mozRequestFullScreen === "function") {
    await target.mozRequestFullScreen();
    return true;
  }
  if (typeof target.msRequestFullscreen === "function") {
    await target.msRequestFullscreen();
    return true;
  }
  return false;
}

async function exitFullscreen() {
  if (typeof document.exitFullscreen === "function") {
    await document.exitFullscreen();
    return true;
  }
  if (typeof document.webkitExitFullscreen === "function") {
    await document.webkitExitFullscreen();
    return true;
  }
  if (typeof document.mozCancelFullScreen === "function") {
    await document.mozCancelFullScreen();
    return true;
  }
  if (typeof document.msExitFullscreen === "function") {
    await document.msExitFullscreen();
    return true;
  }
  return false;
}

function syncFullscreenButtons() {
  const usingFallback = shouldUseImmersiveFallback();
  const isActive = !!getFullscreenElement() || isImmersiveFallbackActive();
  const activeLabel = usingFallback ? "Exit immersive mode" : "Exit fullscreen";
  const idleLabel = usingFallback ? "Enter immersive mode" : "Fullscreen";
  document.querySelectorAll("[data-fullscreen-toggle]").forEach((button) => {
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    button.title = isActive ? activeLabel : idleLabel;
    button.setAttribute("aria-label", isActive ? activeLabel : idleLabel);
  });
}

function handleFullscreenStateChange() {
  const isActive = !!getFullscreenElement() || isImmersiveFallbackActive();
  // If fullscreen was exited externally (e.g. ESC), stop future auto-restore.
  if (!isActive && readFullscreenIntent()) {
    writeFullscreenIntent(false);
  }
  syncFullscreenButtons();
}

function armFullscreenRestoreOnInteraction() {
  const events = ["pointerdown", "keydown", "touchstart"];
  let restoreComplete = false;

  const tryRestore = async () => {
    if (restoreComplete) return;
    if (!readFullscreenIntent()) {
      cleanup();
      return;
    }
    if (getFullscreenElement()) {
      cleanup();
      syncFullscreenButtons();
      return;
    }

    try {
      const didEnter = await requestFullscreen(
        document.documentElement || document.body,
      );
      if (didEnter) {
        cleanup();
        syncFullscreenButtons();
      }
    } catch (_) {}
  };

  const onInteraction = () => {
    void tryRestore();
  };

  const cleanup = () => {
    if (restoreComplete) return;
    restoreComplete = true;
    events.forEach((name) => {
      document.removeEventListener(name, onInteraction, true);
    });
  };

  events.forEach((name) => {
    document.addEventListener(name, onInteraction, {
      once: true,
      capture: true,
      passive: true,
    });
  });
}

async function restoreFullscreenFromIntent() {
  if (!readFullscreenIntent()) {
    setImmersiveFallbackActive(false);
    syncFullscreenButtons();
    return;
  }
  if (getFullscreenElement() || isImmersiveFallbackActive()) {
    syncFullscreenButtons();
    return;
  }

  if (shouldUseImmersiveFallback()) {
    setImmersiveFallbackActive(true);
    syncFullscreenButtons();
    return;
  }

  try {
    const didEnter = await requestFullscreen(
      document.documentElement || document.body,
    );
    if (didEnter) {
      syncFullscreenButtons();
      return;
    }
  } catch (_) {}

  armFullscreenRestoreOnInteraction();
}

function bindFullscreenButton(button) {
  if (!button || button.dataset.bbFullscreenBound === "true") return;
  button.dataset.bbFullscreenBound = "true";
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      if (getFullscreenElement()) {
        await exitFullscreen();
        writeFullscreenIntent(false);
        setImmersiveFallbackActive(false);
      } else if (isImmersiveFallbackActive()) {
        setImmersiveFallbackActive(false);
        writeFullscreenIntent(false);
      } else {
        const didEnter = await requestFullscreen(
          document.documentElement || document.body,
        );
        if (didEnter) {
          writeFullscreenIntent(true);
          setImmersiveFallbackActive(false);
        } else if (shouldUseImmersiveFallback()) {
          setImmersiveFallbackActive(true);
          writeFullscreenIntent(true);
        }
      }
    } catch (_) {}
    syncFullscreenButtons();
  });
}

function bindFullscreenToggles() {
  document
    .querySelectorAll("[data-fullscreen-toggle]")
    .forEach(bindFullscreenButton);
  syncFullscreenButtons();
}

export function wireFullscreenToggles() {
  if (typeof document === "undefined") return;
  if (fullscreenWirePromise) return fullscreenWirePromise;

  const start = () => {
    wireViewportCssVars();
    bindFullscreenToggles();
    document.addEventListener("fullscreenchange", handleFullscreenStateChange);
    document.addEventListener(
      "webkitfullscreenchange",
      handleFullscreenStateChange,
    );
    document.addEventListener(
      "mozfullscreenchange",
      handleFullscreenStateChange,
    );
    document.addEventListener(
      "MSFullscreenChange",
      handleFullscreenStateChange,
    );
    void restoreFullscreenFromIntent();
  };

  if (document.readyState === "loading") {
    fullscreenWirePromise = new Promise((resolve) => {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          start();
          resolve();
        },
        { once: true },
      );
    });
  } else {
    start();
    fullscreenWirePromise = Promise.resolve();
  }

  return fullscreenWirePromise;
}
