const DEFAULT_STATE = { lastBattle: null, lastShownAt: null, hints: {} };

function readState(storage, storageKey) {
  try {
    const parsed = JSON.parse(storage?.getItem(storageKey) || "null");
    if (!parsed || typeof parsed !== "object") {
      return { ...DEFAULT_STATE, hints: {} };
    }
    return {
      lastBattle:
        parsed.lastBattle != null && Number.isFinite(Number(parsed.lastBattle))
        ? Number(parsed.lastBattle)
        : null,
      lastShownAt:
        parsed.lastShownAt != null && Number.isFinite(Number(parsed.lastShownAt))
          ? Number(parsed.lastShownAt)
          : null,
      hints:
        parsed.hints && typeof parsed.hints === "object" ? parsed.hints : {},
    };
  } catch (_) {
    return { ...DEFAULT_STATE, hints: {} };
  }
}

function writeState(storage, storageKey, state) {
  try {
    storage?.setItem(storageKey, JSON.stringify(state));
  } catch (_) {}
}

export function getRecentModeStreak(battles = []) {
  const newest = Array.isArray(battles) ? battles[0] : null;
  const modeId = String(newest?.modeId || "").trim();
  if (!modeId) return { modeId: null, count: 0 };

  let count = 0;
  for (const battle of battles) {
    if (String(battle?.modeId || "").trim() !== modeId) break;
    count += 1;
  }
  return { modeId, count };
}

export function formatHintCountdown(target, now = Date.now()) {
  const remaining = Math.max(0, new Date(target).getTime() - Number(now));
  if (!Number.isFinite(remaining)) return "--:--:--";
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function chooseLobbyHint(hints, context, state) {
  const battleCount = Math.max(0, Number(context?.battleCount) || 0);
  const hasLastHintBattle =
    state?.lastBattle !== null &&
    state?.lastBattle !== undefined &&
    Number.isFinite(Number(state.lastBattle));
  const lastHintBattle = hasLastHintBattle ? Number(state.lastBattle) : null;
  const hintGapBattles = Math.max(
    0,
    Number(context?.hintGapBattles) || 0,
  );
  if (
    hasLastHintBattle &&
    battleCount - lastHintBattle < Math.max(1, hintGapBattles)
  ) {
    return null;
  }

  return (Array.isArray(hints) ? hints : [])
    .filter((hint) => {
      if (!hint?.id || !hint?.anchor) return false;
      if (typeof hint.when === "function" && !hint.when(context)) return false;
      const lastBattle = Number(state?.hints?.[hint.id]?.lastBattle);
      if (!Number.isFinite(lastBattle)) return true;
      return (
        battleCount - lastBattle >=
        Math.max(0, Number(hint.cooldownBattles) || 0)
      );
    })
    .sort((left, right) => {
      const leftLast = Number(state?.hints?.[left.id]?.lastBattle);
      const rightLast = Number(state?.hints?.[right.id]?.lastBattle);
      const leftAge = Number.isFinite(leftLast)
        ? leftLast
        : Number.NEGATIVE_INFINITY;
      const rightAge = Number.isFinite(rightLast)
        ? rightLast
        : Number.NEGATIVE_INFINITY;
      return (
        leftAge - rightAge ||
        Number(right.priority || 0) - Number(left.priority || 0)
      );
    })[0] || null;
}

export function chooseTimedLobbyHint(
  hints,
  context,
  state,
  now = Date.now(),
) {
  const lastShownAt = Number(state?.lastShownAt);
  const minGapMs = Math.max(0, Number(context?.minGapMs) || 0);
  if (
    state?.lastShownAt != null &&
    Number.isFinite(lastShownAt) &&
    Number(now) - lastShownAt < minGapMs
  ) {
    return null;
  }

  return (
    (Array.isArray(hints) ? hints : [])
      .filter((hint) => {
        if (!hint?.id || !hint?.anchor) return false;
        if (typeof hint.when === "function" && !hint.when(context)) return false;
        const hintState = state?.hints?.[hint.id] || {};
        const shownAt = Number(hintState.shownAt);
        if (
          Number.isFinite(shownAt) &&
          Number(now) - shownAt < Math.max(0, Number(hint.cooldownMs) || 0)
        ) {
          return false;
        }
        const instanceKey = String(hint.instanceKey || "");
        const instanceShownAt = Number(hintState.recentKeys?.[instanceKey]);
        return !(
          instanceKey &&
          Number.isFinite(instanceShownAt) &&
          Number(now) - instanceShownAt <
            Math.max(0, Number(hint.repeatMs) || 0)
        );
      })
      .sort(
        (left, right) =>
          Number(right.priority || 0) - Number(left.priority || 0),
      )[0] || null
  );
}

export function createLobbyHintController({
  storage = window.localStorage,
  storageKey = "bb_lobby_hints_v1",
  autoDismissMs = 9000,
} = {}) {
  let active = null;
  let timer = null;
  let exitTimer = null;
  let countdownTimer = null;
  let resizeHandler = null;
  let cancelled = false;
  const scheduledTimers = new Set();

  function dismiss(immediate = false) {
    if (timer) window.clearTimeout(timer);
    timer = null;
    if (countdownTimer) window.clearInterval(countdownTimer);
    countdownTimer = null;
    if (resizeHandler) window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
    if (active?.anchorClickHandler) {
      active.anchor.removeEventListener("click", active.anchorClickHandler);
    }
    const closing = active;
    closing?.anchor?.removeAttribute("aria-describedby");
    if (!closing) return;
    if (exitTimer) window.clearTimeout(exitTimer);
    const remove = () => {
      closing.element.remove();
      if (active === closing) active = null;
      exitTimer = null;
    };
    if (immediate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      remove();
      return;
    }
    closing.element.classList.remove("is-visible");
    closing.element.classList.add("is-leaving");
    exitTimer = window.setTimeout(remove, 240);
  }

  function position(element, anchor, hint) {
    const anchorRect = anchor.getBoundingClientRect();
    const hintRect = element.getBoundingClientRect();
    const gutter = 16;
    const viewportPadding = 10;
    const fitsBelow =
      anchorRect.bottom + gutter + hintRect.height <= window.innerHeight;
    const top = fitsBelow
      ? anchorRect.bottom + gutter
      : Math.max(viewportPadding, anchorRect.top - gutter - hintRect.height);
    const idealLeft =
      hint.align === "end"
        ? anchorRect.right - hintRect.width
        : hint.align === "start"
          ? anchorRect.left
          : anchorRect.left + anchorRect.width / 2 - hintRect.width / 2;
    const left = Math.max(
      viewportPadding,
      Math.min(window.innerWidth - hintRect.width - viewportPadding, idealLeft),
    );
    const arrowLeft = Math.max(
      18,
      Math.min(
        hintRect.width - 18,
        anchorRect.left + anchorRect.width / 2 - left,
      ),
    );

    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.setProperty("--lobby-hint-origin-x", `${arrowLeft}px`);
    element.dataset.placement = fitsBelow ? "below" : "above";
    const pointer = element.querySelector(".lobby-hint-pointer");
    if (pointer) pointer.style.left = `${arrowLeft}px`;
  }

  function show(hint, context = {}) {
    if (
      cancelled ||
      active ||
      !hint ||
      document.body.classList.contains("matchmaking-active")
    ) {
      return false;
    }
    const anchor =
      typeof hint.anchor === "string"
        ? document.querySelector(hint.anchor)
        : hint.anchor;
    if (!anchor || anchor.hidden || anchor.getClientRects().length === 0) {
      return false;
    }

    const state = readState(storage, storageKey);
    const battleCount = Math.max(0, Number(context.battleCount) || 0);
    const shownAt = Date.now();
    const previousHintState = state.hints[hint.id] || {};
    const recentKeys = { ...(previousHintState.recentKeys || {}) };
    const instanceKey = String(hint.instanceKey || "");
    if (instanceKey) recentKeys[instanceKey] = shownAt;
    Object.entries(recentKeys).forEach(([key, timestamp]) => {
      if (shownAt - Number(timestamp) > 30 * 60 * 1000) delete recentKeys[key];
    });
    state.lastBattle = battleCount;
    state.lastShownAt = shownAt;
    state.hints[hint.id] = {
      ...previousHintState,
      lastBattle: battleCount,
      shownAt,
      instanceKey: instanceKey || null,
      recentKeys,
    };
    writeState(storage, storageKey, state);

    const element = document.createElement("aside");
    const elementId = `lobby-hint-${hint.id}`;
    element.id = elementId;
    element.className = `lobby-hint${hint.variant ? ` is-${hint.variant}` : ""}`;
    element.setAttribute("role", hint.onClick ? "button" : "status");
    if (hint.onClick) {
      element.tabIndex = 0;
      element.setAttribute("aria-label", `View ${hint.title || "offer"} in the shop`);
    }
    element.innerHTML = `
      <span class="lobby-hint-pointer" aria-hidden="true"></span>
      <span class="lobby-hint-glint" aria-hidden="true"></span>
      <div class="lobby-hint-main">
        <div class="lobby-hint-header">
          <img class="lobby-hint-icon" alt="" hidden />
          <strong class="lobby-hint-title"></strong>
          <span class="lobby-hint-badge" hidden></span>
        </div>
        <span class="lobby-hint-message" hidden></span>
        <div class="lobby-hint-details" hidden>
          <strong class="lobby-hint-party-name"></strong>
          <span class="lobby-hint-party-subline">
            <span class="lobby-hint-party-mode"></span>
            <span class="lobby-hint-players" tabindex="0">
              <span class="lobby-hint-player-count"></span>
              <span class="lobby-hint-player-popover" role="tooltip"></span>
            </span>
          </span>
        </div>
        <div class="lobby-hint-art" hidden></div>
      </div>
      <div class="lobby-hint-meta" hidden>
        <span class="lobby-hint-price" hidden><img alt="" /><strong></strong></span>
        <span class="lobby-hint-countdown" hidden><img class="pixel-clock-icon" src="/assets/ui/shop-clock.webp" alt="" /><strong></strong></span>
      </div>
      ${hint.actionLabel ? '<button class="lobby-hint-action pixel-menu-button" type="button"></button>' : ""}
    `;
    element.querySelector(".lobby-hint-title").textContent =
      hint.title || "Tip";
    const message = element.querySelector(".lobby-hint-message");
    if (hint.message) {
      message.hidden = false;
      message.textContent = hint.message;
    }
    const icon = element.querySelector(".lobby-hint-icon");
    if (hint.icon) {
      icon.hidden = false;
      icon.src = hint.icon;
    }
    const action = element.querySelector(".lobby-hint-action");
    if (action) {
      action.textContent = hint.actionLabel;
      if (hint.actionVariant) action.classList.add(`is-${hint.actionVariant}`);
    }

    const details = element.querySelector(".lobby-hint-details");
    if (details && hint.details) {
      details.hidden = false;
      details.querySelector(".lobby-hint-party-name").textContent =
        hint.details.name || "Public Party";
      details.querySelector(".lobby-hint-party-mode").textContent =
        hint.details.mode || "";
      details.querySelector(".lobby-hint-player-count").textContent =
        hint.details.playerCount || "Players";
      const playerPopover = details.querySelector(
        ".lobby-hint-player-popover",
      );
      (Array.isArray(hint.players) ? hint.players : []).forEach((player) => {
        const row = document.createElement("span");
        row.className = "lobby-hint-player";
        const avatar = document.createElement("img");
        avatar.src = player.icon || "/assets/profile-icons/ninja.webp";
        avatar.alt = "";
        const name = document.createElement("strong");
        name.textContent = player.name || "Player";
        const trophies = document.createElement("span");
        trophies.innerHTML = '<img src="/assets/trophy.webp" alt="" />';
        trophies.append(String(Math.max(0, Number(player.trophies) || 0)));
        row.append(avatar, name, trophies);
        playerPopover.appendChild(row);
      });
    }

    const images = (Array.isArray(hint.images) ? hint.images : [])
      .filter(Boolean)
      .slice(0, 3);
    const art = element.querySelector(".lobby-hint-art");
    if (art && images.length) {
      art.hidden = false;
      images.forEach((source) => {
        const image = document.createElement("img");
        image.src = source;
        image.alt = "";
        art.appendChild(image);
      });
    }
    const badge = element.querySelector(".lobby-hint-badge");
    if (badge && hint.badge) {
      badge.hidden = false;
      badge.textContent = hint.badge;
    }
    const meta = element.querySelector(".lobby-hint-meta");
    const price = element.querySelector(".lobby-hint-price");
    if (price && hint.price?.text) {
      meta.hidden = false;
      price.hidden = false;
      price.querySelector("strong").textContent = hint.price.text;
      const priceImage = price.querySelector("img");
      if (hint.price.icon) priceImage.src = hint.price.icon;
      else priceImage.remove();
    }
    const countdown = element.querySelector(".lobby-hint-countdown");
    if (countdown && hint.countdownTo) {
      meta.hidden = false;
      countdown.hidden = false;
      const updateCountdown = () => {
        countdown.querySelector("strong").textContent = formatHintCountdown(
          hint.countdownTo,
        );
      };
      updateCountdown();
      countdownTimer = window.setInterval(updateCountdown, 1000);
    }

    document.body.appendChild(element);
    anchor.setAttribute("aria-describedby", elementId);
    const anchorClickHandler = () => dismiss();
    active = { element, anchor, anchorClickHandler };
    position(element, anchor, hint);

    action?.addEventListener("click", () => {
      dismiss();
      hint.onAction?.();
    });
    if (hint.onClick) {
      const openHint = () => {
        dismiss(true);
        hint.onClick();
      };
      element.addEventListener("click", openHint);
      element.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openHint();
      });
    }
    anchor.addEventListener("click", anchorClickHandler);
    resizeHandler = () => active && position(element, anchor, hint);
    window.addEventListener("resize", resizeHandler, { passive: true });
    timer = window.setTimeout(dismiss, autoDismissMs);
    requestAnimationFrame(() => element.classList.add("is-visible"));
    return true;
  }

  function showBest(hints, context = {}) {
    const state = readState(storage, storageKey);
    return show(chooseLobbyHint(hints, context, state), context);
  }

  function showTimedBest(hints, context = {}) {
    const state = readState(storage, storageKey);
    return show(chooseTimedLobbyHint(hints, context, state), context);
  }

  function schedule(hints, context = {}, delayMs = 5000) {
    const scheduledAt = performance.now();
    const wait = Math.max(0, Number(delayMs) || 0);
    const scheduledTimer = window.setTimeout(() => {
      scheduledTimers.delete(scheduledTimer);
      if (cancelled || document.body.classList.contains("matchmaking-active")) {
        return;
      }
      if (document.hidden) {
        const onVisible = () => {
          if (cancelled) {
            document.removeEventListener("visibilitychange", onVisible);
            return;
          }
          if (document.hidden) return;
          document.removeEventListener("visibilitychange", onVisible);
          showBest(hints, context);
        };
        document.addEventListener("visibilitychange", onVisible);
        return;
      }
      if (performance.now() - scheduledAt >= wait) showBest(hints, context);
    }, wait);
    scheduledTimers.add(scheduledTimer);
  }

  function repeat(
    task,
    { initialDelayMs = 5000, minIntervalMs = 20000, maxIntervalMs = 30000 } = {},
  ) {
    const queueNext = (delay) => {
      const repeatingTimer = window.setTimeout(async () => {
        scheduledTimers.delete(repeatingTimer);
        if (cancelled) return;
        try {
          if (!document.hidden) await task();
        } catch (_) {}
        if (cancelled) return;
        const min = Math.max(1000, Number(minIntervalMs) || 20000);
        const max = Math.max(min, Number(maxIntervalMs) || min);
        queueNext(Math.round(min + Math.random() * (max - min)));
      }, Math.max(0, Number(delay) || 0));
      scheduledTimers.add(repeatingTimer);
    };
    queueNext(initialDelayMs);
  }

  function cancel() {
    cancelled = true;
    scheduledTimers.forEach((scheduledTimer) =>
      window.clearTimeout(scheduledTimer),
    );
    scheduledTimers.clear();
    dismiss(true);
  }

  window.addEventListener("bb:matchmaking-start", cancel, { once: true });
  window.addEventListener("pagehide", cancel, { once: true });

  return { cancel, dismiss, repeat, schedule, showBest, showTimedBest };
}
