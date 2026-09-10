// Relative displacement from each press; camera and player movement never move this origin.
export const COMBAT_MOUSE_CONFIG = Object.freeze({
  dragStartDistance: 10,
  dragReleaseDistance: 6,
  fullDragDistance: 120,
  mouseSensitivity: 0.24,
  throwCenterDistance: 28,
  throwCenterExitDistance: 38,
  lookAhead: 72,
});

export function createCombatMouseController({ scene, canPlay, canCapture = canPlay, onRelease, config = COMBAT_MOUSE_CONFIG }) {
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
  let wasPlayable = false;
  const listeners = [];
  const listen = (target, name, fn) => {
    target.addEventListener(name, fn, true);
    listeners.push(() => target.removeEventListener(name, fn, true));
  };
  const release = () => {
    const hadInput = active || pending;
    active = false;
    pending = false;
    cursorReleased = true;
    canvas.style.cursor = '';
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
    canvas.style.cursor = 'none';
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
    dragX += dx * config.mouseSensitivity;
    dragY += dy * config.mouseSensitivity;
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
    // Once a throw is visible, hold its heading through the center. A wider
    // exit threshold prevents jitter from repeatedly reversing a short throw.
    if (variableDistance && aiming) {
      centerHeld = distance < (centerHeld ? config.throwCenterExitDistance : config.throwCenterDistance);
      if (centerHeld) return;
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
      ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', ' '].includes(event.key?.length === 1 ? event.key.toLowerCase() : event.key)) {
      controller.beginInput();
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
    isActive: () => active,
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
      wasPlayable = playable;
      const hideCursor = playable && !cursorReleased;
      canvas.style.cursor = hideCursor ? 'none' : '';
      if (hint) hint.style.display = hideCursor ? '' : 'none';
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
