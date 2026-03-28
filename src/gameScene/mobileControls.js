export function createMobileControlsController({
  Phaser,
  getScene,
  getPlayer,
  getPointerAimActive,
  getAimBasePoint,
  resolveAimContext,
  onBasicFire,
  onSpecialFire,
  onClearReticle,
} = {}) {
  const MOBILE_CONTROL_DEPTH = 10000;
  let state = createState();
  let domRoot = null;

  function createState() {
    return {
      enabled: false,
      scene: null,
      movement: {
        pointerId: null,
        active: false,
        dx: 0,
        dy: 0,
        strength: 0,
      },
      basic: {
        pointerId: null,
        active: false,
        dx: 0,
        dy: 0,
        strength: 0,
        context: null,
      },
      special: {
        pointerId: null,
        active: false,
        dx: 0,
        dy: 0,
        strength: 0,
        context: null,
      },
      jump: {
        pointerId: null,
        active: false,
        pressedAt: 0,
        consumedAt: 0,
      },
      domLayout: null,
      ui: null,
    };
  }

  function setHudMobileClass(enabled) {
    try {
      document?.body?.classList?.toggle?.("mobile-game-ui", !!enabled);
    } catch (_) {}
  }

  function ensureDomRoot() {
    try {
      if (domRoot && document.body.contains(domRoot)) return domRoot;
      const root = document.createElement("div");
      root.id = "bb-mobile-controls-overlay";
      root.style.position = "fixed";
      root.style.inset = "0";
      root.style.zIndex = "2147483646";
      root.style.pointerEvents = "none";
      root.style.display = "block";

      const makeCircle = (id, size, fill, border) => {
        const el = document.createElement("div");
        el.id = id;
        el.style.position = "fixed";
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.borderRadius = "999px";
        el.style.boxSizing = "border-box";
        el.style.background = fill;
        el.style.border = border;
        el.style.boxShadow = "0 0 0 1px rgba(255,255,255,0.08) inset";
        el.style.pointerEvents = "auto";
        el.style.touchAction = "none";
        el.style.backdropFilter = "blur(2px)";
        root.appendChild(el);
        return el;
      };

      const moveBase = makeCircle(
        "bb-mobile-move-base",
        92,
        "rgba(255,255,255,0.16)",
        "2px solid rgba(255,255,255,0.48)",
      );
      const moveThumb = makeCircle(
        "bb-mobile-move-thumb",
        38,
        "rgba(255,255,255,0.28)",
        "2px solid rgba(255,255,255,0.78)",
      );
      const basicBase = makeCircle(
        "bb-mobile-basic-base",
        80,
        "rgba(255,255,255,0.14)",
        "2px solid rgba(255,255,255,0.54)",
      );
      const basicThumb = makeCircle(
        "bb-mobile-basic-thumb",
        34,
        "rgba(255,255,255,0.30)",
        "2px solid rgba(255,255,255,0.78)",
      );
      const superBase = makeCircle(
        "bb-mobile-super-base",
        68,
        "rgba(255,232,117,0.14)",
        "2px solid rgba(255,235,140,0.58)",
      );
      const superThumb = makeCircle(
        "bb-mobile-super-thumb",
        30,
        "rgba(255,232,117,0.28)",
        "2px solid rgba(255,245,186,0.84)",
      );
      moveThumb.style.pointerEvents = "none";
      basicThumb.style.pointerEvents = "none";
      superThumb.style.pointerEvents = "none";
      const jump = makeCircle(
        "bb-mobile-jump",
        52,
        "rgba(255,255,255,0.16)",
        "2px solid rgba(255,255,255,0.52)",
      );
      const jumpLabel = document.createElement("div");
      jumpLabel.id = "bb-mobile-jump-label";
      jumpLabel.textContent = "JUMP";
      jumpLabel.style.position = "fixed";
      jumpLabel.style.color = "#fff";
      jumpLabel.style.fontFamily = "LilitaOne-Regular, sans-serif";
      jumpLabel.style.fontSize = "11px";
      jumpLabel.style.fontWeight = "700";
      jumpLabel.style.textShadow =
        "0 2px 0 rgba(0,0,0,0.85), 0 0 4px rgba(0,0,0,0.8)";
      jumpLabel.style.transform = "translate(-50%, -50%)";
      jumpLabel.style.pointerEvents = "none";
      root.appendChild(jumpLabel);

      document.body.appendChild(root);
      domRoot = root;
      domRoot._els = {
        moveBase,
        moveThumb,
        basicBase,
        basicThumb,
        superBase,
        superThumb,
        jump,
        jumpLabel,
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
        listeners.moveBase?.removeEventListener?.(
          "pointerdown",
          listeners.onMoveDown,
        );
        listeners.basicBase?.removeEventListener?.(
          "pointerdown",
          listeners.onBasicDown,
        );
        listeners.superBase?.removeEventListener?.(
          "pointerdown",
          listeners.onSuperDown,
        );
        listeners.jump?.removeEventListener?.("pointerdown", listeners.onJumpDown);
        window.removeEventListener("pointermove", listeners.onPointerMove);
        window.removeEventListener("pointerup", listeners.onPointerUp);
        window.removeEventListener("pointercancel", listeners.onPointerUp);
      }
      domRoot?.remove?.();
    } catch (_) {}
    domRoot = null;
  }

  function setDomCirclePosition(el, centerX, centerY, size) {
    if (!el) return;
    el.style.left = `${Math.round(centerX - size / 2)}px`;
    el.style.top = `${Math.round(centerY - size / 2)}px`;
  }

  function getDomLayoutMetrics(scene) {
    try {
      const canvas = scene?.game?.canvas;
      const rect = canvas?.getBoundingClientRect?.();
      if (rect && rect.width > 0 && rect.height > 0) {
        return {
          left: Number(rect.left) || 0,
          top: Number(rect.top) || 0,
          width: Number(rect.width) || 0,
          height: Number(rect.height) || 0,
        };
      }
    } catch (_) {}
    return {
      left: 0,
      top: 0,
      width: Number(window?.innerWidth || 0),
      height: Number(window?.innerHeight || 0),
    };
  }

  function isPreferred() {
    try {
      if (typeof window === "undefined") return false;
      if (window.__BB_FORCE_MOBILE_CONTROLS === true) return true;
      const touchPoints = Number(navigator?.maxTouchPoints || 0);
      const narrowViewport = Number(window.innerWidth || 0) <= 980;
      return touchPoints > 0 && narrowViewport;
    } catch (_) {
      return false;
    }
  }

  function clampUnit(value) {
    return Phaser.Math.Clamp(Number(value) || 0, -1, 1);
  }

  function getStickConfig(kind = "movement") {
    switch (kind) {
      case "basic":
        return { radius: 40, thumbRadius: 17, alpha: 0.18, xPad: 92, yPad: 122 };
      case "special":
        return { radius: 34, thumbRadius: 15, alpha: 0.18, xPad: 174, yPad: 84 };
      default:
        return { radius: 46, thumbRadius: 19, alpha: 0.2, xPad: 86, yPad: 92 };
    }
  }

  function createControlCircle(scene, radius, fillAlpha = 0.18) {
    const g = scene.add.graphics();
    g.setScrollFactor(0);
    g.setDepth(MOBILE_CONTROL_DEPTH);
    g.setVisible(true);
    g._radius = radius;
    g._fillAlpha = fillAlpha;
    return g;
  }

  function drawStick(base, thumb, cfg, tint = 0xffffff) {
    if (!base || !thumb) return;
    const radius = Number(cfg?.radius) || 40;
    const thumbRadius = Number(cfg?.thumbRadius) || 16;
    const alpha = Number(cfg?.alpha) || 0.18;
    base.clear();
    base.fillStyle(0xffffff, alpha * 0.72);
    base.fillCircle(0, 0, radius);
    base.lineStyle(2.1, 0xffffff, 0.5);
    base.strokeCircle(0, 0, radius);
    base.lineStyle(1.2, 0xffffff, 0.24);
    base.strokeCircle(0, 0, radius * 0.58);

    thumb.clear();
    thumb.fillStyle(tint, 0.34);
    thumb.fillCircle(0, 0, thumbRadius);
    thumb.lineStyle(2.1, 0xffffff, 0.72);
    thumb.strokeCircle(0, 0, thumbRadius);
  }

  function drawJumpButton(button, label) {
    if (!button || !label) return;
    const radius = Number(button._radius) || 26;
    button.clear();
    button.fillStyle(0xffffff, 0.18);
    button.fillCircle(0, 0, radius);
    button.lineStyle(2.1, 0xffffff, 0.48);
    button.strokeCircle(0, 0, radius);
    button.lineStyle(1.2, 0xffffff, 0.24);
    button.strokeCircle(0, 0, radius * 0.62);
    label.setPosition(button.x, button.y);
  }

  function destroy() {
    const ui = state?.ui;
    if (ui) {
      for (const obj of Object.values(ui)) {
        try {
          obj?.destroy?.();
        } catch (_) {}
      }
    }
    state = createState();
    destroyDomRoot();
    setHudMobileClass(false);
  }

  function ensure(nextScene) {
    if (!isPreferred() || !nextScene?.add) {
      destroy();
      return;
    }
    if (state.enabled && state.scene === nextScene && state.ui) {
      setHudMobileClass(true);
      return;
    }
    destroy();
    state.enabled = true;
    state.scene = nextScene;
    setHudMobileClass(true);
    ensureDomRoot();
    try {
      nextScene.input.addPointer?.(5);
    } catch (_) {}
    try {
      const canvas = nextScene?.game?.canvas;
      if (canvas?.style) canvas.style.touchAction = "none";
    } catch (_) {}

    const moveCfg = getStickConfig("movement");
    const basicCfg = getStickConfig("basic");
    const specialCfg = getStickConfig("special");
    const moveBase = createControlCircle(nextScene, moveCfg.radius, moveCfg.alpha);
    const moveThumb = createControlCircle(nextScene, moveCfg.thumbRadius, 0.24);
    const basicBase = createControlCircle(nextScene, basicCfg.radius, basicCfg.alpha);
    const basicThumb = createControlCircle(nextScene, basicCfg.thumbRadius, 0.24);
    const superBase = createControlCircle(nextScene, specialCfg.radius, specialCfg.alpha);
    const superThumb = createControlCircle(nextScene, specialCfg.thumbRadius, 0.24);
    const jumpButton = createControlCircle(nextScene, 26, 0.2);
    const jumpLabel = nextScene.add
      .text(0, 0, "JUMP", {
        fontFamily: "LilitaOne-Regular",
        fontSize: "9px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(MOBILE_CONTROL_DEPTH + 1);

    state.ui = {
      moveBase,
      moveThumb,
      basicBase,
      basicThumb,
      superBase,
      superThumb,
      jumpButton,
      jumpLabel,
    };
    layout(nextScene);
  }

  function layout(nextScene = null) {
    const scene = nextScene || state.scene;
    if (!state.enabled || !state.ui || !scene?.scale) return;
    const width = Number(scene.scale.gameSize?.width || scene.scale.width || 0);
    const height = Number(scene.scale.gameSize?.height || scene.scale.height || 0);
    const moveCfg = getStickConfig("movement");
    const basicCfg = getStickConfig("basic");
    const specialCfg = getStickConfig("special");
    const ui = state.ui;

    try {
      for (const obj of Object.values(ui)) {
        obj?.setVisible?.(true);
        scene.children?.bringToTop?.(obj);
      }
    } catch (_) {}

    const moveX = moveCfg.xPad;
    const moveY = height - moveCfg.yPad;
    ui.moveBase.x = moveX;
    ui.moveBase.y = moveY;
    ui.moveThumb.x = moveX + clampUnit(state.movement.dx) * moveCfg.radius * 0.62;
    ui.moveThumb.y = moveY + clampUnit(state.movement.dy) * moveCfg.radius * 0.62;
    drawStick(ui.moveBase, ui.moveThumb, moveCfg);

    const basicX = width - basicCfg.xPad;
    const basicY = height - basicCfg.yPad;
    ui.basicBase.x = basicX;
    ui.basicBase.y = basicY;
    ui.basicThumb.x = basicX + clampUnit(state.basic.dx) * basicCfg.radius * 0.62;
    ui.basicThumb.y = basicY + clampUnit(state.basic.dy) * basicCfg.radius * 0.62;
    drawStick(ui.basicBase, ui.basicThumb, basicCfg, 0xffffff);

    const superX = width - specialCfg.xPad;
    const superY = height - specialCfg.yPad;
    ui.superBase.x = superX;
    ui.superBase.y = superY;
    ui.superThumb.x = superX + clampUnit(state.special.dx) * specialCfg.radius * 0.62;
    ui.superThumb.y = superY + clampUnit(state.special.dy) * specialCfg.radius * 0.62;
    drawStick(ui.superBase, ui.superThumb, specialCfg, 0xffea75);

    ui.jumpButton.x = width - 74;
    ui.jumpButton.y = height - 62;
    drawJumpButton(ui.jumpButton, ui.jumpLabel);

    try {
      const dom = ensureDomRoot()?._els;
      if (dom) {
        const metrics = getDomLayoutMetrics(scene);
        const domMoveX = metrics.left + moveCfg.xPad;
        const domMoveY = metrics.top + metrics.height - moveCfg.yPad;
        const domBasicX = metrics.left + metrics.width - basicCfg.xPad;
        const domBasicY = metrics.top + metrics.height - basicCfg.yPad;
        const domSuperX = metrics.left + metrics.width - specialCfg.xPad;
        const domSuperY = metrics.top + metrics.height - specialCfg.yPad;
        const domJumpX = metrics.left + metrics.width - 74;
        const domJumpY = metrics.top + metrics.height - 62;
        state.domLayout = {
          moveX: domMoveX,
          moveY: domMoveY,
          moveRadius: 46,
          basicX: domBasicX,
          basicY: domBasicY,
          basicRadius: 40,
          superX: domSuperX,
          superY: domSuperY,
          superRadius: 34,
          jumpX: domJumpX,
          jumpY: domJumpY,
        };

        setDomCirclePosition(dom.moveBase, domMoveX, domMoveY, 92);
        setDomCirclePosition(
          dom.moveThumb,
          domMoveX + clampUnit(state.movement.dx) * moveCfg.radius * 0.62,
          domMoveY + clampUnit(state.movement.dy) * moveCfg.radius * 0.62,
          38,
        );
        setDomCirclePosition(dom.basicBase, domBasicX, domBasicY, 80);
        setDomCirclePosition(
          dom.basicThumb,
          domBasicX + clampUnit(state.basic.dx) * basicCfg.radius * 0.62,
          domBasicY + clampUnit(state.basic.dy) * basicCfg.radius * 0.62,
          34,
        );
        setDomCirclePosition(dom.superBase, domSuperX, domSuperY, 68);
        setDomCirclePosition(
          dom.superThumb,
          domSuperX + clampUnit(state.special.dx) * specialCfg.radius * 0.62,
          domSuperY + clampUnit(state.special.dy) * specialCfg.radius * 0.62,
          30,
        );
        setDomCirclePosition(dom.jump, domJumpX, domJumpY, 52);
        dom.jumpLabel.style.left = `${Math.round(domJumpX)}px`;
        dom.jumpLabel.style.top = `${Math.round(domJumpY)}px`;
        dom.moveBase.style.display = "block";
        dom.moveThumb.style.display = "block";
        dom.basicBase.style.display = "block";
        dom.basicThumb.style.display = "block";
        dom.superBase.style.display = "block";
        dom.superThumb.style.display = "block";
        dom.jump.style.display = "block";
        dom.jumpLabel.style.display = "block";
      }
    } catch (_) {}
  }

  function getStickDistanceNorm(pointerX, pointerY, baseX, baseY, radius) {
    const dx = Number(pointerX) - Number(baseX);
    const dy = Number(pointerY) - Number(baseY);
    const dist = Math.hypot(dx, dy);
    const safeRadius = Math.max(1, Number(radius) || 1);
    return {
      dx: dist > 0.001 ? dx / dist : 0,
      dy: dist > 0.001 ? dy / dist : 0,
      strength: Phaser.Math.Clamp(dist / safeRadius, 0, 1),
    };
  }

  function bindDomInput(root) {
    const els = root?._els;
    if (!els) return;
    const startFor = (kind, event) => {
      if (!state.enabled) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      if (kind === "jump") {
        state.jump.pointerId = event.pointerId;
        state.jump.active = true;
        state.jump.pressedAt = Date.now();
        return;
      }
      updateDomStickState(kind, event);
    };
    const onMoveDown = (event) => startFor("movement", event);
    const onBasicDown = (event) => startFor("basic", event);
    const onSuperDown = (event) => startFor("special", event);
    const onJumpDown = (event) => startFor("jump", event);
    const onPointerMove = (event) => {
      if (!state.enabled) return;
      if (state.movement.pointerId === event.pointerId) {
        updateDomStickState("movement", event);
        event.preventDefault?.();
      }
      if (state.basic.pointerId === event.pointerId) {
        updateDomStickState("basic", event);
        event.preventDefault?.();
      }
      if (state.special.pointerId === event.pointerId) {
        updateDomStickState("special", event);
        event.preventDefault?.();
      }
    };
    const onPointerUp = (event) => {
      if (!state.enabled) return;
      if (state.jump.pointerId === event.pointerId) {
        state.jump.pointerId = null;
        state.jump.active = false;
        event.preventDefault?.();
        return;
      }
      if (state.movement.pointerId === event.pointerId) {
        releaseStick("movement", false);
        event.preventDefault?.();
        return;
      }
      if (state.basic.pointerId === event.pointerId) {
        releaseStick("basic", true);
        event.preventDefault?.();
        return;
      }
      if (state.special.pointerId === event.pointerId) {
        releaseStick("special", true);
        event.preventDefault?.();
      }
    };
    els.moveBase.addEventListener("pointerdown", onMoveDown, { passive: false });
    els.basicBase.addEventListener("pointerdown", onBasicDown, { passive: false });
    els.superBase.addEventListener("pointerdown", onSuperDown, { passive: false });
    els.jump.addEventListener("pointerdown", onJumpDown, { passive: false });
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    window.addEventListener("pointercancel", onPointerUp, { passive: false });
    root._listeners = {
      moveBase: els.moveBase,
      basicBase: els.basicBase,
      superBase: els.superBase,
      jump: els.jump,
      onMoveDown,
      onBasicDown,
      onSuperDown,
      onJumpDown,
      onPointerMove,
      onPointerUp,
    };
  }

  function updateDomStickState(kind, event) {
    const layout = state.domLayout;
    if (!layout) return false;
    if (kind === "movement") {
      const sample = getStickDistanceNorm(
        event.clientX,
        event.clientY,
        layout.moveX,
        layout.moveY,
        layout.moveRadius,
      );
      state.movement.active = true;
      state.movement.pointerId = event.pointerId;
      state.movement.dx = sample.dx;
      state.movement.dy = sample.dy;
      state.movement.strength = sample.strength;
      return true;
    }
    const family = kind === "special" ? "special" : "basic";
    const centerX = family === "special" ? layout.superX : layout.basicX;
    const centerY = family === "special" ? layout.superY : layout.basicY;
    const radius = family === "special" ? layout.superRadius : layout.basicRadius;
    const sample = getStickDistanceNorm(
      event.clientX,
      event.clientY,
      centerX,
      centerY,
      radius,
    );
    const stick = family === "special" ? state.special : state.basic;
    stick.active = true;
    stick.pointerId = event.pointerId;
    stick.dx = sample.dx;
    stick.dy = sample.dy;
    stick.strength = sample.strength;
    stick.context = resolveStickContext(family);
    return true;
  }

  function resolveStickContext(kind = "basic") {
    const player = typeof getPlayer === "function" ? getPlayer() : null;
    if (!player) return null;
    const family = kind === "special" ? "special" : "basic";
    const stick = family === "special" ? state.special : state.basic;
    const base =
      (typeof getAimBasePoint === "function" ? getAimBasePoint(family) : null) || {
        baseX: Number(player?.x) || 0,
        baseY: Number(player?.y) || 0,
      };
    const defaultDir = player?.flipX ? -1 : 1;
    const dx = Number(stick.dx) || defaultDir;
    const dy = Number(stick.dy) || 0;
    const strength = Math.max(0.25, Number(stick.strength) || 0);
    const range = 240 * strength;
    const pointerWorldX = Number(base.baseX || 0) + dx * range;
    const pointerWorldY = Number(base.baseY || 0) + dy * range;
    if (typeof resolveAimContext !== "function") return null;
    return resolveAimContext({
      family,
      pointerWorldX,
      pointerWorldY,
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

  function updateStickState(kind, pointer) {
    if (!state.enabled || !state.ui || !pointer) return false;
    const ui = state.ui;
    if (kind === "movement") {
      const cfg = getStickConfig("movement");
      const sample = getStickDistanceNorm(pointer.x, pointer.y, ui.moveBase.x, ui.moveBase.y, cfg.radius);
      state.movement.active = true;
      state.movement.pointerId = pointer.id;
      state.movement.dx = sample.dx;
      state.movement.dy = sample.dy;
      state.movement.strength = sample.strength;
      return true;
    }
    const family = kind === "special" ? "special" : "basic";
    const cfg = getStickConfig(family);
    const baseObj = family === "special" ? ui.superBase : ui.basicBase;
    const sample = getStickDistanceNorm(pointer.x, pointer.y, baseObj.x, baseObj.y, cfg.radius);
    const stick = family === "special" ? state.special : state.basic;
    stick.active = true;
    stick.pointerId = pointer.id;
    stick.dx = sample.dx;
    stick.dy = sample.dy;
    stick.strength = sample.strength;
    stick.context = resolveStickContext(family);
    return true;
  }

  function pointerDistanceTo(baseObj, pointer) {
    if (!baseObj || !pointer) return Infinity;
    return Math.hypot(Number(pointer.x) - Number(baseObj.x), Number(pointer.y) - Number(baseObj.y));
  }

  function handlePointerDown(pointer) {
    if (!state.enabled || !state.ui) return false;
    const ui = state.ui;
    const moveCfg = getStickConfig("movement");
    const basicCfg = getStickConfig("basic");
    const specialCfg = getStickConfig("special");
    if (
      state.jump.pointerId === null &&
      pointerDistanceTo(ui.jumpButton, pointer) <= Number(ui.jumpButton._radius || 26) + 8
    ) {
      state.jump.pointerId = pointer.id;
      state.jump.active = true;
      state.jump.pressedAt = Date.now();
      return true;
    }
    if (
      state.movement.pointerId === null &&
      pointerDistanceTo(ui.moveBase, pointer) <= moveCfg.radius + 32
    ) {
      updateStickState("movement", pointer);
      return true;
    }
    if (
      state.basic.pointerId === null &&
      pointerDistanceTo(ui.basicBase, pointer) <= basicCfg.radius + 28
    ) {
      updateStickState("basic", pointer);
      return true;
    }
    if (
      state.special.pointerId === null &&
      pointerDistanceTo(ui.superBase, pointer) <= specialCfg.radius + 28
    ) {
      updateStickState("special", pointer);
      return true;
    }
    return false;
  }

  function handlePointerMove(pointer) {
    if (!state.enabled || !pointer) return false;
    if (state.movement.pointerId === pointer.id) {
      updateStickState("movement", pointer);
      return true;
    }
    if (state.basic.pointerId === pointer.id) {
      updateStickState("basic", pointer);
      return true;
    }
    if (state.special.pointerId === pointer.id) {
      updateStickState("special", pointer);
      return true;
    }
    return false;
  }

  function releaseStick(kind, shouldFire = false) {
    const stick =
      kind === "special"
        ? state.special
        : kind === "basic"
          ? state.basic
          : state.movement;
    const context = stick.context || null;
    stick.pointerId = null;
    stick.active = false;
    stick.dx = 0;
    stick.dy = 0;
    stick.strength = 0;
    stick.context = null;
    if (kind === "basic" && shouldFire && context) {
      onBasicFire?.(context);
    } else if (kind === "special" && shouldFire && context) {
      onSpecialFire?.(context);
    }
    clearAimIfIdle();
  }

  function handlePointerUp(pointer) {
    if (!state.enabled || !pointer) return false;
    if (state.jump.pointerId === pointer.id) {
      state.jump.pointerId = null;
      state.jump.active = false;
      return true;
    }
    if (state.movement.pointerId === pointer.id) {
      releaseStick("movement", false);
      return true;
    }
    if (state.basic.pointerId === pointer.id) {
      releaseStick("basic", true);
      return true;
    }
    if (state.special.pointerId === pointer.id) {
      releaseStick("special", true);
      return true;
    }
    return false;
  }

  function updateReticle(reticleController) {
    if (state.basic.active) {
      state.basic.context = resolveStickContext("basic");
      try {
        reticleController?.update?.(state.basic.context);
      } catch (_) {}
      return;
    }
    if (state.special.active) {
      state.special.context = resolveStickContext("special");
      try {
        reticleController?.update?.(state.special.context);
      } catch (_) {}
      return;
    }
    if (!(typeof getPointerAimActive === "function" && getPointerAimActive())) {
      try {
        onClearReticle?.();
      } catch (_) {}
    }
  }

  return {
    ensure,
    destroy,
    layout,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    updateReticle,
    isEnabled: () => !!state.enabled,
    isMovingLeft: () =>
      !!(
        state.enabled &&
        state.movement.active &&
        state.movement.strength > 0.22 &&
        state.movement.dx < -0.28
      ),
    isMovingRight: () =>
      !!(
        state.enabled &&
        state.movement.active &&
        state.movement.strength > 0.22 &&
        state.movement.dx > 0.28
      ),
    isJumpHeld: () => !!state.jump.active,
    consumeJumpFreshPress: () => {
      if (!state.enabled) return false;
      if (state.jump.pressedAt > (state.jump.consumedAt || 0)) {
        state.jump.consumedAt = state.jump.pressedAt;
        return true;
      }
      return false;
    },
  };
}
