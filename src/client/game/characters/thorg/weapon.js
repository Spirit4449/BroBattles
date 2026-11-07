import { THORG_SWEEP, thorgAttackFrameAt } from "../../../../shared/characters/thorgSweep";
import { playSpriteAnimation, markOneShotAnimation } from "../shared/animationState";
import { lockPlayerFlip, enforceLockedFlip } from "../shared/flipLock";
import { playerSoundVolume } from "../../audio/playerAudio";
import { inHitstop } from "../shared/shotPrediction";

// The video frames already contain the complete attack and mace. Drive their
// poses from the combat clock; the sweep effect is baked into the atlas.
export function startThorgSweep(scene, body, { direction = body.flipX ? -1 : 1 } = {}) {
  body._thorgAttackCleanup?.();
  body.flipX = direction < 0;
  const unlock = lockPlayerFlip(body);
  const duration = THORG_SWEEP.windupMs + THORG_SWEEP.strikeMs + THORG_SWEEP.recoveryMs;
  body._thorgSweepActive = true;
  playSpriteAnimation({ scene, sprite: body, character: 'thorg', logical: 'throw', fallback: 'idle', restart: true });
  markOneShotAnimation(body, 'throw', duration);
  body.anims?.pause?.();
  body.setFrame('throw00');
  let elapsed = 0;
  let finished = false;
  let sound;
  try {
    sound = scene.sound?.add(scene.cache?.audio?.exists('thorg-sweep') ? 'thorg-sweep' : 'thorg-throw');
    const volume = playerSoundVolume(scene, body, 0.48);
    if (volume > 0) sound?.play({ volume });
  } catch (_) {}
  const cleanup = () => {
    if (finished) return;
    finished = true;
    scene.events.off('update', update);
    scene.events.off('presentation:reset', cleanup);
    scene.events.off('shutdown', cleanup);
    body.off?.('destroy', cleanup);
    sound?.stop();
    sound?.destroy();
    body._thorgSweepActive = false;
    delete body._thorgAttackCleanup;
    unlock();
    if (body.anims) { body.anims.timeScale = 1; body.anims.resume?.(); }
  };
  const update = (_time, delta) => {
    if (!body.active || !String(body.frame?.name).startsWith('throw')) { cleanup(); return; }
    if (!inHitstop(body)) elapsed += Number(delta) || scene.game?.loop?.delta || 16;
    enforceLockedFlip(body);
    body.setFrame(thorgAttackFrameAt(elapsed).frame);
    if (elapsed >= duration) {
      cleanup();
      playSpriteAnimation({ scene, sprite: body, character: 'thorg', logical: 'idle' });
    }
  };
  body._thorgAttackCleanup = cleanup;
  scene.events.on('update', update);
  scene.events.once('presentation:reset', cleanup);
  scene.events.once('shutdown', cleanup);
  body.once?.('destroy', cleanup);
  return body;
}
