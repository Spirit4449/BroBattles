// gameScene/pregameFlythrough.js
//
// Pure camera choreography for the pregame map walkthrough. Nothing here
// touches Phaser, so any map size can be planned and tested in isolation.
//
// One calm shot for every map and screen size: hold a wide view of the enemy
// side so players can take the arena in, then make a single continuous, eased
// move to the local player's normal follow framing. Wide maps read as a pan,
// tall maps as a vertical drift, and maps that fit the screen as a zoom in.
// There is never a direction change, and the shot ends exactly on the follow
// framing so handing control back to the follow camera cannot jump.

// Share of the shot held still on the opening view: a breather to take the
// arena in. ~0.35 s of it is hidden while the loading overlay fades out.
export const OPENING_HOLD = 0.28;
// Longest glide, in screen lengths at the opening zoom. On huge maps the shot
// opens toward the enemy side instead of the far edge, keeping it slow.
const MAX_TRAVEL_SCREENS = 1.5;

export const easeInOutSine = (t) => 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, t))) / 2;

const lerp = (a, b, t) => a + (b - a) * t;
// Zoom changes are perceived multiplicatively; interpolate in log space.
const lerpZoom = (a, b, t) => Math.exp(lerp(Math.log(a), Math.log(b), t));

/** The lowest zoom that keeps the viewport inside the camera bounds. */
export function fitZoom(bounds, view) {
  return Math.max(view.width / bounds.width, view.height / bounds.height);
}

/** Clamp a camera midpoint the same way Phaser clamps scroll to its bounds. */
export function clampCenter(bounds, view, zoom, x, y) {
  const halfW = view.width / zoom / 2;
  const halfH = view.height / zoom / 2;
  // Phaser pins an oversized view to the bounds' leading edge.
  const clampAxis = (value, min, size, half) =>
    Math.max(min + half, Math.min(min + size - half, value));
  return {
    x: clampAxis(x, bounds.x, bounds.width, halfW),
    y: clampAxis(y, bounds.y, bounds.height, halfH),
  };
}

function frame(bounds, view, zoom, point) {
  return { ...clampCenter(bounds, view, zoom, point.x, point.y), zoom };
}

/**
 * Plan the walkthrough.
 * @param {object} input
 * @param {{x:number,y:number,width:number,height:number}} input.bounds camera bounds
 * @param {{width:number,height:number}} input.view viewport size in screen pixels
 * @param {{x:number,y:number}|null} input.enemy enemy spawn centroid, if known
 * @param {{x:number,y:number,zoom:number}} input.final the follow camera's framing
 * @returns {{keys:Array<{at:number,x:number,y:number,zoom:number}>}}
 *   keys are timed as fractions of the shot (0..1); the last key is the final framing.
 */
export function planFlythrough({ bounds, view, enemy, final }) {
  // As wide as the bounds allow, but never wider than where the shot ends.
  const overviewZoom = Math.min(fitZoom(bounds, view), final.zoom);
  // Without enemy positions, open on the part of the map farthest from us.
  const opening = enemy || {
    x: 2 * (bounds.x + bounds.width / 2) - final.x,
    y: 2 * (bounds.y + bounds.height / 2) - final.y,
  };
  let start = frame(bounds, view, overviewZoom, opening);
  const screenW = view.width / overviewZoom;
  const screenH = view.height / overviewZoom;
  const travel = Math.hypot((start.x - final.x) / screenW, (start.y - final.y) / screenH);
  if (travel > MAX_TRAVEL_SCREENS) {
    const keep = MAX_TRAVEL_SCREENS / travel;
    start = frame(bounds, view, overviewZoom, {
      x: final.x + (start.x - final.x) * keep,
      y: final.y + (start.y - final.y) * keep,
    });
  }
  return {
    keys: [
      { at: 0, ...start },
      { at: OPENING_HOLD, ...start },
      { at: 1, x: final.x, y: final.y, zoom: final.zoom },
    ],
  };
}

/** Camera framing at `progress` (0..1), clamped to the bounds when given. */
export function sampleFlythrough(plan, progress, { bounds, view } = {}) {
  const keys = plan.keys;
  const t = Math.min(1, Math.max(0, progress));
  let i = 1;
  while (i < keys.length - 1 && keys[i].at <= t) i++;
  const a = keys[i - 1];
  const b = keys[i];
  const local = b.at > a.at ? easeInOutSine((t - a.at) / (b.at - a.at)) : 1;
  const zoom = lerpZoom(a.zoom, b.zoom, local);
  const x = lerp(a.x, b.x, local);
  const y = lerp(a.y, b.y, local);
  return bounds && view ? frame(bounds, view, zoom, { x, y }) : { x, y, zoom };
}

/** Blend smoothly from a frozen framing to a (possibly moving) target. */
export function blendFraming(from, to, progress) {
  const t = easeInOutSine(progress);
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    zoom: lerpZoom(from.zoom, to.zoom, t),
  };
}
