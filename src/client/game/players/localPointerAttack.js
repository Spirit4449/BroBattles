import { getSettings } from "../../site/preferences";
import { getPlayerAimBasePoint, resolveAttackAimContext, getNearestOpponentDirection } from "../characters/shared/attackAim";
import { createAttackAimReticleController } from "../scene/attackAimReticle";
import { createCombatMouseController } from "../scene/combatMouse";

const FOLLOW_UP_CURSOR_RADIUS = 38;

export function serializeAimContext(context) {
  if (!context || typeof context !== "object") return null;
  const out = {
    family: String(context.family || "basic").toLowerCase(),
    kind: String(context.kind || "line").toLowerCase(),
    direction: Number(context.direction) === -1 ? -1 : 1,
  };
  if (Number.isFinite(Number(context.angle))) out.angle = Number(context.angle);
  if (Number.isFinite(Number(context.range))) out.range = Number(context.range);
  if (Number.isFinite(Number(context.speedScale))) {
    out.speedScale = Number(context.speedScale);
  }
  if (
    Number.isFinite(Number(context.targetX)) &&
    Number.isFinite(Number(context.targetY))
  ) {
    out.target = {
      x: Number(context.targetX),
      y: Number(context.targetY),
    };
  }
  if (Number.isFinite(Number(context.coneRadius))) {
    out.coneRadius = Number(context.coneRadius);
  }
  if (Number.isFinite(Number(context.coneSpreadDeg))) {
    out.coneSpreadDeg = Number(context.coneSpreadDeg);
  }
  if (Number.isFinite(Number(context.coneInnerRadius))) {
    out.coneInnerRadius = Number(context.coneInnerRadius);
  }
  if (Number.isFinite(Number(context.roundRadius))) {
    out.roundRadius = Number(context.roundRadius);
  }
  return out;
}

export function createLocalPointerAttack(scene, currentCharacter, opponentPlayersRef, stats, options) {
  let attackAimReticleController = null;
  let pointerAttackHandlers = null;
  let pointerAttackScene = null;
  let pointerContextMenuCanvas = null;
  let pointerContextMenuHandler = null;
  let combatMouseController = null;
  let player;
  let followUpCursor = null;
  let followUpPointer = null;

  const attackAimState = {
    active: false,
    pointerId: null,
    family: "basic",
    button: 0,
    currentContext: null,
  };

  attackAimReticleController = createAttackAimReticleController(scene, {
    getAmmoCharges: options.getAmmoCharges,
    getPlayer: () => player,
  });

  function clearAttackAimReticle() {
    try {
      attackAimReticleController?.hide?.();
    } catch (_) {}
  }

  function resetPointerAttackAim() {
    combatMouseController?.endDrag();
    attackAimState.active = false;
    attackAimState.pointerId = null;
    attackAimState.family = "basic";
    attackAimState.button = 0;
    attackAimState.currentContext = null;
    clearAttackAimReticle();
  }

  function clearGameCursor(targetScene = pointerAttackScene || scene) {
    try {
      const canvas = targetScene?.game?.canvas;
      if (canvas?.style) {
        canvas.style.cursor = "";
      }
    } catch (_) {}
  }

  function detachPointerAttackBindings(
    targetScene = pointerAttackScene || scene,
  ) {
    const sceneToDetach = targetScene || pointerAttackScene || scene;
    if (!sceneToDetach) return;
    const isTrackedScene =
      !pointerAttackScene || pointerAttackScene === sceneToDetach;
    clearGameCursor(sceneToDetach);
    if (!isTrackedScene) return;
    combatMouseController?.destroy();
    combatMouseController = null;
    try {
      if (pointerAttackHandlers?.down) {
        sceneToDetach?.input?.off?.("pointerdown", pointerAttackHandlers.down);
      }
      if (pointerAttackHandlers?.move) {
        sceneToDetach?.input?.off?.("pointermove", pointerAttackHandlers.move);
      }
      if (pointerAttackHandlers?.up) {
        sceneToDetach?.input?.off?.("pointerup", pointerAttackHandlers.up);
        sceneToDetach?.input?.off?.("pointerupoutside", pointerAttackHandlers.up);
      }
      if (pointerAttackHandlers?.gameout) {
        sceneToDetach?.input?.off?.("gameout", pointerAttackHandlers.gameout);
      }
    } catch (_) {}
    try {
      pointerContextMenuCanvas?.removeEventListener?.(
        "contextmenu",
        pointerContextMenuHandler,
      );
    } catch (_) {}
    pointerAttackHandlers = null;
    pointerAttackScene = null;
    pointerContextMenuCanvas = null;
    pointerContextMenuHandler = null;
  }

  function resolveQuickAttackContext(family = "basic") {
    if (combatMouseController?.shouldShowReticle()) return resolveDirectionalAttackContext(family);
    return resolveAttackAimContext({
      character: currentCharacter,
      player,
      family,
      quick: true,
      quickFacingDirection: getNearestOpponentDirection(player, opponentPlayersRef),
    });
  }

  function getAimBasePoint(family = attackAimState.family || "basic") {
    return (
      getPlayerAimBasePoint({
        character: currentCharacter,
        player,
        family,
      }) || { baseX: Number(player?.x) || 0, baseY: Number(player?.y) || 0 }
    );
  }

  function resolveDirectionalAttackContext(family = "basic") {
    if (!player || !combatMouseController) return null;
    if (combatMouseController.isDefaultAim()) {
      return resolveAttackAimContext({ character: currentCharacter, player, family, quick: true,
        quickFacingDirection: getNearestOpponentDirection(player, opponentPlayersRef) });
    }
    const base = getAimBasePoint(family);
    const direction = combatMouseController.getDirection();
    const defaultRange = Number(base.config?.defaultRange) || 120;
    const minRange = Number(base.config?.minRange) || defaultRange;
    const maxRange = Number(base.config?.maxRange) || defaultRange;
    const range = base.config?.kind === "throw"
      ? minRange + (maxRange - minRange) * combatMouseController.getDistanceRatio()
      : defaultRange;
    return resolveAttackAimContext({
      character: currentCharacter, player, family, quick: false,
      pointerWorldX: base.baseX + direction.x * range,
      pointerWorldY: base.baseY + direction.y * range,
    });
  }

  function startPointerAttackAim(pointer, family = "basic", button = 0) {
    if (!pointer || stats.dead) return;
    resetPointerAttackAim();
    if (family !== "followup") {
      combatMouseController?.beginDrag(player?.flipX ? -1 : 1, getAimBasePoint(family).config?.kind === "throw");
    }
    attackAimState.active = true;
    attackAimState.family = family;
    attackAimState.button = button;
    attackAimState.pointerId = pointer.id;
    updatePointerAttackAimState();
  }

  function updatePointerAttackAimState() {
    if (options.getMobileControls()?.isEnabled?.()) return;
    if (options.followUpActive?.()) {
      if (attackAimState.active && attackAimState.family !== "followup") resetPointerAttackAim();
      clearAttackAimReticle();
      if (followUpPointer) updateWorldFollowUpAim(followUpPointer);
      return;
    }
    followUpCursor = null;
    followUpPointer = null;
    if (attackAimState.family === "followup") resetPointerAttackAim();
    if (!player || stats.dead || !combatMouseController?.shouldShowReticle()) {
      clearAttackAimReticle();
      return;
    }
    const family = attackAimState.active ? attackAimState.family : "basic";
    attackAimState.currentContext = resolveDirectionalAttackContext(family);
    attackAimReticleController?.update({ ...attackAimState.currentContext,
      previewStrength: combatMouseController.getStrength(),
      centerCue: combatMouseController.getCenterCue() });
  }

  function updateWorldFollowUpAim(pointer) {
    const camera = scene.cameras?.main;
    if (!camera || combatMouseController?.isPointerLocked?.() || options.isUiCapturingInput()) return;
    const target = camera.getWorldPoint(pointer.x, pointer.y);
    const { baseX, baseY } = getAimBasePoint("followup");
    const dx = target.x - baseX, dy = target.y - baseY;
    if (Math.hypot(dx, dy) > 1) options.aimFollowUp?.(Math.atan2(dy, dx));
  }

  function updateLockedFollowUpAim(dx, dy) {
    if (!options.followUpActive?.()) return false;
    if (!dx && !dy) return true;
    followUpPointer = null;
    if (!followUpCursor) {
      const angle = options.getFollowUpAngle?.() ?? (player.flipX ? Math.PI : 0);
      followUpCursor = { x: Math.cos(angle) * FOLLOW_UP_CURSOR_RADIUS, y: Math.sin(angle) * FOLLOW_UP_CURSOR_RADIUS };
    }
    // Pointer lock supplies deltas. Keep a virtual cursor within easy reach of
    // Sparrow so large movements don't make it harder to turn back.
    const x = followUpCursor.x + dx, y = followUpCursor.y + dy;
    const distance = Math.hypot(x, y);
    const scale = FOLLOW_UP_CURSOR_RADIUS / Math.max(FOLLOW_UP_CURSOR_RADIUS, distance);
    followUpCursor = { x: x * scale, y: y * scale };
    if (distance > 1) options.aimFollowUp?.(Math.atan2(y, x));
    return true;
  }

  function finishPointerAttackAim() {
    // Resolve from the current player position with the same direction as the preview.
    const context = combatMouseController?.isAiming()
      ? resolveDirectionalAttackContext(attackAimState.family)
      : resolveQuickAttackContext(attackAimState.family);
    resetPointerAttackAim();
    return context;
  }

  function bind(sprite) {
    player = sprite;
    // Mouse movement selects direction; left-click releases the basic attack.
    // Right-click mirrors that for supers using the special reticle theme.
    const pointerDownHandler = (pointer) => {
      if (stats.dead || player?._dash || Date.now() < (player?._attackInterruptedUntil || 0)) return;
      if (options.isUiCapturingInput()) return;
      if (options.isControlLocked() && !options.followUpActive?.()) return;
      // Touches belong to the mobile controls overlay.
      if (options.getMobileControls()?.isEnabled?.() && pointer?.wasTouch) return;
      if (!combatMouseController?.beginInput()) return;
      // A super's follow-up aim (Sparrow's Seraph) takes either button.
      if (options.followUpActive?.() && (pointer.button === 0 || pointer.button === 2)) {
        startPointerAttackAim(pointer, "followup", pointer.button);
        return;
      }
      if (pointer.button === 0) {
        startPointerAttackAim(pointer, "basic", 0);
        return;
      }
      if (pointer.button === 2) {
        if (stats.superCharge >= stats.maxSuperCharge) {
          startPointerAttackAim(pointer, "special", 2);
        } else {
          options.triggerSpecialNotReadyFeedback();
        }
      }
    };

    const pointerMoveHandler = (pointer) => {
      if (options.isUiCapturingInput()) return;
      // Touches belong to the mobile controls overlay.
      if (options.getMobileControls()?.isEnabled?.() && pointer?.wasTouch) return;
      if (options.followUpActive?.() && !combatMouseController?.isPointerLocked?.()) {
        followUpPointer = pointer;
        followUpCursor = null;
        updateWorldFollowUpAim(pointer);
        return;
      }
      if (!attackAimState.active) return;
      if (
        attackAimState.pointerId !== null &&
        pointer &&
        pointer.id !== attackAimState.pointerId
      ) {
        return;
      }
      updatePointerAttackAimState();
    };

    const pointerUpHandler = (pointer) => {
      if (options.isUiCapturingInput()) return;
      // Touches belong to the mobile controls overlay.
      if (options.getMobileControls()?.isEnabled?.() && pointer?.wasTouch) return;
      if (!attackAimState.active || (pointer && pointer.id !== attackAimState.pointerId)) return;
      if (attackAimState.family === "followup") {
        if (pointer && pointer.button !== attackAimState.button) return;
        resetPointerAttackAim();
        if (!stats.dead && options.followUpActive?.()) options.fireFollowUp?.();
        return;
      }
      const context = finishPointerAttackAim();
      if (!context || stats.dead || options.isControlLocked() || Date.now() < (player?._attackInterruptedUntil || 0)) return;
      if (String(context.family || "basic").toLowerCase() === "special") {
        options.fireSpecialAttack(context);
        return;
      }
      options.fireBasicAttack(context.direction, context);
    };

    const pointerGameOutHandler = () => {
      followUpPointer = null;
      resetPointerAttackAim();
    };

    pointerAttackHandlers = {
      down: pointerDownHandler,
      move: pointerMoveHandler,
      up: pointerUpHandler,
      gameout: pointerGameOutHandler,
    };
    pointerAttackScene = scene;
    scene.input.on("pointerdown", pointerDownHandler);
    scene.input.on("pointermove", pointerMoveHandler);
    scene.input.on("pointerup", pointerUpHandler);
    scene.input.on("pointerupoutside", pointerUpHandler);
    scene.input.on("gameout", pointerGameOutHandler);
    combatMouseController = createCombatMouseController({
      getPreferences: getSettings,
      scene: scene,
      canPrepare: () => !!player && !scene._battleEnded && !options.isUiCapturingInput() && !options.isSystemNoticeOpen?.() &&
        !options.getMobileControls()?.isEnabled?.() && scene.sys.isActive(),
      canCapture: () => !!player && !scene._battleEnded && !options.isUiCapturingInput() && !options.isSystemNoticeOpen?.() &&
        !options.getMobileControls()?.isEnabled?.() &&
        scene._canPlayBattle?.() !== false && scene.sys.isActive(),
      canPlay: () => !!player && !stats.dead && !options.isUiCapturingInput() && !options.isSystemNoticeOpen?.() &&
        !options.getMobileControls()?.isEnabled?.() &&
        scene._canPlayBattle?.() !== false && scene.sys.isActive(),
      onLockedAimMove: updateLockedFollowUpAim,
      onRelease: () => {
        followUpCursor = null;
        followUpPointer = null;
        resetPointerAttackAim();
        options.resetMovementInputState({ preserveVelocity: true });
      },
    });

    pointerContextMenuCanvas = scene.game?.canvas || null;
    pointerContextMenuHandler = (e) => e.preventDefault();
    pointerContextMenuCanvas?.addEventListener?.(
      "contextmenu",
      pointerContextMenuHandler,
    );

  }
  function destroy() {
    resetPointerAttackAim();
    detachPointerAttackBindings(scene);
    attackAimReticleController?.destroy?.();
    attackAimReticleController = null;
  }
  return { bind, destroy, quick: resolveQuickAttackContext, reset: resetPointerAttackAim,
    clearReticle: clearAttackAimReticle, update: updatePointerAttackAimState,
    get active() { return attackAimState.active; }, get mouse() { return combatMouseController; },
    get reticle() { return attackAimReticleController; } };
}
