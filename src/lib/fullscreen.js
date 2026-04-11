let fullscreenWirePromise = null;

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

function bindFullscreenButton(button) {
  if (!button || button.dataset.bbFullscreenBound === "true") return;
  button.dataset.bbFullscreenBound = "true";
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      if (getFullscreenElement()) {
        await exitFullscreen();
      } else {
        await requestFullscreen(document.documentElement || document.body);
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
