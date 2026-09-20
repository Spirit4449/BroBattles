// Relative displacement from each press; camera and player movement never move this origin.
export const COMBAT_MOUSE_CONFIG = Object.freeze({
  dragStartDistance: 10,
  dragReleaseDistance: 6,
  fullDragDistance: 120,
  mouseSensitivity: 0.24,
  throwCenterDistance: 28,
  lookAhead: 72,
});

export function createCombatMouseController({ scene, canPlay, canCapture = canPlay, canPrepare = canCapture, onRelease, config = COMBAT_MOUSE_CONFIG, getPreferences = () => ({ sensitivity: 1, autoHideCursor: true }) }) {
  const canvas = scene.game.canvas;
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  // Living inside the controls panel shares its saved new-player visibility,
  // mobile/editor exclusions, and the game's keycap styling.
  const hint = doc.getElementById?.('battle-cursor-hint');
  let direction = { x: 1, y: 0 };
  let dragging = false;
  let aiming = false;
  let dragX = 0, dragY = 0;
  let defaultAim = false;
  let variableDistance = false;
  let centerHeld = false;
  // Camera reach stays constant; throw distance has its own radial control.
  const getStrength = () => aiming ? 1 : 0;
  const getDistanceRatio = () => aiming && !centerHeld ? Math.min(1, Math.max(0,
    (Math.hypot(dragX, dragY) - (variableDistance ? config.throwCenterDistance : config.dragStartDistance)) /
    (config.fullDragDistance - (variableDistance ? config.throwCenterDistance : config.dragStartDistance)))) : 0;
  const getCenterCue = () => variableDistance && aiming ? {
    proximity: centerHeld ? 1 : Math.max(0, 1 - Math.max(0, Math.hypot(dragX, dragY) - config.throwCenterDistance) / 30),
    held: centerHeld,
  } : null;
  const endDrag = () => {
    dragging = false;
    aiming = false;
    defaultAim = false;
    centerHeld = false;
    dragX = 0;
    dragY = 0;
    scene._combatAimLook = null;
  };
  let active = false;
  let pending = false;
  let destroyed = false;
  let fallback = false;
  let cursorReleased = false;
  let preparedForBattle = false;
  let wasPlayable = false;
  const listeners = [];
  const listen = (target, name, fn) => {
    target.addEventListener(name, fn, true);
    listeners.push(() => target.removeEventListener(name, fn, true));
  };
  const showCursor = (hidden) => {
    canvas.style.cursor = hidden ? 'none' : '';
    doc.body?.classList?.toggle('battle-cursor-hidden', hidden);
    if (hint) hint.style.display = hidden ? '' : 'none';
  };
  const release = () => {
    const hadInput = active || pending;
    active = false;
    pending = false;
    preparedForBattle = false;
    cursorReleased = true;
    showCursor(false);
    endDrag();
    scene._resetAimCameraBounds?.();
    if (hadInput) onRelease();
    if (doc.pointerLockElement === canvas) doc.exitPointerLock();
  };
  const enable = () => {
    if (destroyed || !pending || !canCapture() || doc.hidden || !doc.hasFocus()) {
      release();
      return;
    }
    pending = false;
    active = true;
    cursorReleased = false;
    showCursor(true);
  };
  listen(doc, 'pointerlockchange', () => {
    if (doc.pointerLockElement === canvas) { fallback = false; enable(); }
    else release();
  });
  // Browsers without pointer lock retain relative aiming while over the canvas.
  const fail = () => {
    if (!pending) return;
    fallback = true;
    enable();
  };
  listen(doc, 'pointerlockerror', fail);
  listen(doc, 'mousemove', (event) => {
    if (!active || !dragging || !canPlay()) return;
    if (doc.pointerLockElement !== canvas && event.target !== canvas) return;
    const dx = Number(event.movementX) || 0, dy = Number(event.movementY) || 0;
    dragX += dx * config.mouseSensitivity * getPreferences().sensitivity;
    dragY += dy * config.mouseSensitivity * getPreferences().sensitivity;
    let distance = Math.hypot(dragX, dragY);
    // Discard outward overshoot for throws so the first inward movement
    // immediately shortens the attack, even after pushing against the limit.
    if (variableDistance && distance > config.fullDragDistance) {
      const scale = config.fullDragDistance / distance;
      dragX *= scale;
      dragY *= scale;
      distance = config.fullDragDistance;
    }
    if (defaultAim && distance < config.dragStartDistance) return;
    // Minimum range clamps power, not heading. Only the tiny directionless
    // center retains the last angle; orbiting inside minimum range stays free.
    if (variableDistance && aiming) {
      centerHeld = distance < config.dragReleaseDistance;
      if (!centerHeld) direction = { x: dragX / distance, y: dragY / distance };
      return;
    }
    defaultAim = false;
    aiming = distance >= (aiming ? config.dragReleaseDistance : config.dragStartDistance);
    if (aiming) direction = { x: dragX / distance, y: dragY / distance };
  });
  listen(win, 'blur', release);
  listen(doc, 'visibilitychange', () => { if (doc.hidden) release(); });
  listen(doc, 'keydown', (event) => {
    if (event.key === 'Escape' || event.key === 'Tab' || event.key === 'Alt' || event.key === 'Meta') release();
    else if (!event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey &&
      !event.target?.isContentEditable &&
      !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(event.target?.tagName) &&
      (getPreferences().keys ? ['left','right','up','down','leftAlt','rightAlt','upAlt','downAlt','jump'].some(slot => getPreferences().keys[slot] === event.keyCode) : ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', ' '].includes(event.key?.length === 1 ? event.key.toLowerCase() : event.key))) {
      if (getPreferences().autoHideCursor) controller.beginInput();
    }
  });
  listen(doc, 'focusin', (event) => {
    if (event.target !== canvas && event.target !== doc.body) release();
  });
  listen(doc, 'pointerdown', (event) => {
    if (event.target !== canvas) release();
  });
  listen(canvas, 'mouseleave', () => { if (fallback) release(); });
  scene.events.on('pause', release);
  scene.events.on('sleep', release);
  const controller = {
    config,
    // The canvas has keyboard focus from the countdown even if the browser
    // cannot grant pointer lock until the next user gesture.
    isActive: () => active || (preparedForBattle && canCapture() && !doc.hidden && doc.hasFocus()),
    getDirection: () => direction,
    isAiming: () => active && dragging && aiming,
    getStrength,
    getDistanceRatio,
    getCenterCue,
    isDefaultAim: () => defaultAim,
    shouldShowReticle: () => active && dragging && aiming,
    beginDrag(facing = 1, isVariableDistance = false) {
      endDrag();
      variableDistance = isVariableDistance;
      dragging = active && canPlay();
      aiming = false;
      defaultAim = dragging;
      direction = { x: facing < 0 ? -1 : 1, y: 0 };
    },
    endDrag,
    // Countdown preparation focuses the canvas and applies the automatic
    // cursor preference without enabling movement before the fight starts.
    prepareForBattle() {
      if (destroyed || !canPrepare() || doc.hidden || !doc.hasFocus() || !getPreferences().autoHideCursor) return false;
      preparedForBattle = true;
      cursorReleased = false;
      showCursor(true);
      try {
        canvas.tabIndex = -1;
        canvas.focus?.({ preventScroll: true });
      } catch (_) {
        try { canvas.focus?.(); } catch (_) {}
      }
      return true;
    },
    // Consume the activation click so returning from a menu cannot shoot.
    beginInput() {
      if (destroyed || !canCapture() || doc.hidden || !doc.hasFocus()) return false;
      if (active) return true;
      if (pending) return false;
      pending = true;
      cursorReleased = false;
      try {
        if (!canvas.requestPointerLock) fail();
        else canvas.requestPointerLock()?.catch(fail);
      } catch (_) { fail(); }
      return false;
    },
    release,
    update() {
      const playable = !destroyed && canCapture() && !doc.hidden && doc.hasFocus();
      if (playable && !wasPlayable) cursorReleased = false;
      if (!playable && wasPlayable) preparedForBattle = false;
      wasPlayable = playable;
      const autoHideCursor = getPreferences().autoHideCursor;
      if (!autoHideCursor) preparedForBattle = false;
      const hideCursor = !cursorReleased && (autoHideCursor
        ? (preparedForBattle || playable)
        : playable && active);
      showCursor(hideCursor);
      if (!playable) {
        if (active || pending) release();
        return;
      }
      if (!active) return;
      if (!canPlay()) {
        endDrag();
        return;
      }
      const strength = getStrength();
      scene._combatAimLook = { x: direction.x * config.lookAhead * strength, y: direction.y * config.lookAhead * strength };
    },
    destroy() {
      destroyed = true;
      release();
      listeners.forEach(remove => remove());
      scene.events.off('pause', release);
      scene.events.off('sleep', release);
      scene.events.off('preupdate', controller.update);
      if (hint) hint.style.display = 'none';
    },
  };
  // Runs even when the game update returns early for editor or spectator mode.
  scene.events.on('preupdate', controller.update);
  controller.update();
  return controller;
}
