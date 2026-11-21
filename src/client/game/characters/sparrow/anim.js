import { characterDefinitions } from "../../../../shared/characters/index.js";
import { createAnimationBuilder } from '../shared/animationBuilder';
import { DIRECTIONS } from './aimPoses';
import { SERAPH_DIRECTIONS, SERAPH_FLUTTER_FPS } from '../../../../shared/characters/sparrowSeraphAim.js';
import { SERAPH_FX_KEY, SERAPH_FX_ANIMS } from './seraphFx';
import movementPhysics from '../../../../shared/physics/movementPhysics.json';

const { key: NAME } = characterDefinitions.sparrow;

const SHOT = [0, 1, 2, 3, 4, 5];
const frameNames = (prefix, order) => order.map((i) => `${prefix}${String(i).padStart(2, '0')}`);
export function animations(scene) {
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
  // The super press shows Seraph's rise.
  make(`${NAME}-special`, [], 12, 0, frameNames("seraphRise", [0, 1, 2, 3, 4, 5, 6, 7]));
  // Angled shots play as variants of the level ones (see aimPoses.js).
  for (const { key, frame } of DIRECTIONS) {
    if (!key) continue;
    make(`${NAME}-throw-${key}`, [], 24, 0, frameNames(frame, SHOT));
  }
  // Three-frame directional dashes timed to the shared dash, then held (dash.cjs).
  for (const direction of ["dashright", "dashdiagonal", "dashup"]) {
    make(`${NAME}-${direction}`, [direction], 3 * 1000 / movementPhysics.dashDurationMs, 0);
  }
  make(`${NAME}-dying`, ["die", "dying", "death", "dead"], 10, 0);
  // Seraph (special.js): the rise, then the held draw in each aim direction
  // with its wings fluttering (scripts/art/sparrow-pixel/seraph.cjs).
  for (const { frame, logical } of SERAPH_DIRECTIONS) {
    make(`${NAME}-${logical}`, [], SERAPH_FLUTTER_FPS, -1, frameNames(frame, [0, 1, 2, 3]));
  }
  if (!scene.textures.exists(SERAPH_FX_KEY)) return;
  const fx = createAnimationBuilder(scene, SERAPH_FX_KEY);
  for (const [name, { count, rate, repeat }] of Object.entries(SERAPH_FX_ANIMS)) {
    fx.make(`${SERAPH_FX_KEY}-${name}`, [], rate, repeat, frameNames(name, Array.from({ length: count }, (_, i) => i)));
  }
}
