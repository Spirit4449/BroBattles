const TUTORIAL_MATCH_KEY = "bb_tutorial_first_match_v1";
const TIP_REST_MS = 5000;
const ACTION_LIFETIME_MS = 4800;
const TOP_LIFETIME_MS = 4200;
const MAX_STANDARD_SHOWS = 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function createBattleTutorialController({
  socket,
  getGameData,
  getScene,
  getPlayer,
  getPlayerState,
  getNetworkInputState,
  getLatestPowerups,
  getDead,
  isBattleReady,
} = {}) {
  let enabled = false;
  let battleStartedAt = 0;
  let lastUpdateAt = 0;
  let lastTipHiddenAt = Number.NEGATIVE_INFINITY;
  let activeTip = null;
  let root = null;
  let actionEl = null;
  let topEl = null;
  let markerEl = null;
  let routeEl = null;
  let routeLine = null;
  let listenersBound = false;
  let inputScheme = "wasd";
  let pointerDownAt = 0;
  let pointerButton = null;
  let quickAttackCount = 0;
  let lastAttackAt = 0;
  let lastSpecialAt = 0;
  let lastHealth = null;
  let firstDamageSeen = false;
  let fightBackPending = false;
  let lastMovementFxSeq = 0;
  let pendingPowerupId = null;
  let lastPowerupIds = new Set();
  let gasWasVisible = false;
  const pressed = new Set();
  const completed = new Set();
  const showCounts = new Map();

  const actionTips = {
    duck: { label: "Duck", copy: "Hold to guard and lower your hitbox" },
    wallJump: { label: "Wall jump", copy: "Jump + move away" },
    attack: { label: "Fight back", copy: "Attack now" },
    special: { label: "Super ready", copy: "Use your super" },
    powerup: { label: "Powerup", copy: "Collect it" },
    aim: { label: "Aim attacks", copy: "Hold, aim, release" },
  };

  const topTips = {
    lowHealth: {
      icon: "♥",
      tone: "danger",
      title: "Low health",
      copy: "You regain health when not attacking.",
    },
    collectPowerups: {
      icon: "✦",
      tone: "powerup",
      title: "Collect powerups",
      copy: "Each one gives you a different advantage.",
    },
    chargeSuper: {
      icon: "⚡",
      tone: "super",
      title: "Charge your super",
      copy: "Deal damage to fill the yellow bar.",
    },
    teammateChat: {
      icon: "●",
      tone: "team",
      title: "Talk to your team",
      copy: "Use battle chat to coordinate.",
    },
    suddenDeath: {
      icon: "!",
      tone: "danger",
      title: "The gas is rising",
      copy: "Stay above the green gas.",
    },
  };

  function ensureDom() {
    if (root) return;
    root = document.createElement("div");
    root.id = "battle-tutorial";
    root.className = "battle-tutorial hidden";
    root.setAttribute("aria-live", "polite");
    root.innerHTML = `
      <div class="tutorial-route" aria-hidden="true"><svg><line /></svg></div>
      <div class="tutorial-target-marker" aria-hidden="true"><span></span></div>
      <div class="tutorial-action-card" role="status"></div>
      <div class="tutorial-top-card" role="status"></div>`;
    document.body.appendChild(root);
    actionEl = root.querySelector(".tutorial-action-card");
    topEl = root.querySelector(".tutorial-top-card");
    markerEl = root.querySelector(".tutorial-target-marker");
    routeEl = root.querySelector(".tutorial-route");
    routeLine = routeEl?.querySelector("line");
  }

  function countFor(id) {
    return showCounts.get(id) || 0;
  }

  function canShow(id) {
    if (completed.has(id)) return false;
    if (id === "powerup") return true;
    return countFor(id) < MAX_STANDARD_SHOWS;
  }

  function hasRested(now) {
    return !activeTip && now - lastTipHiddenAt >= TIP_REST_MS;
  }

  function keyHtml({ label, codes, icon }) {
    const isDown = codes.some((code) => pressed.has(code));
    if (icon) {
      return `<span class="tutorial-mouse-key${isDown ? " is-down" : ""}" data-codes="${escapeHtml(codes.join(","))}"><img src="${escapeHtml(icon)}" alt="${escapeHtml(label)}"></span>`;
    }
    return `<kbd data-codes="${escapeHtml(codes.join(","))}" class="${isDown ? "is-down" : ""}">${escapeHtml(label)}</kbd>`;
  }

  function keysFor(id, wallSide = null) {
    if (id === "duck") {
      return inputScheme === "arrows"
        ? [{ label: "↓", codes: ["ArrowDown"] }]
        : [{ label: "S", codes: ["KeyS"] }];
    }
    if (id === "wallJump") {
      const awayLeft = wallSide === "right";
      return inputScheme === "arrows"
        ? [
            { label: "↑", codes: ["ArrowUp", "Space"] },
            {
              label: awayLeft ? "←" : "→",
              codes: [awayLeft ? "ArrowLeft" : "ArrowRight"],
            },
          ]
        : [
            { label: "W", codes: ["KeyW", "Space"] },
            {
              label: awayLeft ? "A" : "D",
              codes: [awayLeft ? "KeyA" : "KeyD"],
            },
          ];
    }
    if (id === "attack") {
      return [
        {
          label: "Left mouse button",
          codes: ["Mouse0"],
          icon: "/assets/mouse_left.webp",
        },
        { label: "J", codes: ["KeyJ"] },
      ];
    }
    if (id === "special") {
      return [
        {
          label: "Right mouse button",
          codes: ["Mouse2"],
          icon: "/assets/mouse_right.webp",
        },
        { label: "I", codes: ["KeyI"] },
      ];
    }
    if (id === "aim") {
      return [
        {
          label: "Hold mouse button",
          codes: ["Mouse0", "Mouse2"],
          icon: "/assets/mouse_left.webp",
        },
      ];
    }
    return [];
  }

  function keysRowHtml(id, wallSide = null) {
    const keys = keysFor(id, wallSide);
    if (!keys.length) return "";
    return `<div class="tutorial-key-row">${keys
      .map(
        (key, index) =>
          `${index ? '<span class="tutorial-key-or">or</span>' : ""}${keyHtml(key)}`,
      )
      .join("")}</div>`;
  }

  function showAction(id, options = {}, now = performance.now()) {
    if (!hasRested(now) || !canShow(id)) return false;
    const tip = actionTips[id];
    if (!tip) return false;
    ensureDom();
    activeTip = {
      kind: "action",
      id,
      shownAt: now,
      powerupId:
        options.powerupId == null ? null : String(options.powerupId),
      wallSide: options.wallSide || null,
    };
    showCounts.set(id, countFor(id) + 1);
    actionEl.innerHTML = `
      <span class="tutorial-action-text"><strong>${escapeHtml(tip.label)}</strong><span>${escapeHtml(tip.copy)}</span></span>
      ${keysRowHtml(id, activeTip.wallSide)}`;
    actionEl.dataset.tone =
      id === "special" ? "super" : id === "powerup" ? "powerup" : "default";
    actionEl.classList.remove("is-perfect", "is-leaving");
    root.classList.remove("hidden");
    requestAnimationFrame(() => actionEl.classList.add("is-visible"));
    return true;
  }

  function showTop(id, now = performance.now()) {
    if (!hasRested(now) || !canShow(id)) return false;
    const tip = topTips[id];
    if (!tip) return false;
    ensureDom();
    activeTip = { kind: "top", id, shownAt: now };
    showCounts.set(id, countFor(id) + 1);
    topEl.dataset.tone = tip.tone;
    topEl.innerHTML = `
      <span class="tutorial-top-icon">${escapeHtml(tip.icon)}</span>
      <span class="tutorial-top-content"><strong>${escapeHtml(tip.title)}</strong><span>${escapeHtml(tip.copy)}</span></span>`;
    topEl.classList.remove("is-leaving");
    root.classList.remove("hidden");
    requestAnimationFrame(() => topEl.classList.add("is-visible"));
    return true;
  }

  function hideActive({ complete = false, success = false } = {}) {
    if (!activeTip) return;
    const previous = activeTip;
    if (complete) completed.add(previous.id);
    markerEl?.classList.remove("is-visible");
    routeEl?.classList.remove("is-visible");

    if (previous.kind === "action" && success) {
      actionEl.classList.add("is-perfect");
      actionEl.querySelectorAll("kbd, .tutorial-mouse-key").forEach((key) => {
        key.classList.add("is-success");
      });
      if (previous.id === "attack" || previous.id === "duck") {
        const label = actionEl.querySelector(".tutorial-action-text strong");
        if (label) label.textContent = "Perfected ✓";
      }
    }

    const element = previous.kind === "action" ? actionEl : topEl;
    const leave = () => {
      if (activeTip !== previous) return;
      element.classList.add("is-leaving");
      element.classList.remove("is-visible");
      setTimeout(() => {
        if (activeTip === previous) activeTip = null;
      }, 180);
      lastTipHiddenAt = performance.now();
    };
    if (success) setTimeout(leave, previous.id === "attack" ? 520 : 260);
    else leave();
  }

  function updateKeyHighlights() {
    if (activeTip?.kind !== "action") return;
    actionEl.querySelectorAll("[data-codes]").forEach((key) => {
      const codes = String(key.dataset.codes || "").split(",");
      key.classList.toggle(
        "is-down",
        codes.some((code) => pressed.has(code)),
      );
    });
    if (activeTip.id === "wallJump") {
      const row = actionEl.querySelector(".tutorial-key-row");
      if (row) row.outerHTML = keysRowHtml("wallJump", activeTip.wallSide);
    }
  }

  function screenPoint(worldX, worldY) {
    const scene = getScene?.();
    const camera = scene?.cameras?.main;
    const canvas = scene?.game?.canvas;
    if (!camera || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX =
      rect.width / Math.max(1, Number(scene.scale?.width) || rect.width);
    const scaleY =
      rect.height / Math.max(1, Number(scene.scale?.height) || rect.height);
    return {
      x:
        rect.left +
        (camera.x + (worldX - camera.worldView.x) * camera.zoom) * scaleX,
      y:
        rect.top +
        (camera.y + (worldY - camera.worldView.y) * camera.zoom) * scaleY,
    };
  }

  function currentPowerup(id) {
    return (
      (getLatestPowerups?.() || []).find(
        (powerup) => String(powerup?.id) === String(id),
      ) || null
    );
  }

  function positionAction() {
    if (activeTip?.kind !== "action" || !actionEl) return;
    const player = getPlayer?.();
    let anchor = player;
    if (activeTip.id === "powerup") {
      const powerup = currentPowerup(activeTip.powerupId);
      if (!powerup) {
        hideActive();
        return;
      }
      anchor = { x: Number(powerup.x), y: Number(powerup.y) - 6 };
    }
    if (!anchor) return;
    const point = screenPoint(Number(anchor.x) || 0, Number(anchor.y) || 0);
    if (!point) return;
    const width = actionEl.offsetWidth || 190;
    const height = actionEl.offsetHeight || 62;
    const left = clamp(
      point.x - width / 2,
      10,
      window.innerWidth - width - 10,
    );
    const top = clamp(
      point.y - height - (activeTip.id === "powerup" ? 42 : 62),
      104,
      window.innerHeight - height - 14,
    );
    actionEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;

    if (activeTip.id !== "powerup") return;
    markerEl.style.transform = `translate3d(${Math.round(point.x - 23)}px, ${Math.round(point.y - 23)}px, 0)`;
    markerEl.classList.add("is-visible");
    const playerPoint = screenPoint(
      Number(player?.x) || 0,
      Number(player?.y) || 0,
    );
    if (!playerPoint || !routeLine) return;
    routeEl
      .querySelector("svg")
      ?.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);
    routeLine.setAttribute("x1", String(Math.round(playerPoint.x)));
    routeLine.setAttribute("y1", String(Math.round(playerPoint.y)));
    routeLine.setAttribute("x2", String(Math.round(point.x)));
    routeLine.setAttribute("y2", String(Math.round(point.y)));
    routeEl.classList.add("is-visible");
  }

  function markComplete(id, success = false) {
    completed.add(id);
    if (activeTip?.id === id) hideActive({ complete: true, success });
  }

  function onKeyDown(event) {
    if (!enabled || event.repeat) return;
    const tag = String(event.target?.tagName || "").toLowerCase();
    if (
      tag === "input" ||
      tag === "textarea" ||
      event.target?.isContentEditable
    )
      return;
    pressed.add(event.code);
    if (event.code.startsWith("Arrow")) inputScheme = "arrows";
    if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
      inputScheme = "wasd";
    }
    if (event.code === "KeyJ") {
      lastAttackAt = performance.now();
      fightBackPending = false;
      markComplete("attack", true);
    }
    if (event.code === "KeyI") {
      lastSpecialAt = performance.now();
      if ((getPlayerState?.()?.superRatio || 0) >= 1) {
        markComplete("special", true);
      }
    }
    updateKeyHighlights();
  }

  function onKeyUp(event) {
    pressed.delete(event.code);
    updateKeyHighlights();
  }

  function onPointerDown(event) {
    if (!enabled || (event.button !== 0 && event.button !== 2)) return;
    if (event.target !== getScene?.()?.game?.canvas) return;
    pointerDownAt = performance.now();
    pointerButton = event.button;
    pressed.add(`Mouse${event.button}`);
    updateKeyHighlights();
  }

  function onPointerUp(event) {
    if (!enabled || event.button !== pointerButton) return;
    const now = performance.now();
    const heldFor = now - pointerDownAt;
    pressed.delete(`Mouse${event.button}`);
    if (event.target === getScene?.()?.game?.canvas) {
      if (event.button === 0) {
        lastAttackAt = now;
        fightBackPending = false;
        markComplete("attack", true);
        if (heldFor < 260) quickAttackCount += 1;
      }
      if (event.button === 2) {
        lastSpecialAt = now;
        if ((getPlayerState?.()?.superRatio || 0) >= 1) {
          markComplete("special", true);
        }
      }
      if (heldFor >= 420) markComplete("aim", true);
    }
    pointerButton = null;
    pointerDownAt = 0;
    updateKeyHighlights();
  }

  function onPowerupCollected(payload = {}) {
    if (!enabled) return;
    const collectedId = String(payload.id ?? "");
    if (
      activeTip?.id === "powerup" &&
      activeTip.powerupId === collectedId
    ) {
      hideActive();
    }
    if (pendingPowerupId === collectedId) pendingPowerupId = null;
    const collector = payload.username || payload.name || payload.playerName;
    if (collector && collector === getGameData?.()?.yourName) {
      completed.add("powerup");
      completed.add("collectPowerups");
    }
  }

  function onGameChatMessage(message = {}) {
    const sender = message?.sender?.name || message?.username || message?.name;
    if (enabled && sender === getGameData?.()?.yourName) {
      markComplete("teammateChat");
    }
  }

  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    socket?.on?.("powerup:collected", onPowerupCollected);
    socket?.on?.("game:chat:message", onGameChatMessage);
  }

  function initialize() {
    const data = getGameData?.();
    const matchId = String(data?.matchId || "");
    if (!data?.isGuest || !matchId) return false;
    let tutorialMatch = "";
    try {
      tutorialMatch = localStorage.getItem(TUTORIAL_MATCH_KEY) || "";
      if (!tutorialMatch) {
        localStorage.setItem(TUTORIAL_MATCH_KEY, matchId);
        tutorialMatch = matchId;
      }
    } catch (_) {
      tutorialMatch = matchId;
    }
    if (tutorialMatch !== matchId) return false;
    enabled = true;
    battleStartedAt = 0;
    lastAttackAt = performance.now();
    lastSpecialAt = performance.now();
    lastHealth = getPlayerState?.()?.health ?? null;
    const network = getNetworkInputState?.() || {};
    lastMovementFxSeq = Number(network.movementFxSeq) || 0;
    lastPowerupIds = new Set(
      (getLatestPowerups?.() || []).map((powerup) => String(powerup?.id)),
    );
    ensureDom();
    bindListeners();
    return true;
  }

  function syncPowerups() {
    const powerups = getLatestPowerups?.() || [];
    const currentIds = new Set(
      powerups.map((powerup) => String(powerup?.id)),
    );
    if (
      activeTip?.id === "powerup" &&
      !currentIds.has(activeTip.powerupId)
    ) {
      hideActive();
    }
    if (pendingPowerupId && !currentIds.has(pendingPowerupId)) {
      pendingPowerupId = null;
    }
    for (const powerup of powerups) {
      const id = String(powerup?.id);
      if (!lastPowerupIds.has(id) && !completed.has("powerup")) {
        pendingPowerupId = id;
        break;
      }
    }
    lastPowerupIds = currentIds;
  }

  function evaluateActiveTip(now, state, network, gas) {
    if (!activeTip) return false;
    if (activeTip.id === "duck" && network.ducking === true) {
      hideActive({ complete: true, success: true });
      return true;
    }
    if (activeTip.id === "wallJump") {
      const seq = Number(network.movementFxSeq) || 0;
      if (
        seq !== lastMovementFxSeq &&
        network.movementFxType === "wall-jump"
      ) {
        lastMovementFxSeq = seq;
        hideActive({ complete: true, success: true });
        return true;
      }
    }
    if (
      activeTip.id === "special" &&
      state.superRatio < 1 &&
      now - lastSpecialAt < 1400
    ) {
      hideActive({ complete: true, success: true });
      return true;
    }
    if (
      activeTip.id === "lowHealth" &&
      state.health > Number(lastHealth || 0)
    ) {
      hideActive({ complete: true });
      return true;
    }
    if (activeTip.id === "suddenDeath" && gas.inGas) {
      const title = topEl.querySelector(".tutorial-top-content strong");
      const copy = topEl.querySelector(".tutorial-top-content > span");
      if (title) title.textContent = "Get out of the gas!";
      if (copy) copy.textContent = "Jump to higher ground now.";
    }
    const lifetime =
      activeTip.kind === "action" ? ACTION_LIFETIME_MS : TOP_LIFETIME_MS;
    if (now - activeTip.shownAt >= lifetime) hideActive();
    return true;
  }

  function chooseNextTip(now, state, network, gas) {
    if (!hasRested(now)) return;
    if (
      gas.visible &&
      canShow("suddenDeath") &&
      showTop("suddenDeath", now)
    )
      return;
    if (
      fightBackPending &&
      canShow("attack") &&
      showAction("attack", {}, now)
    )
      return;
    if (
      network.wallSliding &&
      canShow("wallJump") &&
      showAction("wallJump", { wallSide: network.wallSide }, now)
    )
      return;
    if (
      now - battleStartedAt > 2500 &&
      canShow("duck") &&
      showAction("duck", {}, now)
    )
      return;
    if (
      state.healthRatio > 0 &&
      state.healthRatio <= 0.35 &&
      canShow("lowHealth") &&
      showTop("lowHealth", now)
    )
      return;
    if (
      pendingPowerupId &&
      currentPowerup(pendingPowerupId) &&
      showAction("powerup", { powerupId: pendingPowerupId }, now)
    )
      return;
    if (
      state.superRatio >= 1 &&
      now - lastSpecialAt > 1800 &&
      canShow("special") &&
      showAction("special", {}, now)
    )
      return;
    if (
      state.superRatio >= 0.42 &&
      state.superRatio <= 0.78 &&
      canShow("chargeSuper") &&
      showTop("chargeSuper", now)
    )
      return;
    if (
      quickAttackCount >= 2 &&
      canShow("aim") &&
      showAction("aim", {}, now)
    ) {
      quickAttackCount = 0;
      return;
    }
    const elapsed = now - battleStartedAt;
    if (
      elapsed > 12000 &&
      canShow("collectPowerups") &&
      showTop("collectPowerups", now)
    )
      return;
    if (elapsed > 30000 && canShow("teammateChat")) {
      showTop("teammateChat", now);
    }
  }

  function update() {
    if (!enabled) return;
    const now = performance.now();
    if (getDead?.() || !isBattleReady?.()) {
      if (activeTip) hideActive();
      return;
    }
    if (!battleStartedAt) battleStartedAt = now;
    if (now - lastUpdateAt < 80) {
      positionAction();
      return;
    }
    lastUpdateAt = now;
    const player = getPlayer?.();
    if (!player?.active) return;
    const state = getPlayerState?.() || {};
    const network = getNetworkInputState?.() || {};
    const body = player.body;
    const airborneWallSide = body?.touching?.left || body?.blocked?.left
      ? "left"
      : body?.touching?.right || body?.blocked?.right
        ? "right"
        : null;
    if (!body?.touching?.down && airborneWallSide) {
      network.wallSliding = true;
      network.wallSide = airborneWallSide;
    }
    const scene = getScene?.();
    const worldHeight =
      Number(scene?.physics?.world?.bounds?.height) || 1000;
    const poisonY = Number(
      scene?._smoothPoisonY ?? scene?._poisonWaterY ?? worldHeight + 60,
    );
    const gas = {
      visible: poisonY < worldHeight + 5,
      inGas: Number(player.y) >= poisonY,
    };

    const healthDropped =
      Number.isFinite(Number(lastHealth)) &&
      Number(state.health) < Number(lastHealth);
    if (healthDropped && !firstDamageSeen) {
      firstDamageSeen = true;
      fightBackPending = true;
    }

    const movementSeq = Number(network.movementFxSeq) || 0;
    if (movementSeq !== lastMovementFxSeq) {
      if (network.movementFxType === "wall-jump") {
        markComplete("wallJump", true);
      }
      lastMovementFxSeq = movementSeq;
    }
    if (state.superRatio >= 1) completed.add("chargeSuper");
    if (gas.visible && !gasWasVisible) {
      lastTipHiddenAt = Math.min(lastTipHiddenAt, now - TIP_REST_MS);
    }
    gasWasVisible = gas.visible;

    syncPowerups();
    if (!evaluateActiveTip(now, state, network, gas)) {
      chooseNextTip(now, state, network, gas);
    }
    positionAction();
    lastHealth = state.health;
  }

  function destroy() {
    enabled = false;
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    socket?.off?.("powerup:collected", onPowerupCollected);
    socket?.off?.("game:chat:message", onGameChatMessage);
    listenersBound = false;
    root?.remove?.();
    root = null;
  }

  return { initialize, update, destroy, markComplete };
}
