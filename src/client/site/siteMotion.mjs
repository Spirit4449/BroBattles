// Small, purposeful motion for public pages: sections settle in as they
// scroll into view, and looping cosmetic videos only play while visible.
// Nothing is hidden unless this script runs, and reduced motion opts out.
export function initializeSiteMotion() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!('IntersectionObserver' in window)) return;
  const selector = '.about-section, .about-crew, .site-news-grid > *, .site-help-card, .site-more';
  // Only the outermost match moves, so a card never animates inside a moving section.
  const reveal = [...document.querySelectorAll(selector)].filter(node => !node.parentElement.closest(selector));
  if (!reduced && reveal.length) {
    // Measure before turning motion on: anything already on screen was painted
    // at load, so it is marked shown first and never animates (hiding then
    // re-showing it is what made cards float in twice).
    const below = reveal.filter(node => node.getBoundingClientRect().top >= innerHeight);
    for (const node of reveal) if (!below.includes(node)) node.classList.add('is-revealed');
    for (const node of below) node.classList.add('site-reveal');
    if (below.length) document.documentElement.classList.add('site-motion');
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        // Anything above it was scrolled past, so reveal that too.
        for (const node of reveal.slice(0, reveal.indexOf(entry.target) + 1)) {
          node.classList.add('is-revealed');
          observer.unobserve(node);
        }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    for (const node of below) observer.observe(node);
  }
  const videos = [...document.querySelectorAll('video[data-autoplay-visible]')];
  if (reduced || !videos.length) return;
  const players = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting) target.play().catch(() => {});
      else target.pause();
    }
  }, { threshold: 0.3 });
  for (const video of videos) players.observe(video);
}
