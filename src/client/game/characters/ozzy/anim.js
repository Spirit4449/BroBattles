import { characterDefinitions } from "../../../../shared/characters/index.js";
import { createAnimationBuilder } from '../shared/animationBuilder';
import movementPhysics from '../../../../shared/physics/movementPhysics.json';
import { ozzyThrowFrameMs } from '../../../../shared/characters/ozzyCharge.js';
import { getResolvedCharacterSpecialConfig } from '../../../../shared/characters/characterTuning.js';
import { STRIKE_FRAME } from './pocketAceShot';
import { DIRECTIONS } from './aimPoses';

const { key: NAME } = characterDefinitions.ozzy;
const CAST_MS = getResolvedCharacterSpecialConfig(NAME, "arcaneSurge").castMs || 2000;
// Art from scripts/art/ozzy-pixel/actions-video.cjs: the super's cast plays at
// the rate it was picked for, then its flames loop at the clip's own speed.
const CAST_FPS = 14;
const SURGE_FPS = 12;

export function animations(scene, textureKey = NAME) {
  if (!scene?.textures?.exists(textureKey)) return;
  const { make: ensureAnim, findFrames } = createAnimationBuilder(scene, textureKey);

  // Each frame shown for its own duration (Phaser adds a frame's duration to
  // 1000 / frameRate, so the base rate is kept tiny).
  const BASE_MS = 10;
  const timed = (key, frames, ms) => scene.anims.create({
    key, frameRate: 1000 / BASE_MS, repeat: 0,
    frames: frames.map((frame, i) => ({ key: textureKey, frame, duration: ms[i] - BASE_MS })),
  });
  // Wind-up frames fill the cast delay; the blast and follow-through end as
  // the turn lock lifts (ozzyThrowFrameMs). The level throw is `attack`; aimed
  // throws are its variants (aimPoses.js), timed the same.
  const ensureThrows = () => {
    for (const { key, frame } of DIRECTIONS) {
      const anim = key ? `${textureKey}-throw-${key}` : `${textureKey}-throw`;
      if (scene.anims.exists(anim)) continue;
      const frames = findFrames(key ? [frame] : ["attack", "throw"]);
      if (frames.length) timed(anim, frames, ozzyThrowFrameMs(frames.length, pocketAce ? STRIKE_FRAME : undefined));
    }
  };
  // The super: the cast (staff swing, flash, the staff catching fire, the
  // flames bursting up), then the engulfing flames loop until the cast ends.
  const ensureSpecialAnim = () => {
    if (scene.anims.exists(`${textureKey}-special`)) return;
    const cast = findFrames(["special"]);
    const surge = findFrames(["surge"]);
    if (!cast.length) return;
    if (pocketAce) {
      timed(`${textureKey}-special`, cast, cast.map(() => CAST_MS / cast.length));
      return;
    }
    const frames = [...cast]; const ms = cast.map(() => 1000 / CAST_FPS);
    for (let at = ms.reduce((a, b) => a + b, 0), i = 0; surge.length && at < CAST_MS; i++, at += 1000 / SURGE_FPS) {
      frames.push(surge[i % surge.length]); ms.push(1000 / SURGE_FPS);
    }
    timed(`${textureKey}-special`, frames, ms);
  };

  const pocketAce = textureKey === 'ozzy__ozzy-pocket-ace';
  // Every other frame of a 24 fps breathing clip (scripts/art/ozzy-pixel/idle-video.cjs).
  ensureAnim(`${textureKey}-idle`, ["idle", "stand"], textureKey === NAME ? 12 : 1000 / 60, -1);
  // One stride of a 24 fps clip, every other frame (scripts/art/ozzy-pixel/run-video.cjs).
  ensureAnim(`${textureKey}-running`, ["run", "walk", "move"], pocketAce ? 1000 / 15 : 26, -1);
  ensureAnim(`${textureKey}-jumping`, ["jump"], pocketAce ? 64 : 8, 0);
  // The fall loops the clip's float, every third frame of 24 fps.
  ensureAnim(`${textureKey}-falling`, ["fall"], pocketAce ? 64 : 8, pocketAce ? 0 : -1);
  ensureAnim(`${textureKey}-sliding`, ["sing", "slide", "sliding"], pocketAce ? 20 : 10, -1);
  ensureThrows();
  ensureSpecialAnim();
  ensureAnim(`${textureKey}-dying`, ["dying", "death", "die"], 10, 0);
  // Three-frame directional dashes timed to the shared dash, then held
  // (scripts/art/ozzy-pixel/actions-video.cjs; dashup from actions.cjs).
  for (const direction of ["dashright", "dashdiagonal", "dashup"]) {
    ensureAnim(`${textureKey}-${direction}`, [direction], 3 * 1000 / movementPhysics.dashDurationMs, 0);
  }
  // Jump frames run take-off to apex, so they are scrubbed by vertical speed
  // rather than played on a timer.
  const jumping = scene.anims.get?.(`${textureKey}-jumping`);
  if (pocketAce) {
    // Finish the knee drive promptly, then hold the apex until descent.
    const running = scene.anims.get?.(`${textureKey}-running`);
    if (running) running.bbMotion = { kind: 'running', speed: movementPhysics.maxSpeed };
    const falling = scene.anims.get?.(`${textureKey}-falling`);
    if (falling) falling.bbMotion = { kind: 'falling', speed: movementPhysics.gravity * movementPhysics.fallGravityFactor * 0.25 };
    return;
  }
  if (textureKey !== NAME) {
    const falling = scene.anims.get?.(`${textureKey}-falling`);
    if (falling) falling.bbMotion = { kind: 'falling', speed: movementPhysics.jumpSpeed };
  }
  if (jumping) jumping.bbMotion = { kind: 'jumping', speed: movementPhysics.jumpSpeed };
}
