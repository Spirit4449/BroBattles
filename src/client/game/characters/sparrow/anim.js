import { createAnimationBuilder } from '../shared/animationBuilder';
import { DIRECTIONS } from './aimPoses';
import movementPhysics from '../../../../shared/physics/movementPhysics.json';

const SHOT = [0, 1, 2, 3, 4, 5];
// Hold the drawn bow, snap the release, then recover without a long aura.
const SPECIAL = [0, 1, 2, 2, 3, 4, 5];
const frameNames = (prefix, order) => order.map((i) => `${prefix}${String(i).padStart(2, '0')}`);
export function animations(scene) {
  const NAME = "sparrow";
  if (!scene?.textures?.exists(NAME)) return;

  const { make } = createAnimationBuilder(scene, NAME);

  make(`${NAME}-idle`, ["idle", "stand"], 8, -1);
  make(`${NAME}-running`, ["run", "running", "walk"], 18, -1);
  make(`${NAME}-jumping`, ["jump", "jumping"], 14, 0);
  // Slow enough that the flutter into the hover reads before it holds.
  make(`${NAME}-falling`, ["fall", "falling"], 5, 0);
  make(`${NAME}-sliding`, ["slide", "sliding", "wall"], 6, 2);
  // Explicit orders: the `attack` prefix also matches the angled sets (attackHigh00...).
  make(`${NAME}-throw`, ["attack", "throw"], 24, 0, frameNames("attack", SHOT));
  make(`${NAME}-special`, ["special", "attack", "throw"], 20, 0, frameNames("attack", SPECIAL));
  // Angled shots play as variants of the level ones (see aimPoses.js).
  for (const { key, frame } of DIRECTIONS) {
    if (!key) continue;
    make(`${NAME}-throw-${key}`, [], 24, 0, frameNames(frame, SHOT));
    make(`${NAME}-special-${key}`, [], 20, 0, frameNames(frame, SPECIAL));
  }
  // Three-frame directional dashes timed to the shared dash, then held (dash.cjs).
  for (const direction of ["dashright", "dashdiagonal", "dashup"]) {
    make(`${NAME}-${direction}`, [direction], 3 * 1000 / movementPhysics.dashDurationMs, 0);
  }
  make(`${NAME}-dying`, ["die", "dying", "death", "dead"], 10, 0);
}
