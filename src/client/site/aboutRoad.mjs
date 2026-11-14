// Trophy Road: while the section is pinned, scrolling moves along the road,
// the rail fills and each milestone unlocks as the fill reaches it.
export function initializeAboutRoad(root = document.querySelector('[data-trophy-road]')) {
  if (!root) return;
  const frame = root.querySelector('.about-road-sticky');
  const viewport = root.querySelector('.about-road-viewport');
  const track = root.querySelector('[data-road-track]');
  const fill = root.querySelector('[data-road-fill]');
  const steps = [...root.querySelectorAll('[data-road-step]')];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let overflow = 0, pinned = false, frameHeight = 0, raf = 0, started = false;

  function measure() {
    overflow = Math.max(0, track.scrollWidth - viewport.clientWidth);
    frameHeight = frame.offsetHeight;
    // Pin only when the road is wider than the screen and motion is welcome.
    pinned = !reduced && overflow > 0;
    root.classList.toggle('is-pinned', pinned);
    // Pin it centred in the space under the site header, not jammed against it.
    const header = document.querySelector('.site-header')?.offsetHeight || 64;
    root.style.setProperty('--road-top', `${Math.round(Math.max(header + 16, header + (innerHeight - header - frameHeight) / 2))}px`);
    root.style.height = pinned ? `${frameHeight + overflow + innerHeight * 0.35}px` : '';
    update();
  }
  function progress() {
    const rect = root.getBoundingClientRect();
    if (pinned) {
      // Heading and road stick under the site header; progress runs across the extra height.
      const top = parseFloat(getComputedStyle(frame).top) || 0;
      return Math.min(1, Math.max(0, (top - rect.top) / Math.max(1, root.offsetHeight - frameHeight)));
    }
    // Unpinned: fill as the section crosses the middle of the screen.
    return Math.min(1, Math.max(0, (innerHeight * 0.85 - rect.top) / (rect.height + innerHeight * 0.3)));
  }
  function update() {
    raf = 0;
    const p = reduced ? 1 : progress();
    track.style.transform = pinned ? `translateX(${-overflow * p}px)` : '';
    // The rail fills to where the screen has travelled, plus a lead so the
    // milestone in view unlocks before it scrolls past.
    const visibleEdge = (pinned ? overflow * p : 0) + viewport.clientWidth * (pinned ? 0.62 : p);
    fill.style.width = `${Math.min(track.scrollWidth, visibleEdge)}px`;
    for (const step of steps) {
      const on = step.offsetLeft + step.offsetWidth / 2 <= visibleEdge;
      if (on === step.classList.contains('is-unlocked')) continue;
      step.classList.toggle('is-unlocked', on);
      if (on && !reduced && started) claim(step);
    }
    started = true;
  }
  // The lobby's claim moment: the card bursts and pixel sparks fly off it.
  function claim(step) {
    const card = step.querySelector('.about-road-card');
    card.classList.remove('is-claiming'); void card.offsetWidth; card.classList.add('is-claiming');
    const tone = step.classList.contains('is-major') ? 'gold' : step.querySelector('.reward-currency img')?.src.includes('gems') ? 'blue' : 'gold';
    for (let i = 0; i < 14; i++) {
      const spark = document.createElement('span');
      spark.className = `about-road-spark tone-${tone}`;
      spark.style.setProperty('--dx', `${Math.round((Math.random() * 2 - 1) * 80)}px`);
      spark.style.setProperty('--dy', `${Math.round(-16 - Math.random() * 80)}px`);
      spark.style.setProperty('--delay', `${Math.round(Math.random() * 120)}ms`);
      card.append(spark);
      setTimeout(() => spark.remove(), 800);
    }
  }
  const queue = () => { if (!raf) raf = requestAnimationFrame(update); };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', measure);
  new ResizeObserver(measure).observe(viewport);
  measure();
}
