// Match-level music cues: sudden-death loop and the win/lose sting.
import { bindAudio } from "../../site/preferences";

export function startSuddenDeathMusic(gameScene) {
  if (document.hidden || !gameScene || !gameScene.sound) return;
  try {
    try {
      gameScene._bgmEl?.pause();
    } catch (_) {}
    if (!gameScene._suddenDeathMusicSfx) {
      const track = new Audio('/assets/suddendeath.mp3');
      track.loop = true;
      const disposeVolume = bindAudio(track, 'music', 0.32);
      gameScene._suddenDeathMusicSfx = {
        get isPlaying() { return !track.paused; },
        play() { track.play().catch(() => {}); },
        stop() { track.pause(); track.currentTime = 0; },
        pause() { track.pause(); },
        destroy() { track.pause(); disposeVolume(); },
      };
      gameScene.events.once('shutdown', () => gameScene?._suddenDeathMusicSfx?.destroy());
    }
    if (!gameScene._suddenDeathMusicSfx.isPlaying) {
      gameScene._suddenDeathMusicSfx.play();
    }
  } catch (_) {}
}

export function stopSuddenDeathMusic(gameScene) {
  if (!gameScene || !gameScene._suddenDeathMusicSfx) return;
  try {
    if (gameScene._suddenDeathMusicSfx.isPlaying) {
      gameScene._suddenDeathMusicSfx.stop();
    }
  } catch (_) {}
}

export function playMatchEndSound(gameScene, winnerTeam, yourTeam) {
  if (document.hidden || !gameScene || !gameScene.sound) return;
  const key =
    winnerTeam == null
      ? null
      : winnerTeam === yourTeam
        ? "win"
        : "lose";
  if (!key) return;
  const trigger = () => {
    try {
      gameScene._bgmEl?.pause();
    } catch (_) {}
    try {
      gameScene.sound.play(key, {
        volume: key === "win" ? 0.55 : 0.48,
      });
    } catch (_) {}
  };
  if (gameScene.sound.locked) {
    gameScene.sound.once("unlocked", trigger);
    return;
  }
  trigger();
}
