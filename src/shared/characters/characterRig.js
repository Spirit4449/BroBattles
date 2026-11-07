// Character rigs: named points on a character's artwork, in the pixel
// coordinates of its base atlas frames (the character definition's `frame`),
// facing right. One conversion, artToWorld, turns them into world positions
// for any facing, scale and origin, so drawing code never hand-tunes offsets.
//
// A definition's `rig` block:
//   "rig": {
//     "frame": [256, 256],                // optional: art size if not the gameplay frame
//     "feet": [103, 137],                 // stand point: x under the character,
//                                         // y the hitbox bottom (the floor)
//     "points": {
//       "chest": [109, 70],               // the same point on every frame
//       "staffTip": {                     // or per animation, by frame index
//         "default": [88, 62],
//         "attack": [[142, 76], [140, 76]]
//       }
//     }
//   }
// Frame names are an animation prefix plus a number (`attack03`); a list
// shorter than the animation holds its last point.
const { characterDefinitions, characterFrames, characterPresentation } = require("./index.js");
const { getCharacterStats } = require("./characterStats.js");
const { characterBody } = require("../physics/characterBody.js");

// `frame` is the art's frame size when the drawn atlas differs from the
// gameplay frame (high-resolution art); points are only valid on art of that size.
function rigOf(character) {
  const definition = characterDefinitions[character];
  const rig = definition?.rig || {};
  const size = validPoint(rig.frame);
  const frame = size ? { w: size[0], h: size[1] } : characterFrames[character] || null;
  return { frame, feet: validPoint(rig.feet), points: rig.points || {} };
}

function validPoint(point) {
  return Array.isArray(point) && point.length >= 2 && point.every(Number.isFinite) ? [point[0], point[1]] : null;
}

// Art-space position of a named point on the given frame, or null.
function rigPointArt(character, name, frameName = "") {
  const rig = rigOf(character);
  if (name === "feet") return rig.feet;
  const point = rig.points[name];
  if (!point) return null;
  if (validPoint(point)) return validPoint(point);
  if (point.pivot !== undefined) return validPoint(point.pivot);
  const match = /^(.*?)(\d+)$/.exec(String(frameName || ""));
  const perFrame = match && Array.isArray(point[match[1]]) ? point[match[1]] : null;
  if (perFrame?.length) return validPoint(perFrame[Math.min(perFrame.length - 1, Number(match[2]))]);
  return validPoint(point.default);
}

// World position of an art point for a sprite-like view:
//   { x, y, flip, scaleX, scaleY, frameW, frameH, originX, originY }
// Phaser mirrors a flipped texture inside its frame, so facing left the point
// sits at frameW - x before the origin (a fraction of the frame) is applied.
function artToWorld(view, [ax, ay]) {
  const frameW = Number(view.frameW) || 0;
  const frameH = Number(view.frameH) || 0;
  const scaleX = Math.abs(Number(view.scaleX ?? 1));
  const scaleY = Math.abs(Number(view.scaleY ?? view.scaleX ?? 1));
  const originX = Number.isFinite(view.originX) ? view.originX : 0.5;
  const originY = Number.isFinite(view.originY) ? view.originY : 0.5;
  return {
    x: Number(view.x) + ((view.flip ? frameW - ax : ax) - originX * frameW) * scaleX,
    y: Number(view.y) + (ay - originY * frameH) * scaleY,
  };
}

// Content check: every rig point is a pair of numbers inside the frame.
function rigErrors(definition) {
  const rig = definition?.rig;
  if (!rig) return [];
  const errors = [];
  if (rig.frame !== undefined && !(validPoint(rig.frame) && rig.frame[0] > 0 && rig.frame[1] > 0)) errors.push("rig frame must be [width, height]");
  const [w, h] = validPoint(rig.frame) || [definition.frame?.w, definition.frame?.h];
  const check = (label, point) => {
    if (!validPoint(point)) errors.push(`rig ${label} must be [x, y]`);
    else if (!(point[0] >= 0 && point[0] <= w && point[1] >= 0 && point[1] <= h)) errors.push(`rig ${label} is outside the ${w}x${h} frame`);
  };
  if (rig.feet !== undefined) check("feet", rig.feet);
  for (const [name, point] of Object.entries(rig.points || {})) {
    if (Array.isArray(point)) { check(name, point); continue; }
    if (!point || typeof point !== "object") { errors.push(`rig ${name} must be [x, y] or per-animation lists`); continue; }
    if (point.pivot !== undefined) {
      check(`${name}.pivot`, point.pivot);
      if (!(Number(point.reach) >= 0)) errors.push(`rig ${name}.reach must be a distance in art pixels`);
      continue;
    }
    for (const [animation, value] of Object.entries(point)) {
      if (animation === "default") check(`${name}.default`, value);
      else if (!Array.isArray(value) || !value.length) errors.push(`rig ${name}.${animation} must list one point per frame`);
      else value.forEach((frame, index) => check(`${name}.${animation}[${index}]`, frame));
    }
  }
  return errors;
}

// World pixels per art pixel for the rig's art (high-resolution art has its
// own scale; otherwise the character's sprite scale).
function artScale(character) {
  const art = characterPresentation(character).hiResArt;
  if (characterDefinitions[character]?.rig?.frame && art?.scale) return art.scale;
  return getCharacterStats(character)?.spriteScale || 1;
}

// World position of an art point from gameplay state alone ({ x, y, flip },
// no sprite), for the server, bots and predictions. The rig's feet are the
// stand point: x on the player position, y on the hitbox bottom, so this
// matches the drawn sprite exactly.
function rigWorldPoint(character, pose, art) {
  const feet = rigOf(character).feet;
  if (!feet || !art) return null;
  const body = characterBody(character, !!pose.flip);
  const scale = artScale(character);
  const facing = pose.flip ? -1 : 1;
  return {
    x: Number(pose.x) + (art[0] - feet[0]) * scale * facing,
    y: Number(pose.y) + body.offsetY + body.height / 2 + (art[1] - feet[1]) * scale,
  };
}

// A launch point (`rig.points.<name>`: { "pivot": [x, y], "reach": px,
// "alongAim": true }): projectiles leave `reach` art pixels from the pivot,
// along the aim angle, or straight ahead when `alongAim` is false.
function muzzleOf(character, name, pose) {
  const spec = rigOf(character).points[name];
  const pivotArt = validPoint(spec?.pivot);
  const pivot = pivotArt && rigWorldPoint(character, pose, pivotArt);
  if (!pivot) return null;
  return { pivot, reach: Math.max(0, Number(spec.reach) || 0) * artScale(character), alongAim: spec.alongAim !== false };
}

function launchPoint(character, name, pose, angle = 0) {
  const muzzle = muzzleOf(character, name, pose);
  if (!muzzle) return null;
  const facing = pose.flip ? -1 : 1;
  const [ux, uy] = muzzle.alongAim ? [Math.cos(angle), Math.sin(angle)] : [facing, 0];
  return { x: muzzle.pivot.x + ux * muzzle.reach, y: muzzle.pivot.y + uy * muzzle.reach };
}

module.exports = { rigOf, rigPointArt, artToWorld, rigErrors, artScale, rigWorldPoint, muzzleOf, launchPoint };
