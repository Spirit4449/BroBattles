// Only the public About page uses video; no game engine or socket is loaded.
export const ABOUT_CLIPS = [
  { key: 'duel', format: '01 / Duels · 2v2', title: 'The opening push' },
  { key: 'crossfire', format: '02 / Duels · 2v2', title: 'The knockout finish' },
];

export function initializeAboutReel(root = document.querySelector('[data-about-reel]')) {
  if (!root) return;
  const video = root.querySelector('video');
  const toggle = root.querySelector('[data-reel-toggle]');
  const progress = root.querySelector('[data-reel-progress]');
  const status = root.querySelector('[data-reel-status]');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection;
  let index = 0, inView = false, wantsPlay = !motion.matches && !connection?.saveData;
  let failed = false, disposed = false;

  function renderToggle() {
    const playing = wantsPlay && !failed;
    toggle.textContent = playing ? 'Ⅱ Pause' : '▶ Play highlights';
    toggle.setAttribute('aria-label', playing ? 'Pause gameplay highlights' : 'Play gameplay highlights');
  }
  function select(next, play = wantsPlay) {
    index = next;
    const clip = ABOUT_CLIPS[index];
    video.pause();
    video.poster = `/assets/site/gameplay/${clip.key}.jpg`;
    progress.style.width = '0%';
    failed = false; status.hidden = true;
    // No source is attached for motion/data-saving visitors until they play.
    video.removeAttribute('src');
    if (play) video.src = `/assets/site/gameplay/${clip.key}.mp4`;
    wantsPlay = play;
    sync();
  }
  function sync() {
    if (disposed) return;
    renderToggle();
    if (!wantsPlay || !inView || document.hidden || failed) { video.pause(); return; }
    if (!video.getAttribute('src')) video.src = `/assets/site/gameplay/${ABOUT_CLIPS[index].key}.mp4`;
    video.muted = true;
    video.play().catch(() => {
      if (disposed || video.paused === false || !inView || document.hidden) return;
      wantsPlay = false; renderToggle();
    });
  }
  toggle.addEventListener('click', () => {
    if (failed) { select(index, true); return; }
    wantsPlay = !wantsPlay; sync();
  });
  video.addEventListener('ended', () => { if (wantsPlay) select((index + 1) % ABOUT_CLIPS.length); });
  video.addEventListener('timeupdate', () => { progress.style.width = `${video.duration ? Math.min(100, video.currentTime / video.duration * 100) : 0}%`; });
  video.addEventListener('error', () => {
    // A missing or unsupported clip keeps its poster and exposes a retry.
    failed = true; video.pause(); renderToggle();
    status.hidden = false; status.textContent = 'The highlight couldn’t load. Press play to retry.';
  });
  const visibility = () => sync();
  const preference = () => { if (motion.matches || connection?.saveData) { wantsPlay = false; sync(); } };
  document.addEventListener('visibilitychange', visibility);
  motion.addEventListener('change', preference);
  connection?.addEventListener?.('change', preference);
  const observer = new IntersectionObserver(entries => { inView = entries[0].isIntersecting; sync(); }, { threshold: .15 });
  observer.observe(root);
  const dispose = () => {
    disposed = true; observer.disconnect(); video.pause(); video.removeAttribute('src'); video.load();
    document.removeEventListener('visibilitychange', visibility);
    motion.removeEventListener('change', preference);
    connection?.removeEventListener?.('change', preference);
  };
  // A restored back/forward-cache page retains the same controls and decoder.
  window.addEventListener('pagehide', () => video.pause());
  window.addEventListener('pageshow', sync);
  window.__BB_PAGE_SCOPE__?.onDispose(dispose);
  // Visibility observation initiates autoplay, avoiding an offscreen download.
  renderToggle();
}
