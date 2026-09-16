import { markOneShotAnimation, resolveSpriteAnimationKey } from '../shared/animationState';

export function presentSwarmRelease(scene, player, releaseMs, remote = false) {
  if (!player?.active) return;
  const key = resolveSpriteAnimationKey({scene, sprite:player, character:'ninja', logical:'throw', fallback:'idle'});
  if (key) {
    // Per-play duration fits one complete throw into each release interval.
    // Do not change the shared animation's normal attack speed.
    player.anims.play({key, duration:Math.max(1, releaseMs), repeat:0}, false);
    markOneShotAnimation(player, 'throw', releaseMs, {remote});
  }
  scene.sound?.play('shurikenThrow', {volume:remote ? 0.22 : 0.34, rate:1.28});
}
