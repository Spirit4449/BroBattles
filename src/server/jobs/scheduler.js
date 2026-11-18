// Repeating jobs skip overlapping ticks and drain any in-flight work on shutdown.
function createScheduler() {
  const timers = new Set();
  const running = new Set();
  let closed = false;
  function every(label, delay, fn, { immediate = false } = {}) {
    if (closed) throw new Error("Scheduler is closed");
    let active;
    const tick = () => {
      if (closed || active) return active;
      active = Promise.resolve()
        .then(fn)
        .catch((error) => console.error("[jobs]", label, error))
        .finally(() => {
          running.delete(active);
          active = null;
        });
      running.add(active);
      return active;
    };
    const timer = setInterval(tick, delay);
    timer.unref?.();
    timers.add(timer);
    if (immediate) void tick();
    return tick;
  }
  async function stop() {
    closed = true;
    for (const timer of timers) clearInterval(timer);
    timers.clear();
    await Promise.all(running);
  }
  return { every, stop };
}
module.exports = { createScheduler };
