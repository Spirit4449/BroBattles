import { characterDefinitions } from "../../../../shared/characters/index.js";
import { markOneShotAnimation, resolveSpriteAnimationKey } from '../shared/animationState';
import { aimVariant } from '../shared/aimPose';
import settings from '../../../../../public/assets/ninja/animation-settings.json';
import { beginSwarm, swarmThrowSound, swarmSpark, swarmGlint, swarmImpact, swarmShardEnded, createSwarmAura } from './swarmFx';

const { key: NAME } = characterDefinitions.ninja;

// The super's body clip, aimed: `ninja-special-<direction>` (scripts/art/
// ninja-pixel/frames.cjs) nearest the aim, like his basic throw.
function swarmClip(scene, player, angle) {
  const key = resolveSpriteAnimationKey({scene, sprite:player, character:NAME, logical:'special', fallback:'throw'});
  const variant = aimVariant(angle, settings.throw?.directions);
  return variant && key && scene.anims?.exists?.(`${key}-${variant}`) ? `${key}-${variant}` : key;
}

// How long a clip runs: each frame's base interval plus its own hold.
function clipMs(scene, key, fallback) {
  const anim = scene.anims?.get?.(key);
  if (!anim?.frames?.length) return fallback;
  return anim.frames.reduce((sum, frame) => sum + anim.msPerFrame + (frame.duration || 0), 0);
}

// One release of the barrage. The first starts the swarm's flow (swarmFx.js)
// and plays the aimed flurry once through; every release has its own throw sound.
// `release` is the shuriken's start point and the super's aim angle.
export function presentSwarmRelease(scene, player, releaseMs, remote = false, release = null) {
  if (!player?.active) return;
  const now = performance.now();
  const key = swarmClip(scene, player, release?.angle);
  if (key) {
    const dedicated = /-special(-|$)/.test(key);
    const texture = player._bbSkinTextureKey || player.texture?.key;
    if (!dedicated) {
      // Skins without a super clip throw once per release.
      player.anims.play({key, duration:Math.max(1, releaseMs), repeat:0}, false);
      markOneShotAnimation(player, 'throw', releaseMs, {remote});
    } else if (texture && texture !== NAME) {
      // Other skins' own super rows loop for as long as the barrage lasts.
      player.anims.play({key, frameRate:30, repeat:-1}, true);
      markOneShotAnimation(player, 'special', releaseMs, {remote});
    } else if (!(player._ninjaSwarmClipUntil > now)) {
      const ms = clipMs(scene, key, releaseMs);
      player.anims.play(key, false);
      markOneShotAnimation(player, 'special', ms, {remote});
      player._ninjaSwarmClipUntil = now + ms;
    }
  }
  if (beginSwarm(scene, player, release?.angle) && release) swarmSpark(scene, release.x, release.y, player);
  swarmThrowSound(scene, player);
}

export const presentSwarmTurn = swarmGlint;
export const presentSwarmImpact = swarmImpact;
export const presentSwarmShardEnd = swarmShardEnded;
export const createSwarmShardAura = createSwarmAura;
