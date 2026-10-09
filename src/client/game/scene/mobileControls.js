// Touch controls for phones and tablets. Everything is a DOM overlay above the
// canvas (styles in styles/mobileControls.css); localPlayer reads the state
// through the is*/consume* accessors each frame.
//
// Layout: a floating movement stick on the left half, and a right-thumb
// cluster arranged by how often each control is used. Attack is the largest
// and sits nearest the corner, jump is next to it, super and dash are one
// reach away, and duck (also available by pulling the stick down) is smallest.

const STICK_DEADZONE = 0.22;
const MOVE_DIRECTION_THRESHOLD = 0.28;
const DUCK_STICK_MIN_DY = 0.82;
const DUCK_STICK_MIN_STRENGTH = 0.55;
const DASH_STICK_MIN_DY = 0.5;
const DASH_STICK_MIN_STRENGTH = 0.4;
const AIM_STICK_DEADZONE = 0.25;
const AIM_STICK_RANGE = 240;

// Sizes and offsets in px at scale 1. Offsets are centre positions measured
// from the bottom-right safe corner.
const CLUSTER = {
  basic: { size: 100, right: 96, bottom: 94 },
  jump: { size: 78, right: 214, bottom: 62 },
  special: { size: 76, right: 202, bottom: 170 },
  dash: { size: 66, right: 86, bottom: 212 },
  duck: { size: 56, right: 304, bottom: 50 },
};
const MOVE_STICK = { size: 112, thumb: 50, left: 104, bottom: 100 };

// 12x12 pixel art, drawn twice: an ink copy one pixel lower as the shadow.
const pixelIcon = (d) =>
  `<svg viewBox="0 0 12 13" shape-rendering="crispEdges" aria-hidden="true"><path class="bbm-icon-shadow" transform="translate(0 1)" d="${d}"/><path d="${d}"/></svg>`;
const ICONS = {
  jump: pixelIcon("M5 1h2v1H5zM4 2h4v1H4zM3 3h6v1H3zM2 4h8v1H2zM1 5h10v1H1zM4 6h4v1H4zM4 7h4v1H4zM4 8h4v1H4zM4 9h4v1H4z"),
  dash: pixelIcon("M1 1h2v1H1zM6 1h2v1H6zM2 2h2v1H2zM7 2h2v1H7zM3 3h2v1H3zM8 3h2v1H8zM4 4h2v1H4zM9 4h2v1H9zM5 5h2v1H5zM10 5h2v1H10zM5 6h2v1H5zM10 6h2v1H10zM4 7h2v1H4zM9 7h2v1H9zM3 8h2v1H3zM8 8h2v1H8zM2 9h2v1H2zM7 9h2v1H7zM1 10h2v1H1zM6 10h2v1H6z"),
  duck: pixelIcon("M4 1h4v1H4zM4 2h4v1H4zM4 3h4v1H4zM1 4h10v1H1zM2 5h8v1H2zM3 6h6v1H3zM4 7h4v1H4zM5 8h2v1H5zM1 10h10v1H1zM1 11h10v1H1z"),
  special: pixelIcon("M5 0h2v1H5zM5 1h2v1H5zM4 2h4v1H4zM0 3h12v1H0zM1 4h10v1H1zM2 5h8v1H2zM3 6h6v1H3zM2 7h8v1H2zM2 8h3v1H2zM7 8h3v1H7zM1 9h3v1H1zM8 9h3v1H8zM1 10h2v1H1zM9 10h2v1H9z"),
  basic: pixelIcon("M9 0h3v1H9zM8 1h4v1H8zM7 2h4v1H7zM6 3h4v1H6zM1 4h2v1H1zM5 4h4v1H5zM2 5h6v1H2zM3 6h4v1H3zM2 7h6v1H2zM1 8h3v1H1zM6 8h2v1H6zM0 9h3v1H0zM0 10h2v1H0z"),
};

export function isTouchGameDevice() {
  try {
    if (typeof window === "undefined") return false;
    if (window.__BB_FORCE_MOBILE_CONTROLS === true) return true;
    const touchPoints = Number(navigator?.maxTouchPoints || 0);
    const coarse = !!window.matchMedia?.("(pointer: coarse)")?.matches;
    const narrowViewport =
      Math.min(Number(window.innerWidth || 0), Number(window.innerHeight || 0)) <= 820;
    return touchPoints > 0 && (coarse || narrowViewport);
  } catch (_) {
    return false;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function createStick() {
  return {
    pointerId: null,
    active: false,
    originX: 0,
    originY: 0,
    dx: 0,
    dy: 0,
    strength: 0,
    context: null,
  };
}

function createButton() {
  return { pointerId: null, active: false, presses: 0, consumed: 0 };
}

export function createMobileControlsController({
  getPlayer,
  getPointerAimActive,
  getAimBasePoint,
  resolveAimContext,
  resolveQuickContext,
  getSuperChargeRatio,
  onBasicFire,
  onSpecialFire,
  onSpecialNotReady,
  onClearReticle,
} = {}) {
  let state = createState();
  let domRoot = null;

  function createState() {
    return {
      enabled: false,
      scene: null,
      movement: { ...createStick(), baseX: 0, baseY: 0 },
      basic: createStick(),
      special: createStick(),
      jump: createButton(),
      dash: createButton(),
      duck: createButton(),
      geometry: null,
      layoutKey: "",
      dashCooldown: { readyAt: 0, total: 1 },
    };
  }

  function setBodyClass(enabled) {
    try {
      document?.body?.classList?.toggle?.("mobile-game-ui", !!enabled);
    } catch (_) {}
  }

  function makeEl(parent, className, html = "") {
    const el = document.createElement("div");
    el.className = className;
    if (html) el.innerHTML = html;
    parent.appendChild(el);
    return el;
  }

  function ensureDomRoot() {
    if (domRoot && document.body.contains(domRoot)) return domRoot;
    try {
      const root = document.createElement("div");
      root.id = "bb-mobile-controls";
      root.setAttribute("aria-hidden", "true");

      const insetProbe = makeEl(root, "bbm-inset-probe");
      const moveZone = makeEl(root, "bbm-move-zone");
      const moveBase = makeEl(root, "bbm-stick bbm-move");
      const moveThumb = makeEl(moveBase, "bbm-thumb");
      const duck = makeEl(root, "bbm-button bbm-duck", ICONS.duck);
      const jump = makeEl(root, "bbm-button bbm-jump", ICONS.jump);
      // Glow and glint layers play the "ready" effect on dash and super.
      const readyFx = '<i class="bbm-glow"></i><i class="bbm-glint"></i>';
      const dash = makeEl(root, "bbm-button bbm-dash", `${readyFx}${ICONS.dash}<i class="bbm-cooldown"></i>`);
      const special = makeEl(root, "bbm-stick bbm-aim bbm-special", `<i class="bbm-charge"></i>${readyFx}${ICONS.special}`);
      const specialThumb = makeEl(special, "bbm-thumb");
      const basic = makeEl(root, "bbm-stick bbm-aim bbm-basic", ICONS.basic);
      const basicThumb = makeEl(basic, "bbm-thumb");

      document.body.appendChild(root);
      domRoot = root;
      domRoot._els = {
        insetProbe,
        moveZone,
        moveBase,
        moveThumb,
        duck,
        jump,
        dash,
        special,
        specialThumb,
        basic,
        basicThumb,
      };
      bindDomInput(root);
      return domRoot;
    } catch (_) {
      return null;
    }
  }

  function destroyDomRoot() {
    try {
      const listeners = domRoot?._listeners;
      if (listeners) {
        for (const [el, handler] of listeners.down) {
          el.removeEventListener("pointerdown", handler);
        }
        window.removeEventListener("pointermove", listeners.onPointerMove);
        window.removeEventListener("pointerup", listeners.onPointerUp);
        window.removeEventListener("pointercancel", listeners.onPointerUp);
        window.removeEventListener("blur", listeners.onBlur);
      }
      domRoot?.remove?.();
    } catch (_) {}
    domRoot = null;
  }

  function readSafeInsets(probe) {
    try {
      const style = window.getComputedStyle(probe);
      return {
        top: parseFloat(style.paddingTop) || 0,
        right: parseFloat(style.paddingRight) || 0,
        bottom: parseFloat(style.paddingBottom) || 0,
        left: parseFloat(style.paddingLeft) || 0,
      };
    } catch (_) {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }
  }

  function computeGeometry(els) {
    const width = Number(window.innerWidth || 0);
    const height = Number(window.innerHeight || 0);
    const inset = readSafeInsets(els.insetProbe);
    // 400px is a typical landscape phone height; tablets grow, small phones shrink.
    const scale = clamp(Math.min(width, height) / 400, 0.74, 1.3);
    const right = width - Math.max(10, inset.right);
    const bottom = height - Math.max(8, inset.bottom);
    const buttons = {};
    let clusterLeft = width;
    for (const [kind, cfg] of Object.entries(CLUSTER)) {
      const size = cfg.size * scale;
      const x = right - cfg.right * scale;
      const y = bottom - cfg.bottom * scale;
      buttons[kind] = { x, y, size };
      clusterLeft = Math.min(clusterLeft, x - size / 2);
    }
    const moveSize = MOVE_STICK.size * scale;
    const moveLeft = Math.max(12, inset.left);
    return {
      width,
      height,
      scale,
      buttons,
      move: {
        size: moveSize,
        radius: moveSize / 2,
        thumb: MOVE_STICK.thumb * scale,
        homeX: moveLeft + MOVE_STICK.left * scale,
        homeY: bottom - MOVE_STICK.bottom * scale,
        minX: moveLeft + moveSize / 2,
        minY: Math.max(inset.top, 0) + moveSize / 2,
        maxY: bottom - moveSize / 2,
        // The floating stick may start anywhere left of the cluster, but never
        // over the top HUD strip.
        zoneTop: Math.round(height * 0.2),
        zoneWidth: Math.max(width * 0.36, Math.min(width * 0.55, clusterLeft - 16)),
      },
    };
  }

  function placeCircle(el, x, y, size) {
    el.style.width = `${Math.round(size)}px`;
    el.style.height = `${Math.round(size)}px`;
    el.style.transform = `translate3d(${Math.round(x - size / 2)}px, ${Math.round(y - size / 2)}px, 0)`;
  }

  function applyGeometry(els, geometry) {
    for (const kind of Object.keys(CLUSTER)) {
      const { x, y, size } = geometry.buttons[kind];
      placeCircle(els[kind], x, y, size);
    }
    const thumbSize = (size) => size * 0.44;
    els.basicThumb.style.setProperty("--bbm-thumb", `${Math.round(thumbSize(geometry.buttons.basic.size))}px`);
    els.specialThumb.style.setProperty("--bbm-thumb", `${Math.round(thumbSize(geometry.buttons.special.size))}px`);
    els.moveThumb.style.setProperty("--bbm-thumb", `${Math.round(geometry.move.thumb)}px`);
    els.moveZone.style.top = `${geometry.move.zoneTop}px`;
    els.moveZone.style.width = `${Math.round(geometry.move.zoneWidth)}px`;
    // One art pixel in CSS px; outlines and corner steps are multiples of it.
    domRoot.style.setProperty("--bbm-px", `${Math.max(3, Math.round(4 * geometry.scale))}px`);
  }

  function refreshGeometry(force = false) {
    const els = ensureDomRoot()?._els;
    if (!els) return null;
    const key = `${window.innerWidth}x${window.innerHeight}`;
    if (force || key !== state.layoutKey || !state.geometry) {
      state.layoutKey = key;
      state.geometry = computeGeometry(els);
      applyGeometry(els, state.geometry);
      if (!state.movement.active) resetMoveBase();
      placeMoveBase(els);
    }
    return state.geometry;
  }

  function resetMoveBase() {
    const move = state.geometry?.move;
    if (!move) return;
    state.movement.baseX = move.homeX;
    state.movement.baseY = move.homeY;
  }

  function placeMoveBase(els) {
    const move = state.movement;
    const home = state.geometry.move;
    placeCircle(els.moveBase, move.active ? move.baseX : home.homeX,
      move.active ? move.baseY : home.homeY, home.size);
  }

  function sampleStick(stick, clientX, clientY, radius) {
    const dx = Number(clientX) - stick.originX;
    const dy = Number(clientY) - stick.originY;
    const dist = Math.hypot(dx, dy);
    stick.dx = dist > 0.001 ? dx / dist : 0;
    stick.dy = dist > 0.001 ? dy / dist : 0;
    stick.strength = clamp(dist / Math.max(1, radius), 0, 1);
    return dist;
  }

  function moveStickTo(event) {
    const move = state.geometry?.move;
    if (!move) return;
    const stick = state.movement;
    const dist = sampleStick(stick, event.clientX, event.clientY, move.radius);
    // Drag past the rim and the base follows the thumb, so the player never
    // has to return to the original touch point to change direction.
    if (dist > move.radius) {
      const excess = dist - move.radius;
      stick.originX += stick.dx * excess;
      stick.originY += stick.dy * excess;
    }
    stick.baseX = stick.originX;
    stick.baseY = stick.originY;
  }

  function aimStickTo(kind, event) {
    const button = state.geometry?.buttons?.[kind];
    const stick = state[kind];
    sampleStick(stick, event.clientX, event.clientY, (button?.size || 80) * 0.5);
    stick.context = resolveStickContext(kind);
  }

  function startPress(kind, event) {
    if (!state.enabled) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    refreshGeometry();
    if (kind === "jump" || kind === "dash" || kind === "duck") {
      const button = state[kind];
      if (button.pointerId !== null) return;
      button.pointerId = event.pointerId;
      button.active = true;
      button.presses += 1;
      return;
    }
    if (kind === "movement") {
      if (state.movement.pointerId !== null) return;
      const move = state.geometry.move;
      const stick = state.movement;
      stick.pointerId = event.pointerId;
      stick.active = true;
      stick.originX = clamp(event.clientX, move.minX, Math.max(move.minX, move.zoneWidth));
      stick.originY = clamp(event.clientY, move.minY, Math.max(move.minY, move.maxY));
      moveStickTo(event);
      return;
    }
    const stick = state[kind];
    if (stick.pointerId !== null) return;
    if (kind === "special" && !isSuperReady()) {
      try {
        onSpecialNotReady?.();
      } catch (_) {}
      return;
    }
    stick.pointerId = event.pointerId;
    stick.active = true;
    stick.originX = Number(event.clientX) || 0;
    stick.originY = Number(event.clientY) || 0;
    aimStickTo(kind, event);
  }

  function bindDomInput(root) {
    const els = root._els;
    const down = [
      [els.moveZone, "movement"],
      [els.moveBase, "movement"],
      [els.basic, "basic"],
      [els.special, "special"],
      [els.jump, "jump"],
      [els.dash, "dash"],
      [els.duck, "duck"],
    ].map(([el, kind]) => {
      const handler = (event) => startPress(kind, event);
      el.addEventListener("pointerdown", handler, { passive: false });
      return [el, handler];
    });
    const onPointerMove = (event) => {
      if (!state.enabled) return;
      if (state.movement.pointerId === event.pointerId) {
        moveStickTo(event);
        event.preventDefault?.();
      } else if (state.basic.pointerId === event.pointerId) {
        aimStickTo("basic", event);
        event.preventDefault?.();
      } else if (state.special.pointerId === event.pointerId) {
        aimStickTo("special", event);
        event.preventDefault?.();
      }
    };
    const onPointerUp = (event) => {
      if (!state.enabled) return;
      const id = event.pointerId;
      for (const kind of ["jump", "dash", "duck"]) {
        if (state[kind].pointerId === id) {
          state[kind].pointerId = null;
          state[kind].active = false;
          return;
        }
      }
      if (state.movement.pointerId === id) releaseStick("movement", false);
      else if (state.basic.pointerId === id) releaseStick("basic", event.type !== "pointercancel");
      else if (state.special.pointerId === id) releaseStick("special", event.type !== "pointercancel");
    };
    const onBlur = () => resetInput();
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    window.addEventListener("pointercancel", onPointerUp, { passive: false });
    window.addEventListener("blur", onBlur);
    root._listeners = { down, onPointerMove, onPointerUp, onBlur };
  }

  function isSuperReady() {
    if (typeof getSuperChargeRatio !== "function") return true;
    return Number(getSuperChargeRatio()) >= 1;
  }

  function resolveStickContext(kind = "basic") {
    const player = typeof getPlayer === "function" ? getPlayer() : null;
    if (!player) return null;
    const family = kind === "special" ? "special" : "basic";
    const stick = state[family];
    // A tap (or a drag that never leaves the deadzone) auto-aims at the
    // nearest opponent, like a keyboard quick attack.
    if (stick.strength < AIM_STICK_DEADZONE && typeof resolveQuickContext === "function") {
      return resolveQuickContext(family);
    }
    const base = (typeof getAimBasePoint === "function" ? getAimBasePoint(family) : null) || {
      baseX: Number(player.x) || 0,
      baseY: Number(player.y) || 0,
    };
    const range = AIM_STICK_RANGE * Math.max(0.35, stick.strength);
    if (typeof resolveAimContext !== "function") return null;
    return resolveAimContext({
      family,
      pointerWorldX: Number(base.baseX || 0) + (stick.dx || (player.flipX ? -1 : 1)) * range,
      pointerWorldY: Number(base.baseY || 0) + stick.dy * range,
      quick: false,
    });
  }

  function clearAimIfIdle() {
    if (state.basic.active || state.special.active) return;
    if (typeof getPointerAimActive === "function" && getPointerAimActive()) return;
    try {
      onClearReticle?.();
    } catch (_) {}
  }

  function releaseStick(kind, shouldFire = false) {
    const stick = state[kind];
    const context = shouldFire && stick.active ? resolveStickContext(kind) || stick.context : null;
    Object.assign(stick, createStick());
    if (kind === "movement") resetMoveBase();
    if (kind === "basic" && context) onBasicFire?.(context);
    else if (kind === "special" && context) onSpecialFire?.(context);
    clearAimIfIdle();
  }

  function resetInput() {
    releaseStick("movement", false);
    releaseStick("basic", false);
    releaseStick("special", false);
    state.jump = createButton();
    state.dash = createButton();
    state.duck = createButton();
  }

  function destroy() {
    state = createState();
    destroyDomRoot();
    setBodyClass(false);
  }

  function ensure(nextScene) {
    if (!isTouchGameDevice() || !nextScene) {
      if (state.enabled || domRoot) destroy();
      return;
    }
    if (state.enabled && state.scene === nextScene && domRoot) return;
    destroy();
    state.enabled = true;
    state.scene = nextScene;
    setBodyClass(true);
    try {
      const canvas = nextScene?.game?.canvas;
      if (canvas?.style) canvas.style.touchAction = "none";
    } catch (_) {}
    refreshGeometry(true);
  }

  function setStickVisual(baseEl, thumbEl, stick, travel) {
    baseEl.classList.toggle("is-active", !!stick.active);
    const offset = clamp(stick.strength, 0, 1) * travel;
    thumbEl.style.transform = `translate(-50%, -50%) translate(${Math.round(stick.dx * offset)}px, ${Math.round(stick.dy * offset)}px)`;
  }

  // Called every frame: keeps the overlay sized to the viewport and mirrors
  // the input/cooldown state into the DOM.
  function update(scene = null) {
    if (scene && scene !== state.scene) ensure(scene);
    if (!state.enabled) return;
    const geometry = refreshGeometry();
    const els = domRoot?._els;
    if (!geometry || !els) return;

    placeMoveBase(els);
    setStickVisual(els.moveBase, els.moveThumb, state.movement, geometry.move.radius * 0.62);
    setStickVisual(els.basic, els.basicThumb, state.basic, geometry.buttons.basic.size * 0.3);
    setStickVisual(els.special, els.specialThumb, state.special, geometry.buttons.special.size * 0.3);
    els.jump.classList.toggle("is-active", state.jump.active);
    els.duck.classList.toggle("is-active", state.duck.active || isDuckFromStick());
    els.dash.classList.toggle("is-active", state.dash.active);

    const charge = typeof getSuperChargeRatio === "function" ? clamp(getSuperChargeRatio(), 0, 1) : 1;
    els.special.classList.toggle("is-ready", charge >= 1);
    // Meters fill in whole steps, like the rest of the pixel HUD.
    els.special.style.setProperty("--bbm-charge", (Math.floor(charge * 8) / 8).toFixed(3));

    const player = typeof getPlayer === "function" ? getPlayer() : null;
    const now = Date.now();
    const readyAt = Number(player?._dashReadyAt || 0);
    const cooldown = state.dashCooldown;
    if (readyAt !== cooldown.readyAt) {
      cooldown.readyAt = readyAt;
      cooldown.total = Math.max(1, readyAt - now);
    }
    const remaining = Math.max(0, readyAt - now);
    els.dash.classList.toggle("is-cooling", remaining > 0);
    els.dash.style.setProperty("--bbm-cooldown",
      (Math.ceil((remaining / Math.max(1, cooldown.total)) * 8) / 8).toFixed(3));
  }

  // Hidden while dead so spectating controls are reachable.
  function setHidden(hidden) {
    if (hidden) resetInput();
    domRoot?.classList?.toggle?.("is-dead", !!hidden);
  }

  function updateReticle(reticleController) {
    for (const kind of ["basic", "special"]) {
      if (!state[kind].active) continue;
      state[kind].context = resolveStickContext(kind);
      try {
        reticleController?.update?.(state[kind].context);
      } catch (_) {}
      return;
    }
    if (!(typeof getPointerAimActive === "function" && getPointerAimActive())) {
      try {
        onClearReticle?.();
      } catch (_) {}
    }
  }

  function stickPushing(direction) {
    const move = state.movement;
    if (!state.enabled || !move.active || move.strength <= STICK_DEADZONE) return false;
    if (direction === "left") return move.dx < -MOVE_DIRECTION_THRESHOLD;
    if (direction === "right") return move.dx > MOVE_DIRECTION_THRESHOLD;
    if (move.strength <= DASH_STICK_MIN_STRENGTH) return false;
    if (direction === "up") return move.dy < -DASH_STICK_MIN_DY;
    return move.dy > DASH_STICK_MIN_DY;
  }

  function isDuckFromStick() {
    const move = state.movement;
    return !!(state.enabled && move.active && move.strength >= DUCK_STICK_MIN_STRENGTH &&
      move.dy >= DUCK_STICK_MIN_DY);
  }

  function consumeFreshPress(button) {
    if (!state.enabled || button.presses <= button.consumed) return false;
    button.consumed = button.presses;
    return true;
  }

  return {
    ensure,
    destroy,
    update,
    resetInput,
    setHidden,
    updateReticle,
    isEnabled: () => !!state.enabled,
    isMovingLeft: () => stickPushing("left"),
    isMovingRight: () => stickPushing("right"),
    // Stick up/down only steer a dash; jump has its own button.
    isAimingUp: () => stickPushing("up"),
    isAimingDown: () => stickPushing("down"),
    isJumpHeld: () => !!(state.enabled && state.jump.active),
    isDuckHeld: () => !!(state.enabled && (state.duck.active || isDuckFromStick())),
    consumeJumpFreshPress: () => consumeFreshPress(state.jump),
    consumeDashFreshPress: () => consumeFreshPress(state.dash),
  };
}
