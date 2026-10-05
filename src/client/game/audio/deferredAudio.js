// Capture every preload's audio declaration (characters, maps, modes and shared
// effects). The visual loader alone controls scene creation and loading progress.
export function deferSceneAudio(scene) {
  const loader = scene.load;
  const originalAudio = loader.audio;
  const originalParallelDownloads = loader.maxParallelDownloads;
  const queued = [];
  loader.audio = function (...args) {
    queued.push(args);
    return this;
  };
  const sound = scene.sound;
  const originalPlay = sound.play;
  // Phaser throws for missing audio. Skip early/failed one-shots without queuing
  // stale combat sounds, and automatically enable them once cached.
  sound.play = function (key, ...args) {
    if (!scene.cache.audio.exists(key)) return false;
    return originalPlay.call(this, key, ...args);
  };
  let timer;
  const start = () => {
    loader.audio = originalAudio;
    // Yield scene creation before starting audio work.
    timer = setTimeout(() => {
      loader.maxParallelDownloads = 2;
      for (const args of queued) originalAudio.apply(loader, args);
      queued.length = 0;
      loader.start();
    }, 0);
  };
  const cleanup = () => {
    clearTimeout(timer);
    queued.length = 0;
    loader.audio = originalAudio;
    loader.maxParallelDownloads = originalParallelDownloads;
    sound.play = originalPlay;
    scene.events.off('shutdown', cleanup);
    scene.events.off('destroy', cleanup);
    scene.events.off('create', start);
  };
  scene.events.once('create', start);
  scene.events.once('shutdown', cleanup);
  scene.events.once('destroy', cleanup);
}
