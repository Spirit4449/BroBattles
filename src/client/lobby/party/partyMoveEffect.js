// A short, feathered trail between shared seats, with drifting pixel sparks.
export function playPartyMoveEffect(from, to) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const start = { x: from.left + from.width / 2, y: from.top + from.height * .65 };
  const end = { x: to.left + to.width / 2, y: to.top + to.height * .65 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 8) return;
  const layer = document.createElement('div');
  layer.className = 'party-move-trail';
  layer.setAttribute('aria-hidden', 'true');
  const beam = document.createElement('div');
  beam.className = 'party-move-beam';
  Object.assign(beam.style, { left: `${start.x}px`, top: `${start.y}px`, width: `${distance}px`, rotate: `${Math.atan2(dy, dx)}rad` });
  layer.append(beam);
  for (let i = 0; i < 18; i++) {
    const pixel = document.createElement('i');
    pixel.className = 'party-move-pixel';
    const t = i / 18;
    const spread = Math.sin(i * 2.4) * 22;
    const size = 3 + i % 3 * 2;
    Object.assign(pixel.style, { left: `${start.x}px`, top: `${start.y}px`, width: `${size}px`, height: `${size}px` });
    layer.append(pixel);
    pixel.animate([
      { transform: `translate(${dx * t}px, ${dy * t}px) scale(.4)`, opacity: 0 },
      { transform: `translate(${dx * (t + .08)}px, ${dy * (t + .08) + spread}px) scale(1)`, opacity: .8, offset: .3 },
      { transform: `translate(${dx * Math.min(1, t + .2)}px, ${dy * Math.min(1, t + .2) + spread * 1.6}px) scale(.3)`, opacity: 0 },
    ], { duration: 520, delay: t * 130, fill: 'both', easing: 'ease-out' });
  }
  document.body.append(layer);
  beam.animate([{ opacity: 0, scale: '1 .3' }, { opacity: .6, scale: '1 1', offset: .2 }, { opacity: 0, scale: '1 1.5' }], { duration: 480, fill: 'both' });
  window.setTimeout(() => layer.remove(), 720);
}
