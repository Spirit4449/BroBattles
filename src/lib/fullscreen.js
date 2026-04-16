let fullscreenWirePromise = null;
const FULLSCREEN_INTENT_KEY = "bb_fullscreen_intent";

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
  const isActive = !!getFullscreenElement();
  document.querySelectorAll("[data-fullscreen-toggle]").forEach((button) => {
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    button.title = isActive ? "Exit fullscreen" : "Fullscreen";
  });
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
  if (!readFullscreenIntent() || getFullscreenElement()) {
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
      } else {
        const didEnter = await requestFullscreen(
          document.documentElement || document.body,
        );
        if (didEnter) {
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
    bindFullscreenToggles();
    document.addEventListener("fullscreenchange", syncFullscreenButtons);
    document.addEventListener("webkitfullscreenchange", syncFullscreenButtons);
    document.addEventListener("mozfullscreenchange", syncFullscreenButtons);
    document.addEventListener("MSFullscreenChange", syncFullscreenButtons);
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
