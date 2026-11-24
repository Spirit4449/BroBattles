import { characterDefinitions } from "../../../../shared/characters/index.js";
import { createAnimationBuilder } from '../shared/animationBuilder';
import movementPhysics from '../../../../shared/physics/movementPhysics.json';

const { key: NAME } = characterDefinitions.draven;

// Frames are drawn in code (scripts/art/draven-pixel/); rates match those scripts.
export function animations(scene) {
  const { make } = createAnimationBuilder(scene, NAME);

  // Try reasonable prefix variants for robustness across atlases
  make(`${NAME}-running`, ["running", "run"], 18, 0);
  make(`${NAME}-idle`, ["idle", "stand", "idle_"], 6, -1);
  make(`${NAME}-jumping`, ["jumping", "jump"], 15, 0);
  // The wall slide's staff flame keeps flickering while he slides.
  make(`${NAME}-sliding`, ["wall", "slide", "sliding"], 6, -1);
  // The fall loops slowly: hem, hand and staff bob together.
  make(`${NAME}-falling`, ["falling", "fall"], 5, -1);
  make(`${NAME}-throw`, ["throw", "attack", "attack_throw"], 16, 0);
  make(`${NAME}-special`, ["special", "ultimate", "ult"], 12, -1);
  make(`${NAME}-dying`, ["dying", "death", "dead"], 10, 0);
  // Three-frame directional dashes timed to the shared dash, then held.
  for (const direction of ["dashright", "dashdiagonal", "dashup", "dashdowndiagonal", "dashdown"]) {
    make(`${NAME}-${direction}`, [direction], 3 * 1000 / movementPhysics.dashDurationMs, 0);
  }
}
