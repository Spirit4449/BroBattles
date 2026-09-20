// Menus are available immediately on interaction, even before their idle setup.
export function createLazyInitializer(initialize) {
  let initialized = false;
  let value;
  return () => {
    if (!initialized) {
      value = initialize();
      initialized = true;
    }
    return value;
  };
}

export function deferLobbySetup(tasks) {
  const scope = window.__BB_PAGE_SCOPE__;
  const pending = [...tasks];
  let cancelled = false;
  let started = false;
  let frame;
  let idle;
  let timer;
  let unregister;
  const active = () => !cancelled && scope?.active !== false;

  function cancel() {
    cancelled = true;
    pending.length = 0;
    document.removeEventListener("lobby:ready", onReady);
    if (frame != null) window.cancelAnimationFrame(frame);
    if (idle != null) window.cancelIdleCallback(idle);
    if (timer != null) window.clearTimeout(timer);
    unregister?.();
  }

  function scheduleNext() {
    if (!active() || !pending.length) {
      cancel();
      return;
    }
    const run = () => {
      idle = timer = null;
      if (!active()) return;
      const task = pending.shift();
      try {
        Promise.resolve(task()).catch(reportError);
      } catch (error) {
        reportError(error);
      }
      scheduleNext();
    };
    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(run, { timeout: 1000 });
    } else {
      timer = window.setTimeout(run, 32);
    }
  }

  function reportError(error) {
    if (scope?.active !== false && error?.name !== "AbortError") {
      console.warn("[lobby] deferred setup failed:", error);
    }
  }

  function onReady() {
    if (!active() || started) return;
    started = true;
    document.removeEventListener("lobby:ready", onReady);
    // Readiness fires before paint. Yield a painted frame before even an idle
    // callback can construct menu DOM or start optional network requests.
    frame = window.requestAnimationFrame(() => {
      if (!active()) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        scheduleNext();
      });
    });
  }

  unregister = scope?.onDispose(cancel);
  const lobby = document.getElementById("lobby-area");
  if (lobby && !lobby.hasAttribute("data-loading")) onReady();
  else document.addEventListener("lobby:ready", onReady);
  return cancel;
}
