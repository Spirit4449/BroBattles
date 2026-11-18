export function createComposerCooldown(
  { textarea, sendBtn, resizeComposer },
  { defaultMs, minimumMs, onLock, onRelease },
) {
  let timer = null;
  let draft = "";
  let until = 0;

  function destroy() {
    window.clearTimeout(timer);
    timer = null;
    until = 0;
  }

  function clear() {
    if (timer === null) return;
    destroy();
    textarea.disabled = false;
    sendBtn.disabled = false;
    textarea.value = draft;
    draft = "";
    resizeComposer();
    onRelease?.();
  }

  function apply(message, durationMs = defaultMs) {
    const duration = Math.max(minimumMs, Number(durationMs) || defaultMs);
    if (timer === null) draft = String(textarea.value || "");
    textarea.value = String(message || "Slow down.");
    resizeComposer();
    textarea.placeholder = textarea.value;
    textarea.disabled = true;
    sendBtn.disabled = true;
    onLock?.();
    window.clearTimeout(timer);
    until = Date.now() + duration;
    timer = window.setTimeout(clear, duration);
  }

  return { apply, clear, isActive: () => until > Date.now(), destroy };
}
