import { encodeWire } from "../../../shared/networkWire";
import { quantizeMovementPosition } from '../../../shared/physics/movementPrecision';
// gameScene/localInputSync.js
// Emits game:input: the locally simulated position plus control state. A change
// in control intent (direction, jump, duck, ...) bypasses the send throttle.
//
// Packets go out once per rendered frame, at most about 60 a second, gated on
// the frame's own rAF timestamp. The old gate compared Date.now() read partway
// through the frame against a 16 ms throttle, so on a 60 Hz display a frame
// that happened to read 15 ms was skipped and left a 33 ms hole; the server's
// playout delay (humanPlayout.js) follows the 90th percentile of those holes.
// `netInputCadence=legacy` restores the old gate for comparisons.

import { localMovementCorrector } from "../players/localMovementCorrector.js";
import { noteClientInputSent, noteClientIntentSent } from "../../lib/netTestLogger.js";

const RELIABLE_KEYFRAME_INTERVAL_MS = 250;
const RELIABLE_KEYFRAME_DISTANCE_PX = 140;
// The send cap. A frame counts as due when it lands within a tolerance of the
// interval: half a frame, but at most a quarter of the interval, so 60-80 Hz
// displays send every frame and 90-144 Hz ones every second frame.
export const INPUT_SEND_INTERVAL_MS = 1000 / 60;

// Whether a frame drawn at `frameNow` (`frameDeltaMs` after the previous one)
// should publish, given the frame time of the last packet sent.
export function inputFrameDue(frameNow, lastSentFrameAt, frameDeltaMs) {
  if (!Number.isFinite(lastSentFrameAt) || !Number.isFinite(frameNow)) return true;
  const elapsed = frameNow - lastSentFrameAt;
  if (elapsed < 0) return true; // the frame clock restarted
  const delta = Number(frameDeltaMs) > 0 ? Number(frameDeltaMs) : INPUT_SEND_INTERVAL_MS;
  const tolerance = Math.min(delta / 2, INPUT_SEND_INTERVAL_MS / 4);
  return elapsed >= INPUT_SEND_INTERVAL_MS - tolerance;
}

export function createLocalInputSync({
  socket,
  getAmmoSyncState,
  getNetworkInputState,
  throttleMs = 20,
  // false: the legacy Date.now() throttle (`netInputCadence=legacy`).
  frameCadence = true,
}) {
  let lastMovementSent = 0;
  let lastSentFrameAt = null;
  let lastReliableMovementSent = 0;
  let lastPlayerState = { x: 0, y: 0, flip: false, animation: null };
  let lastReliablePlayerState = null;
  let lastIntentState = {
    direction: 0,
    jumpHeld: false,
    jumpPressed: false,
    facing: 1,
    grounded: false,
    ducking: false,
    movementLocked: false,
  };
  let inputIntentSeq = 0; // sequence number for intent tracking
  let lastAmmoState = null;
  let lastAmmoStateSentAt = 0;
  let lastAnimationSent = null;
  let lastAnimationSentAt = 0;

  const quantizeVelocity = (value) => Math.round(Number(value) || 0);
  const sameAmmoState = (a, b) =>
    !!a &&
    !!b &&
    a.capacity === b.capacity &&
    a.charges === b.charges &&
    a.cooldownMs === b.cooldownMs &&
    a.reloadMs === b.reloadMs &&
    a.reloadTimerMs === b.reloadTimerMs &&
    a.nextFireInMs === b.nextFireInMs;
  const sameIntentState = (a, b) =>
    !!a &&
    !!b &&
    Number(a.direction) === Number(b.direction) &&
    !!a.jumpHeld === !!b.jumpHeld &&
    !!a.jumpPressed === !!b.jumpPressed &&
    Number(a.facing) === Number(b.facing) &&
    !!a.grounded === !!b.grounded &&
    !!a.ducking === !!b.ducking &&
    !!a.movementLocked === !!b.movementLocked;

  // Once per frame: simulate the local player, then publish if due.
  function sync(scene, player, { dead, gameEnded, handlePlayerMovement, force = false, reliable = false }) {
    if (!player || dead || gameEnded) return;
    handlePlayerMovement(scene);
    publish(scene, player, { force, reliable });
  }

  // Sends the state the frame loop last simulated. A forced flush (before an
  // attack request) runs from inside the frame's movement update or from an
  // input event, so it must never simulate again: that ran jump, dash, reload
  // and effect timers twice in one frame.
  function publish(scene, player, { force = false, reliable = false } = {}) {
    const now = Date.now();
    const loopNow = Number(scene?.game?.loop?.now);
    const frameNow = Number.isFinite(loopNow) && loopNow > 0 ? loopNow : now;
    const rawInput = getNetworkInputState ? getNetworkInputState() : null;
    const inputIntent = {
      direction: Number(rawInput?.direction) || 0,
      jumpHeld: !!rawInput?.jumpHeld,
      jumpPressed: !!rawInput?.jumpPressed,
      facing: Number(rawInput?.facing) === -1 ? -1 : 1,
      grounded: !!rawInput?.grounded,
      ducking: !!rawInput?.ducking,
      vx: quantizeVelocity(rawInput?.vx),
      vy: quantizeVelocity(rawInput?.vy),
      animation:
        typeof rawInput?.animation === "string" ? rawInput.animation : null,
      movementLocked: !!rawInput?.movementLocked,
      timestamp: now,
    };
    const intentChanged = !sameIntentState(inputIntent, lastIntentState);
    const due = frameCadence
      ? inputFrameDue(frameNow, lastSentFrameAt, scene?.game?.loop?.delta)
      : now - lastMovementSent >= throttleMs;
    if (!force && !intentChanged && !due) return;
    const packetSequence = inputIntentSeq++;
    inputIntent.sequence = packetSequence;

    const ammoState = getAmmoSyncState();
    const animation = inputIntent.animation || null;
    const includeAmmoState =
      !sameAmmoState(ammoState, lastAmmoState) ||
      now - lastAmmoStateSentAt >= 250;
    const includeAnimation =
      animation !== lastAnimationSent || now - lastAnimationSentAt >= 180;

    const currentState = {
      dashSeq: player._dashSeq || 0,
      dashX: player._dashDirection?.x || 0,
      dashY: player._dashDirection?.y || 0,
      x: quantizeMovementPosition(player.x),
      y: quantizeMovementPosition(player.y),
      flip: player.flipX,
      vx: quantizeVelocity(player.body?.velocity?.x),
      vy: quantizeVelocity(player.body?.velocity?.y),
      grounded: !!player.body?.touching?.down,
      ducking: !!rawInput?.ducking,
      wallSliding: !!rawInput?.wallSliding,
      wallSide:
        rawInput?.wallSide === "left" || rawInput?.wallSide === "right"
          ? rawInput.wallSide
          : null,
      movementFxSeq: Math.max(
        0,
        Math.floor(Number(rawInput?.movementFxSeq) || 0),
      ),
      movementFxType:
        typeof rawInput?.movementFxType === "string"
          ? rawInput.movementFxType
          : null,
      movementFxDirection: Math.sign(
        Number(rawInput?.movementFxDirection) || 0,
      ),
      movementFxWallSide:
        rawInput?.movementFxWallSide === "left" ||
        rawInput?.movementFxWallSide === "right"
          ? rawInput.movementFxWallSide
          : null,
      movementFxFallDistance: Math.max(
        0,
        Math.round(Number(rawInput?.movementFxFallDistance) || 0),
      ),
      movementFxImpactVelocity: Math.max(
        0,
        Math.round(Number(rawInput?.movementFxImpactVelocity) || 0),
      ),
      sequence: packetSequence,
      // Lets the server discard packets sent before the latest correction.
      correctionAck: localMovementCorrector.getAck(),
      timestamp: now,
    };
    if (includeAnimation) currentState.animation = animation;
    if (includeAmmoState) currentState.ammoState = ammoState;

    const reliableDx =
      lastReliablePlayerState && Number.isFinite(lastReliablePlayerState.x)
        ? currentState.x - lastReliablePlayerState.x
        : 0;
    const reliableDy =
      lastReliablePlayerState && Number.isFinite(lastReliablePlayerState.y)
        ? currentState.y - lastReliablePlayerState.y
        : 0;
    const shouldSendReliable =
      currentState.dashSeq !== (lastPlayerState.dashSeq || 0) ||
      currentState.movementFxSeq !== lastPlayerState.movementFxSeq ||
      reliable ||
      force ||
      now - lastReliableMovementSent >= RELIABLE_KEYFRAME_INTERVAL_MS ||
      !lastReliablePlayerState ||
      Math.hypot(reliableDx, reliableDy) >= RELIABLE_KEYFRAME_DISTANCE_PX;
    if (shouldSendReliable) currentState.keyframe = true;

    const movementEmitter = shouldSendReliable
      ? socket.compress(false)
      : socket.volatile.compress(false);

    // Disable per-message compression for movement for lower latency.
    // Send every throttle interval, not only on visible state deltas.
    const packet = { ...currentState };
    // Changed effects go reliably, so a dropped volatile packet cannot consume
    // the event sequence before its details reach the server.
    if (shouldSendReliable) {
      packet.loaded = true; // late join readiness, refreshed on keyframes
      packet.animation = animation;
      packet.ammoState = ammoState;
    } else {
      for (const key of ['movementFxType', 'movementFxDirection',
        'movementFxWallSide', 'movementFxFallDistance', 'movementFxImpactVelocity']) delete packet[key];
    }
    movementEmitter.emit("game:input", encodeWire(packet));
    localMovementCorrector.recordSent(packetSequence, currentState.x, currentState.y);
    noteClientInputSent({
      now,
      previousState: lastPlayerState,
      currentState,
      previousSentAt: lastMovementSent,
    });

    noteClientIntentSent(inputIntent);

    lastPlayerState = { ...currentState };
    if (shouldSendReliable) {
      lastReliablePlayerState = { ...currentState };
      lastReliableMovementSent = now;
    }
    lastIntentState = {
      direction: inputIntent.direction,
      jumpHeld: inputIntent.jumpHeld,
      jumpPressed: inputIntent.jumpPressed,
      facing: inputIntent.facing,
      grounded: inputIntent.grounded,
      ducking: inputIntent.ducking,
      movementLocked: inputIntent.movementLocked,
    };
    lastMovementSent = now;
    lastSentFrameAt = frameNow;
    if (includeAmmoState) {
      lastAmmoState = { ...ammoState };
      lastAmmoStateSentAt = now;
    }
    if (includeAnimation) {
      lastAnimationSent = animation;
      lastAnimationSentAt = now;
    }
  }

  return {
    sync,
    flushNow(scene, player, state = {}) {
      if (!player || state.dead || state.gameEnded) return;
      return publish(scene, player, { force: true, reliable: true });
    },
  };
}
