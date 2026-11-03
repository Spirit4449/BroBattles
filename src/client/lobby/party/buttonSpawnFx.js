// A faint, button-sized take on the lobby spawn effect: a light column, floor
// line and rising pixel shards. Played when mode, map or ready state changes.

import { prefersReducedLobbyMotion } from "./slotEffects.js";

const BUTTON_SPAWN_MS = 440;
const __buttonSpawnTimers = new WeakMap();

// [left %, rise px, size px, delay ms, drift px]
const SHARD_LAYOUT = [
  [8, 14, 3, 20, -3],
  [17, 22, 3, 60, 2],
  [26, 12, 4, 0, -2],
  [36, 20, 3, 80, 3],
  [45, 16, 3, 40, -2],
  [54, 24, 3, 70, 2],
  [63, 12, 4, 10, -3],
  [72, 20, 3, 90, 2],
  [81, 18, 3, 50, -2],
  [90, 12, 3, 30, 3],
];

function ensureButtonSpawnFx(host) {
  let effect = host.querySelector(":scope > .button-spawn-fx");
  if (effect) return effect;

  effect = document.createElement("span");
  effect.className = "button-spawn-fx";
  effect.setAttribute("aria-hidden", "true");
  for (const part of ["column", "floor"]) {
    const el = document.createElement("span");
    el.className = `button-spawn-fx-${part}`;
    effect.appendChild(el);
  }
  for (const [left, rise, size, delay, drift] of SHARD_LAYOUT) {
    const shard = document.createElement("i");
    shard.className = "button-spawn-fx-shard";
    shard.style.setProperty("--shard-left", `${left}%`);
    shard.style.setProperty("--shard-rise", `${rise}px`);
    shard.style.setProperty("--shard-size", `${size}px`);
    shard.style.setProperty("--shard-delay", `${delay}ms`);
    shard.style.setProperty("--shard-drift", `${drift}px`);
    effect.appendChild(shard);
  }
  host.appendChild(effect);
  return effect;
}

/**
 * Plays the effect over `target`. Inputs cannot hold children, so `host` (a
 * positioned ancestor) carries the overlay, sized to the target's box.
 */
export function playButtonSpawnFx(target, { host = target, direction = "enter" } = {}) {
  if (!target || !host || prefersReducedLobbyMotion()) return;

  const effect = ensureButtonSpawnFx(host);
  if (host !== target) {
    effect.style.left = `${target.offsetLeft}px`;
    effect.style.top = `${target.offsetTop}px`;
    effect.style.width = `${target.offsetWidth}px`;
    effect.style.height = `${target.offsetHeight}px`;
  }

  window.clearTimeout(__buttonSpawnTimers.get(host));
  host.classList.remove("button-spawn-enter", "button-spawn-exit");
  // Restart the animation when changes arrive back to back.
  void host.offsetWidth;
  host.classList.add(direction === "exit" ? "button-spawn-exit" : "button-spawn-enter");
  __buttonSpawnTimers.set(
    host,
    window.setTimeout(() => {
      host.classList.remove("button-spawn-enter", "button-spawn-exit");
      __buttonSpawnTimers.delete(host);
    }, BUTTON_SPAWN_MS),
  );
}

/** Plays only when `key` differs from the last one seen, never on first sync. */
export function playButtonSpawnFxOnChange(target, key) {
  if (!target) return;
  const previous = target.dataset.spawnFxKey;
  target.dataset.spawnFxKey = key;
  if (previous !== undefined && previous !== key) playButtonSpawnFx(target);
}
