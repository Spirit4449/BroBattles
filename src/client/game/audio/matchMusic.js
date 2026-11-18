import { getNavigation } from "../../lib/globals.cjs";
import { bindMusicEnvelope } from "../../lib/musicEnvelope";

// Sudden-death audio uses the scene's envelope to fade the map track.
export function installMatchMusic(scene, { src, volume, isLive }) {
  let audio;
  let envelope;
  let waitingForInput = false;
  scene._bgmStarted = false;

  function stopWaiting() {
    waitingForInput = false;
    scene.sound.off("unlocked", start);
    scene.input.off("pointerdown", start);
    scene.input.keyboard?.off("keydown", start);
  }

  function pause() { audio?.pause(); }
  function resume() { audio?.play()?.catch(() => {}); }

  function start() {
    stopWaiting();
    if (scene._bgmStarted) return;
    if (!audio) {
      audio = new Audio(src);
      audio.preload = "auto";
      audio.loop = true;
      envelope = bindMusicEnvelope(audio, volume, 0);
      audio.addEventListener("playing", () => {
        envelope.fade(scene._bgmIntensity ?? (isLive() ? 1 : 0.3), 1200);
      }, { once: true });
      scene._bgmEl = audio;
      scene._bgmEnvelope = envelope;
      scene._bgmSrc = src;
    }
    scene._bgmStarted = true;
    Promise.resolve(audio.play()).then(() => {
      if (scene._bgmEl === audio) getNavigation()?.lobbyAudio?.handoff();
    }).catch(() => { scene._bgmStarted = false; });
  }

  scene._startMainBgm = () => {
    if (scene._bgmStarted || waitingForInput) return;
    if (!scene.sound.locked) return start();
    waitingForInput = true;
    scene.sound.once("unlocked", start);
    scene.input.once("pointerdown", start);
    scene.input.keyboard?.once("keydown", start);
  };
  scene.events.on("pause", pause);
  scene.events.on("resume", resume);
  scene.events.once("shutdown", () => {
    stopWaiting();
    scene.events.off("pause", pause);
    scene.events.off("resume", resume);
    pause();
    envelope?.dispose();
    scene._bgmEl = scene._bgmEnvelope = scene._bgmSrc = null;
  });
  if (isLive()) scene._startMainBgm();
}
