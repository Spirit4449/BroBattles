import { markOneShotAnimation, resolveSpriteAnimationKey } from '../shared/animationState';

export function presentSwarmRelease(scene, player, releaseMs, remote = false) {
  if (!player?.active) return;
  const key = resolveSpriteAnimationKey({scene, sprite:player, character:'ninja', logical:'special', fallback:'throw'});
  if (key) {
    const dedicated = key.endsWith('-special');
    // A barrage spans many releases. Advance its row continuously instead of
    // restarting eight frames for every projectile. Legacy skins keep throwing.
    player.anims.play(dedicated
      ? {key, frameRate:30, repeat:-1}
      : {key, duration:Math.max(1, releaseMs), repeat:0}, dedicated);
    markOneShotAnimation(player, dedicated ? 'special' : 'throw', releaseMs, {remote});
  }
  scene.sound?.play('shurikenThrow', {volume:remote ? 0.22 : 0.34, rate:1.28});
}
