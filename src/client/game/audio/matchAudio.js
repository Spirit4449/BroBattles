// Match-level music cues: sudden-death loop and result stings.
import { bindAudio } from "../../site/preferences";
import { getUISoundSources } from "../../ui/uiSounds.js";

const resultVolumes = { win: 0.23, lose: 0.21, draw: 0.28 };
const rewardSounds = {
  shopReveal: 1,
  rewardCoinImpact: 8,
  rewardGemImpact: 8,
  shopCurrencyImpact: 16,
  streakIncrease: 1,
  streakLost: 1,
  streakDingCoin: 3,
  streakDingGem: 3,
};

export function preloadMatchRewardSounds(scene) {
  for (const [name, instances] of Object.entries(rewardSounds)) {
    scene.load.audio(name, getUISoundSources(name), { instances });
  }
}

// These timed cues use the same unlocked audio context and volume as combat.
export function playMatchRewardSound(scene, key, volume, rate = 1) {
  if (document.hidden || !scene?.sys.isActive() || !scene.sound || scene.sound.locked ||
      !scene.cache.audio.exists(key)) return;
  const playing = scene.sound.getAllPlaying().filter(sound => sound.key === key);
  if (playing.length >= rewardSounds[key]) playing[0]?.destroy();
  scene.sound.play(key, { volume, rate });
}

export function startSuddenDeathMusic(gameScene) {
  if (document.hidden || !gameScene || !gameScene.sound) return;
  try {
    try {
      gameScene._bgmEl?.pause();
    } catch (_) {}
    if (!gameScene._suddenDeathMusicSfx) {
      const track = new Audio('/assets/game-sounds/suddendeath.mp3');
      track.loop = true;
      const disposeVolume = bindAudio(track, 'music', 0.10);
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

export function playMatchEndSound(gameScene, winnerTeam, yourTeam, { skipSting = false } = {}) {
  if (document.hidden || !gameScene || !gameScene.sound) return;
  const key =
    winnerTeam == null || winnerTeam === "draw"
      ? "draw"
      : winnerTeam === yourTeam
        ? "win"
        : "lose";
  const trigger = () => {
    try {
      gameScene._bgmEl?.pause();
    } catch (_) {}
    if (skipSting) return;
    try {
      gameScene.sound.play(key, { volume: resultVolumes[key] });
    } catch (_) {}
  };
  if (gameScene.sound.locked) {
    gameScene.sound.once("unlocked", trigger);
    return;
  }
  trigger();
}
