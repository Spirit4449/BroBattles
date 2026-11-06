// gameScene/displayRatePhysics.js
//
// Arcade physics steps at a fixed 60 Hz by default and never interpolates the
// result. On a 120 Hz display (ProMotion MacBooks, most gaming monitors) the
// local fighter therefore moved on every other frame while the camera eased on
// every frame, so the fighter shook against the view and looked doubled and
// blurred while running. Browsers that cap at 60 Hz (Safari) hid most of it,
// though rAF timing still made the accumulator take 0 or 2 steps now and then.
//
// Step the world exactly once per rendered frame instead, by the frame's own
// (Phaser-smoothed) delta. A long frame is split into equal steps no longer
// than MAX_PHYSICS_STEP_MS, as the 60 Hz accumulator did, so a hitch cannot
// carry a falling body through a platform in one step.

export const MAX_PHYSICS_STEP_MS = 1000 / 60;
// Phaser's TimeStep already replaces deltas over 200 ms; this only guards
// against a pathological value turning into hundreds of steps.
const MAX_FRAME_MS = 250;

export function physicsStepsForFrame(deltaMs, maxStepMs = MAX_PHYSICS_STEP_MS) {
  const delta = Math.min(MAX_FRAME_MS, Number(deltaMs) || 0);
  if (!(delta > 0)) return { steps: 0, stepMs: 0 };
  // The epsilon keeps a frame of exactly maxStepMs (plus float noise) at one step.
  const steps = Math.max(1, Math.ceil(delta / maxStepMs - 1e-6));
  return { steps, stepMs: delta / steps };
}

// Arcade's World.update(time, delta) adds `delta` to its accumulator and steps
// while the accumulator covers one step of 1000 / fps ms (times timeScale).
// Before each update, size the step to this frame and prime the accumulator
// so that exactly `steps` steps run, whatever the float rounding.
export function primeWorldForFrame(world, deltaMs, maxStepMs = MAX_PHYSICS_STEP_MS) {
  if (!world) return 0;
  const { steps, stepMs } = physicsStepsForFrame(deltaMs, maxStepMs);
  if (!steps) {
    world._elapsed = 0;
    return 0;
  }
  const timeScale = Number(world.timeScale) > 0 ? Number(world.timeScale) : 1;
  world.setFPS(1000 * timeScale / stepMs);
  const msPerStep = world._frameTimeMS * timeScale;
  const delta = Math.min(MAX_FRAME_MS, Number(deltaMs) || 0);
  // After `_elapsed += delta` the accumulator holds steps * msPerStep plus a
  // margin far smaller than one step: every step runs, and no extra one.
  world._elapsed = steps * msPerStep - delta + msPerStep * 1e-3;
  // A clamped frame passes Phaser more delta than was primed for; never let
  // that leftover become extra steps.
  if (Number(deltaMs) > delta) world._elapsed -= Number(deltaMs) - delta;
  return steps;
}

// Arcade integrates semi-implicitly (velocity first, then position by the new
// velocity), so a body under constant acceleration a drifts a * h * t / 2 from
// the exact path with step h: shorter steps meant jumps peaked ~3 px higher at
// 120 Hz than at 60 Hz. Adding (v_after - v_before) * (h_ref - h) / 2 to each
// step's displacement makes any step length trace the 60 Hz path; a 60 Hz step
// is left untouched. Using the step's actual velocity change also covers drag,
// fast-fall gravity and the speed caps. Velocity, and `newVelocity` (which the
// dash sweep turns back into velocity), are not changed.
export function referenceStepCorrection(velocityChange, stepSeconds, referenceStepMs = MAX_PHYSICS_STEP_MS) {
  const lag = referenceStepMs / 1000 - stepSeconds;
  return lag > 1e-9 ? velocityChange * lag / 2 : 0;
}

export function integrateLikeReferenceStep(body, referenceStepMs = MAX_PHYSICS_STEP_MS) {
  if (!body || typeof body.update !== 'function' || body._referenceStepUpdate) return () => {};
  const update = body.update;
  const corrected = function (delta) {
    const vx = this.velocity.x, vy = this.velocity.y;
    update.call(this, delta);
    if (!this.moves) return;
    const cx = referenceStepCorrection(this.velocity.x - vx, delta, referenceStepMs);
    const cy = referenceStepCorrection(this.velocity.y - vy, delta, referenceStepMs);
    if (!cx && !cy) return;
    this.position.x += cx;
    this.position.y += cy;
    this._dx = this.position.x - this.prev.x;
    this._dy = this.position.y - this.prev.y;
    this.updateCenter();
  };
  body.update = corrected;
  body._referenceStepUpdate = true;
  return () => {
    if (body.update === corrected) body.update = update;
    body._referenceStepUpdate = false;
  };
}

// Runs before the Arcade plugin's own update in every scene step.
export function installDisplayRatePhysics(scene) {
  const world = scene?.physics?.world;
  if (!world || !scene.events) return () => {};
  world.fixedStep = true;
  const prime = (_time, delta) => primeWorldForFrame(world, delta);
  scene.events.on('preupdate', prime);
  const remove = () => scene.events.off('preupdate', prime);
  scene.events.once('shutdown', remove);
  return remove;
}
