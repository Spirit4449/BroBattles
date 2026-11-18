export const TYPING_STALE_MS = 4000;

export function createLocalTypingEmitter({ emit, idleMs, heartbeatMs, periodic = false }) {
  let active = false;
  let lastSentAt = 0;
  let stopTimer;
  let heartbeatTimer;

  function emitTyping(next) {
    lastSentAt = Date.now();
    emit(next);
  }

  function reset() {
    window.clearTimeout(stopTimer);
    window.clearInterval(heartbeatTimer);
    const wasActive = active;
    active = false;
    return wasActive;
  }

  function stop() {
    if (reset()) emitTyping(false);
  }

  function noteInput() {
    window.clearTimeout(stopTimer);
    stopTimer = window.setTimeout(stop, idleMs);
    if (!active) {
      active = true;
      emitTyping(true);
      if (periodic) heartbeatTimer = window.setInterval(() => emitTyping(true), heartbeatMs);
    } else if (!periodic && Date.now() - lastSentAt >= heartbeatMs) {
      emitTyping(true);
    }
  }

  return { noteInput, stop, destroy: reset };
}
