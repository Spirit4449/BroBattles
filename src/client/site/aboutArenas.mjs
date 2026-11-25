// Two identical lists share one native scroll area. Wrapping by a list width
// keeps the seam invisible and leaves touch, trackpad and keyboard scrolling native.
export function initializeAboutArenas(root = document.querySelector('.about-arenas')) {
  if (!root) return;
  const viewport = root.querySelector('.about-arena-window');
  const list = viewport.querySelector('ul');
  const toggle = root.querySelector('[data-arena-toggle]');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hover = window.matchMedia('(hover: hover)');
  let visible = false, paused = false, interacting = false, raf = 0, last = 0, remainder = 0;
  let span = list.offsetWidth;

  function advance(now) {
    const travel = remainder + Math.min(now - (last || now), 64) * 0.033;
    const pixels = Math.floor(travel);
    remainder = travel - pixels;
    last = now;
    if (pixels && span) viewport.scrollLeft = (viewport.scrollLeft + pixels) % span;
    raf = requestAnimationFrame(advance);
  }
  function sync() {
    cancelAnimationFrame(raf);
    last = 0;
    const loop = !motion.matches && span >= viewport.clientWidth;
    root.classList.toggle('is-looping', loop);
    toggle.hidden = !loop;
    if (loop && visible && !paused && !interacting && !document.hidden && !(hover.matches && viewport.matches(':hover')) && !viewport.matches(':focus-visible')) {
      raf = requestAnimationFrame(advance);
    }
  }
  toggle.addEventListener('click', () => {
    paused = !paused;
    toggle.setAttribute('aria-label', paused ? 'Resume arena scrolling' : 'Pause arena scrolling');
    toggle.classList.toggle('is-paused', paused);
    sync();
  });
  for (const event of ['pointerenter', 'pointerleave', 'focus', 'blur']) viewport.addEventListener(event, sync);
  viewport.addEventListener('touchstart', () => { interacting = true; sync(); }, { passive: true });
  for (const event of ['touchend', 'touchcancel']) viewport.addEventListener(event, () => { interacting = false; sync(); });
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }).observe(viewport);
  new ResizeObserver(() => { span = list.offsetWidth; sync(); }).observe(viewport);
  motion.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
}
