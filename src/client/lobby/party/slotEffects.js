// Lobby party-slot presentation: spawn/exit animations, ready bursts,
// selecting rings and status classes. Pure DOM; no party state.

const __lobbySpawnCleanupTimers = new WeakMap();
const __lobbySpawnEndTimes = new WeakMap();
const __lobbyReadyEffectCleanupTimers = new WeakMap();
const LOBBY_SPAWN_ENTER_MS = 980;
const LOBBY_SPAWN_EXIT_MS = 820;

export function prefersReducedLobbyMotion() {
  return Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
  );
}

function ensureLobbySpawnEffect(slot) {
  let effect = slot?.querySelector(":scope > .lobby-spawn-fx");
  if (!slot || effect) return effect;

  effect = document.createElement("div");
  effect.className = "lobby-spawn-fx";
  effect.setAttribute("aria-hidden", "true");

  const column = document.createElement("span");
  column.className = "lobby-spawn-fx-column";
  effect.appendChild(column);

  const core = document.createElement("span");
  core.className = "lobby-spawn-fx-core";
  effect.appendChild(core);

  const floor = document.createElement("span");
  floor.className = "lobby-spawn-fx-floor";
  effect.appendChild(floor);

  const shardLayout = [
    [-50, 18, 5, 7, 0, -8, 430],
    [-44, 62, 4, 15, 110, 5, 520],
    [-37, 92, 8, 8, 40, -4, 390],
    [-31, 38, 3, 24, 190, 7, 560],
    [-25, 76, 6, 11, 70, -7, 470],
    [-19, 20, 9, 9, 230, 4, 410],
    [-13, 108, 4, 18, 130, -5, 540],
    [-7, 51, 7, 7, 20, 8, 420],
    [0, 84, 4, 27, 170, -3, 590],
    [7, 29, 8, 12, 90, 6, 450],
    [13, 119, 6, 6, 250, -8, 400],
    [19, 66, 5, 16, 30, 5, 510],
    [26, 15, 7, 7, 150, -6, 390],
    [32, 101, 3, 22, 210, 7, 570],
    [38, 46, 9, 10, 60, -4, 440],
    [44, 81, 5, 6, 270, 8, 380],
    [49, 27, 4, 18, 120, -5, 530],
    [54, 111, 7, 8, 180, 4, 420],
  ];

  shardLayout.forEach(
    ([x, y, width, height, delay, drift, duration], index) => {
      const shard = document.createElement("i");
      shard.className = "lobby-spawn-fx-shard";
      shard.style.setProperty("--spawn-x", `${x}px`);
      shard.style.setProperty("--spawn-y", `${y}px`);
      shard.style.setProperty("--spawn-width", `${width}px`);
      shard.style.setProperty("--spawn-height", `${height}px`);
      shard.style.setProperty("--spawn-delay", `${delay}ms`);
      shard.style.setProperty("--spawn-drift", `${drift}px`);
      shard.style.setProperty("--spawn-duration", `${duration}ms`);
      shard.style.setProperty("--spawn-shard-index", String(index));
      effect.appendChild(shard);
    },
  );

  slot.appendChild(effect);
  return effect;
}

export function clearLobbySpawnAnimation(slot) {
  if (!slot) return;
  const cleanupTimer = __lobbySpawnCleanupTimers.get(slot);
  if (cleanupTimer) window.clearTimeout(cleanupTimer);
  __lobbySpawnCleanupTimers.delete(slot);
  __lobbySpawnEndTimes.delete(slot);
  slot.classList.remove("lobby-spawn-enter", "lobby-spawn-exit");
}

export function getLobbySpawnTimeRemaining(slot) {
  return Math.max(0, (__lobbySpawnEndTimes.get(slot) || 0) - performance.now());
}

export function playLobbySpawnAnimation(slot, direction = "enter") {
  if (!slot) return 0;

  ensureLobbySpawnEffect(slot);
  clearLobbySpawnAnimation(slot);

  if (prefersReducedLobbyMotion()) return 0;

  const isExit = direction === "exit";
  const animationClass = isExit ? "lobby-spawn-exit" : "lobby-spawn-enter";
  const duration = isExit ? LOBBY_SPAWN_EXIT_MS : LOBBY_SPAWN_ENTER_MS;

  // Force a fresh animation even if a player leaves immediately after joining.
  void slot.offsetWidth;
  slot.classList.add(animationClass);

  const cleanupTimer = window.setTimeout(() => {
    slot.classList.remove(animationClass);
    __lobbySpawnCleanupTimers.delete(slot);
    __lobbySpawnEndTimes.delete(slot);
  }, duration);
  __lobbySpawnCleanupTimers.set(slot, cleanupTimer);
  __lobbySpawnEndTimes.set(slot, performance.now() + duration);
  return duration;
}

export function triggerLobbyCharacterSplash(slot) {
  if (!slot) return;
  slot.classList.remove("character-splash");
  void slot.offsetWidth;
  slot.classList.add("character-splash");
  window.setTimeout(() => {
    slot.classList.remove("character-splash");
  }, 700);
}

function ensureLobbyReadyEffect(slot) {
  let effect = slot?.querySelector(":scope > .lobby-ready-fx");
  if (!slot || effect) return effect;

  effect = document.createElement("div");
  effect.className = "lobby-ready-fx";
  effect.setAttribute("aria-hidden", "true");

  const lineLayout = [
    [-26, -88, -32, 2, 22, "#50d9ff", "#ddf8ff", 270, 80],
    [-19, -72, -20, 4, 47, "#7dff68", "#e7ffdc", 350, 18],
    [-12, -104, -39, 3, 31, "#ffd95a", "#fff5c2", 300, 112],
    [-5, -91, -13, 5, 58, "#42efcf", "#d5fff6", 390, 0],
    [3, -76, -29, 2, 27, "#b68cff", "#eee2ff", 285, 57],
    [10, -98, -5, 4, 43, "#8dff45", "#ebffcf", 365, 33],
    [17, -68, -24, 3, 19, "#70b9ff", "#e0f1ff", 250, 126],
    [24, -86, -35, 2, 52, "#ffe879", "#fff9d4", 330, 91],
  ];

  lineLayout.forEach(
    ([x, startY, endY, width, height, color, bright, duration, delay]) => {
      const line = document.createElement("i");
      line.className = "lobby-ready-fx-line";
      line.style.setProperty("--ready-line-x", `${x}px`);
      line.style.setProperty("--ready-start-y", `${startY}px`);
      line.style.setProperty("--ready-end-y", `${endY}px`);
      line.style.setProperty("--ready-line-width", `${width}px`);
      line.style.setProperty("--ready-line-height", `${height}px`);
      line.style.setProperty("--ready-line-color", color);
      line.style.setProperty("--ready-line-bright", bright);
      line.style.setProperty("--ready-line-duration", `${duration}ms`);
      line.style.setProperty("--ready-line-delay", `${delay}ms`);
      line.style.setProperty(
        "--unready-line-duration",
        `${Math.round(duration * 0.72)}ms`,
      );
      line.style.setProperty(
        "--unready-line-delay",
        `${Math.round(delay * 0.45)}ms`,
      );
      effect.appendChild(line);
    },
  );

  slot.appendChild(effect);
  return effect;
}

export function ensureLobbySelectingRing(slot) {
  let ring = slot?.querySelector(":scope > .lobby-selecting-ring");
  if (!slot || ring) return ring;
  ring = document.createElement("div");
  ring.className = "lobby-selecting-ring";
  ring.setAttribute("aria-hidden", "true");
  slot.appendChild(ring);
  return ring;
}

function playLobbyReadyEffect(slot, isReady) {
  if (!slot) return;
  ensureLobbyReadyEffect(slot);

  const previousTimer = __lobbyReadyEffectCleanupTimers.get(slot);
  if (previousTimer) window.clearTimeout(previousTimer);

  slot.classList.remove("lobby-ready-burst", "lobby-unready-burst");
  if (prefersReducedLobbyMotion()) return;

  void slot.offsetWidth;
  const effectClass = isReady ? "lobby-ready-burst" : "lobby-unready-burst";
  slot.classList.add(effectClass);
  const cleanupTimer = window.setTimeout(() => {
    slot.classList.remove(effectClass);
    __lobbyReadyEffectCleanupTimers.delete(slot);
  }, isReady ? 560 : 400);
  __lobbyReadyEffectCleanupTimers.set(slot, cleanupTimer);
}

export function applyLobbyStatusVisualState(slot, previousStatus, nextStatus) {
  if (!slot) return;
  ensureLobbySelectingRing(slot);
  const previousClass = statusToClass(previousStatus);
  const nextClass = statusToClass(nextStatus);

  slot.classList.toggle("is-selecting-character", nextClass === "selecting-character");

  const wasAvailable = previousClass === "online" || previousClass === "not-ready";
  const isAvailable = nextClass === "online" || nextClass === "not-ready";
  if (nextClass === "ready" && wasAvailable) {
    playLobbyReadyEffect(slot, true);
  } else if (previousClass === "ready" && isAvailable) {
    playLobbyReadyEffect(slot, false);
  }
}

export function normalizeStatusLabel(status) {
  const s = String(status || "")
    .trim()
    .toLowerCase();
  if (s === "offline") return "offline";
  if (s === "ready") return "ready";
  if (s === "online" || s === "idle") return "online";
  if (s === "in battle") return "In Battle";
  if (s === "end screen") return "End Screen";
  if (s === "selecting character") return "Selecting Character";
  if (s.startsWith("not ")) return "not ready";
  return status || "online";
}

export function statusToClass(status) {
  const s = String(status || "")
    .trim()
    .toLowerCase();
  if (s === "offline") return "offline";
  if (s === "in battle") return "in-battle";
  if (s === "end screen") return "end-screen";
  if (s === "selecting character") return "selecting-character";
  // Explicit checks first
  if (s === "online" || s === "idle") return "online";
  if (s === "ready") return "ready";
  if (s === "not ready" || s === "not-ready" || s.startsWith("not "))
    return "not-ready";
  // Semantic hints
  if (s.includes("battle") || s.includes("live")) return "ready";
  if (s.includes("queue")) return "online";
  // Fallbacks
  if (s.includes("ready")) return "ready";
  return "online";
}
