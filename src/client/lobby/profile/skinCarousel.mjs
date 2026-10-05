const carousels = new WeakMap();

// Sample a shared circular path so both portraits revolve around the same axis.
function orbitFrames(direction, incoming, radius) {
  return Array.from({ length: 25 }, (_, index) => {
    const progress = index / 24;
    const angle = (incoming ? 1 - progress : -progress) * direction * 72;
    const radians = angle * Math.PI / 180;
    const distance = Math.abs(angle) / 72;
    return {
      offset: progress,
      transform: `translate3d(${Math.sin(radians) * radius}px, 0, ${(Math.cos(radians) - 1) * radius}px) rotateY(${angle * 0.55}deg)`,
      opacity: 1 - distance ** 3,
    };
  });
}

export function disposeSkinCarousel(stage) {
  const state = carousels.get(stage);
  if (!state) return;
  state.disposed = true;
  state.animations.forEach(animation => animation.cancel());
  state.incoming?.remove();
  stage.classList.remove('is-skin-revolving');
  carousels.delete(stage);
}

export function switchSkinPreview(stage, { src, alt, direction = 1 }) {
  if (!stage) return;
  let state = carousels.get(stage);
  if (!state) {
    state = { animations: [], pending: null, running: false, disposed: false };
    carousels.set(stage, state);
  }
  // Saving a selection also refreshes its label; don't restart that transition.
  if (state.target === src) return;
  state.target = src;
  state.pending = { src, alt, direction: direction < 0 ? -1 : 1 };
  if (!state.running) void revolve(stage, state);
}

async function revolve(stage, state) {
  state.running = true;
  try {
    while (state.pending && !state.disposed && stage.isConnected) {
      const request = state.pending;
      state.pending = null;
      const outgoing = stage.querySelector('.character-details-preview-image');
      if (!outgoing) break;
      if (outgoing.getAttribute('src') === request.src) {
        outgoing.alt = request.alt;
        continue;
      }
      const incoming = outgoing.cloneNode(false);
      incoming.src = request.src;
      incoming.alt = request.alt;
      // Keep the previous skin visible until the next image can actually paint.
      try { await incoming.decode(); } catch {
        if (!incoming.naturalWidth) {
          if (state.target === request.src) state.target = null;
          continue;
        }
      }
      if (state.disposed || !stage.isConnected) break;
      if (state.pending) continue;
      if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !incoming.animate) {
        outgoing.replaceWith(incoming);
        continue;
      }
      state.incoming = incoming;
      stage.appendChild(incoming);
      stage.classList.add('is-skin-revolving');
      const radius = Math.min(stage.clientWidth * 0.7, 260);
      const options = { duration: 560, easing: 'cubic-bezier(0.22, 0.65, 0.25, 1)', fill: 'both' };
      state.animations = [
        outgoing.animate(orbitFrames(request.direction, false, radius), options),
        incoming.animate(orbitFrames(request.direction, true, radius), options),
      ];
      // Finish the current orbit before consuming the latest rapid-click target.
      await Promise.all(state.animations.map(animation => animation.finished.catch(() => {})));
      if (state.disposed) break;
      outgoing.replaceWith(incoming);
      state.animations.forEach(animation => animation.cancel());
      state.animations = [];
      state.incoming = null;
      stage.classList.remove('is-skin-revolving');
    }
  } finally {
    state.running = false;
  }
}
