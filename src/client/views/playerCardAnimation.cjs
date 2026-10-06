const catalog = require('../../shared/catalogs/playerCardsCatalog.json');
const { assetUrl } = require('../../shared/site/html.cjs');

function resolveCard(card) {
  return typeof card === 'string' ? catalog.cards.find(entry => entry.id === card) : card;
}

function playerCardImage(card, { animate = true, reducedMotion = false } = {}) {
  const entry = resolveCard(card);
  const poster = assetUrl(entry?.assetUrl);
  return animate && !reducedMotion && entry?.animationUrl
    ? assetUrl(entry.animationUrl, poster) : poster;
}

function prefersStillCards() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

let standaloneLoader;
const mediaControls = new WeakMap();
const mountedMedia = new Set();
let removalObserver;
const alphaChecks = new Map();

// Codec support does not guarantee alpha support. Probe decoded pixels before
// attaching a source to visible media, so an opaque green frame never flashes.
function verifyPlayerCardAlpha(url) {
  if (alphaChecks.has(url)) return alphaChecks.get(url);
  const promise = new Promise(resolve => {
    const probe = document.createElement('video');
    probe.muted = true;
    probe.playsInline = true;
    probe.preload = 'auto';
    const finish = value => {
      clearTimeout(timer);
      probe.onloadeddata = probe.onerror = null;
      probe.pause(); probe.removeAttribute('src'); probe.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), 5000);
    probe.onerror = () => finish(false);
    probe.onloadeddata = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(probe, 0, 0, 1, 1, 0, 0, 1, 1);
        finish(context.getImageData(0, 0, 1, 1).data[3] < 16);
      } catch (_) { finish(false); }
    };
    probe.src = url;
    probe.load();
  });
  alphaChecks.set(url, promise);
  return promise;
}

function selectPlayerCardVideo(card) {
  const entry = resolveCard(card);
  // Apple platforms have HEVC alpha decoding; WebM alpha is not implied by
  // canPlayType('video/webm'). Every selected source is also pixel-probed.
  const apple = typeof navigator !== 'undefined' && /Apple/.test(navigator.vendor || '');
  if (apple && entry?.animationAppleUrl && document.createElement('video').canPlayType('video/mp4; codecs="hvc1"')) {
    return { ...entry, animationUrl: entry.animationAppleUrl, animationBytes: entry.animationAppleBytes };
  }
  return entry;
}

function getCardLoader() {
  if (window.__BB_NAVIGATION__?.requestCardAnimation) return window.__BB_NAVIGATION__;
  if (!standaloneLoader) {
    standaloneLoader = require('../navigation/preload.js').createBattlePreloader();
    const start = () => standaloneLoader.start('cards');
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  }
  return standaloneLoader;
}

function warmEquippedPlayerCard(card) {
  getCardLoader().warmPlayerCard(selectPlayerCardVideo(card || catalog.defaultCardId));
}

function createPlayerCardMedia(card, { hover = false, interactive = false, prepare = false, verifyAlpha = verifyPlayerCardAlpha } = {}) {
  const entry = selectPlayerCardVideo(card);
  const poster = playerCardImage(entry, { animate: false });
  const animated = playerCardImage(entry);
  const video = /\.(webm|mov)$/.test(animated);
  const media = document.createElement(video ? 'video' : 'img');
  media.setAttribute('aria-label', entry?.name || 'Player card');
  if (!video) {
    media.src = poster;
    media.alt = entry?.name || 'Player card';
    return media;
  }
  media.poster = poster;
  media.muted = true;
  media.loop = true;
  media.playsInline = true;
  media.preload = 'none';
  // Never assign the remote video URL to the element. Only completed, shared
  // downloads become blob URLs, so the media decoder cannot bypass the queue.
  let active = !hover;
  let visible = !window.IntersectionObserver;
  let disposed = false;
  let failed = false;
  let release;
  let requestInteractive = false;
  let readyUrl;
  let observer;
  let unregisterScope;
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let frameCallback;
  let frameGeneration = 0;
  const resetFrame = () => {
    frameGeneration++;
    if (frameCallback != null) media.cancelVideoFrameCallback?.(frameCallback);
    frameCallback = null;
    state.showVideo?.(false);
  };
  const awaitFrame = () => {
    if (frameCallback != null) return;
    const generation = frameGeneration;
    const reveal = () => {
      frameCallback = null;
      if (generation !== frameGeneration || disposed || failed || !active || !visible || document.hidden || motion?.matches || media.paused) return;
      state.showVideo?.(true);
    };
    if (media.requestVideoFrameCallback) frameCallback = media.requestVideoFrameCallback(reveal);
    else if (media.readyState >= 2 && media.currentTime > 0) reveal();
  };
  const stop = () => {
    release?.();
    release = null;
    resetFrame();
    media.pause();
    // Keep the decoder loaded between preview plays; teardown only on disposal/error.
    if ((disposed || failed) && media.getAttribute('src')) { media.removeAttribute('src'); media.load(); }
  };
  const play = () => {
    if (disposed || failed || !active || !visible || !media.isConnected || document.hidden || motion?.matches) return;
    prepare = false;
    if (media.getAttribute('src') !== readyUrl) media.src = readyUrl;
    awaitFrame();
    media.play()?.catch(() => resetFrame()); // Keep the independent poster on autoplay rejection.
  };
  const update = () => {
    if (disposed) return;
    if (document.hidden || motion?.matches || failed) { stop(); return; }
    if (!prepare && ((!active && !hover) || !visible || !media.isConnected)) { stop(); return; }
    if (readyUrl) {
      if (!active) stop(); else play();
      return;
    }
    const wantsInteractive = active && (interactive || hover);
    if (release && (!wantsInteractive || requestInteractive)) return;
    // Upgrade an already queued tile when the user hovers it. Subscribe first
    // so removing the speculative listener cannot abort the shared download.
    const previousRelease = release;
    requestInteractive = wantsInteractive;
    release = getCardLoader().requestCardAnimation(entry, async url => {
      const transparent = await verifyAlpha(url);
      if (disposed || readyUrl === url) return;
      if (!transparent) {
        failed = true;
        media.dataset.animationState = 'unsupported';
        stop();
        return;
      }
      readyUrl = url;
      // Prepare the actual playback element before mounting the battle overlay.
      media.preload = 'auto';
      media.src = url;
      media.load();
      media.dataset.animationState = 'ready';
      play();
    }, { interactive: wantsInteractive });
    previousRelease?.();
  };
  const state = {
    media, seen: false,
    restart() {
      if (disposed || failed) return;
      resetFrame();
      media.pause();
      media.currentTime = 0;
      update();
    },
    setActive(value) { active = value; update(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      observer?.disconnect();
      state.disposePresentation?.();
      state.disposeLayers?.();
      document.removeEventListener('visibilitychange', update);
      motion?.removeEventListener?.('change', update);
      unregisterScope?.();
      mountedMedia.delete(state);
      if (!mountedMedia.size) { removalObserver?.disconnect(); removalObserver = null; }
    },
    update,
  };
  mediaControls.set(media, state);
  mountedMedia.add(state);
  if (!removalObserver && window.MutationObserver) {
    removalObserver = new window.MutationObserver(() => {
      for (const item of mountedMedia) {
        if (item.media.isConnected) {
          item.seen = true;
          if (!window.IntersectionObserver) item.update();
        } else if (item.seen) item.dispose();
      }
    });
    removalObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (window.IntersectionObserver) {
    observer = new window.IntersectionObserver(entries => {
      visible = entries.some(item => item.isIntersecting);
      if (media.isConnected) state.seen = true;
      update();
    });
    observer.observe(media);
  }
  document.addEventListener('visibilitychange', update);
  motion?.addEventListener?.('change', update);
  media.addEventListener('playing', awaitFrame);
  media.addEventListener('timeupdate', () => { if (!media.requestVideoFrameCallback) awaitFrame(); });
  media.addEventListener('waiting', resetFrame);
  media.addEventListener('emptied', resetFrame);
  media.addEventListener('error', () => { failed = true; stop(); }, { once: true });
  unregisterScope = window.__BB_PAGE_SCOPE__?.onDispose(state.dispose);
  if (prepare) update();
  return media;
}

function restartPlayerCardMedia(media) {
  mediaControls.get(media)?.restart();
}

function disposePlayerCardMedia(media) {
  mediaControls.get(media)?.dispose();
}

// A native video poster may disappear before Safari paints its decoded frame.
// Keep an independent image mounted until the compositor receives a video frame.
function layerPlayerCardMedia(media) {
  const controls = mediaControls.get(media);
  if (!controls) return media;
  const layers = document.createElement('span');
  layers.className = 'player-card-layers';
  Object.assign(layers.style, { position: 'relative', display: 'block', width: '100%', height: '100%' });
  const still = document.createElement('img');
  still.src = media.poster;
  still.alt = '';
  still.setAttribute('aria-hidden', 'true');
  still.className = 'player-card-still';
  for (const element of [still, media]) Object.assign(element.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    maxWidth: 'none', maxHeight: 'none', objectFit: 'fill', aspectRatio: 'auto',
    padding: '0', margin: '0', filter: 'none', pointerEvents: 'none',
  });
  media.style.opacity = '0';
  still.style.opacity = '1';
  let fadeTimer;
  let showing = false;
  controls.showVideo = ready => {
    if (ready === showing) return;
    showing = ready;
    clearTimeout(fadeTimer);
    // Restore the still before clearing/hiding a video, without a reverse fade.
    still.style.opacity = '1';
    media.style.transition = ready ? 'opacity 140ms linear' : 'none';
    media.style.opacity = ready ? '1' : '0';
    if (ready) fadeTimer = setTimeout(() => { still.style.opacity = '0'; }, 160);
  };
  controls.disposeLayers = () => clearTimeout(fadeTimer);
  layers.append(still, media);
  return layers;
}

// Give padded animation canvases the same logical layout box as static cards.
// The effect canvas can overflow; only the card rectangle determines its scale.
function presentPlayerCardMedia(media, card, { containEffects = false } = {}) {
  const entry = resolveCard(card);
  const view = entry?.animationViewport;
  const renderScale = entry?.renderScale || 1;
  if (!view) {
    const layers = layerPlayerCardMedia(media);
    if (renderScale !== 1) Object.assign(layers.style, { transform: `scale(${renderScale})`, transformOrigin: 'center' });
    return layers;
  }
  const box = document.createElement('span');
  box.className = 'player-card-canvas';
  Object.assign(box.style, { position: 'relative', display: 'block', width: '100%', aspectRatio: '650 / 1250', overflow: 'visible' });
  const layers = layerPlayerCardMedia(media);
  box.append(layers);
  const layout = ([entry]) => {
    // Layout dimensions exclude ancestor transforms. Measuring the screen rect
    // during a reveal's entrance scale would permanently shrink/offset the art;
    // transforms do not trigger another ResizeObserver notification.
    const bounds = entry.contentRect;
    // Scrollable previews reserve the whole effect canvas inside their box.
    // Other presentations center the logical card and let effects overflow.
    const width = containEffects ? view.width : view.w;
    const height = containEffects ? view.height : view.h;
    const scale = Math.min(bounds.width / width, bounds.height / height) * renderScale;
    Object.assign(layers.style, {
      position: 'absolute', maxWidth: 'none', maxHeight: 'none',
      width: `${view.width * scale}px`, height: `${view.height * scale}px`,
      left: `${(bounds.width - width * scale) / 2 - (containEffects ? 0 : view.x * scale)}px`,
      top: `${(bounds.height - height * scale) / 2 - (containEffects ? 0 : view.y * scale)}px`,
      objectFit: 'fill', aspectRatio: 'auto', pointerEvents: 'none', filter: 'none',
    });
  };
  const observer = new window.ResizeObserver(layout);
  observer.observe(box);
  const controls = mediaControls.get(media);
  if (controls) controls.disposePresentation = () => observer.disconnect();
  return box;
}

function hydratePlayerCardMedia(root, options) {
  root.querySelectorAll('[data-animated-card-id]').forEach(image => {
    const media = createPlayerCardMedia(image.dataset.animatedCardId, options);
    const presentation = presentPlayerCardMedia(media, image.dataset.animatedCardId);
    presentation.className += ` ${image.className}`;
    image.replaceWith(presentation);
  });
}

// The layout box describes the card, while the image includes the full effect canvas.
function positionPlayerCardCanvas(image, card, { battle = false } = {}) {
  const entry = resolveCard(card);
  if (battle && entry?.battleViewport) {
    const view = entry.battleViewport;
    const box = catalog.renderGuides.fullCardSizePx;
    // One scale for both axes preserves the source artwork's proportions.
    // All frames shrink by 10%; Shuriken Strike keeps a smaller 5% reduction.
    const scale = Math.min(box.w / view.w, box.h / view.h) * (entry.id === 'shuriken-strike' ? 0.95 : 0.9);
    Object.assign(image.style, {
      position: 'absolute', maxWidth: 'none', maxHeight: 'none',
      width: `${100 * view.width * scale / box.w}%`,
      height: `${100 * view.height * scale / box.h}%`,
      left: `${100 * ((box.w - view.w * scale) / 2 - view.x * scale) / box.w}%`,
      top: `${100 * ((box.h - view.h * scale) / 2 - view.y * scale) / box.h}%`,
      objectFit: 'fill', pointerEvents: 'none',
    });
    return;
  }
  const view = (battle && entry?.battleViewport) || entry?.animationViewport;
  const scale = battle ? 1 : entry?.renderScale || 1;
  if (!view) {
    if (scale !== 1) Object.assign(image.style, { transform: `scale(${scale})`, transformOrigin: 'center' });
    return;
  }
  Object.assign(image.style, {
    position: 'absolute', maxWidth: 'none', maxHeight: 'none',
    width: `${100 * view.width / view.w * scale}%`, height: `${100 * view.height / view.h * scale}%`,
    left: `${50 * (1 - scale) - 100 * view.x / view.w * scale}%`, top: `${50 * (1 - scale) - 100 * view.y / view.h * scale}%`,
    objectFit: 'fill', pointerEvents: 'none',
  });
}

function bindPlayerCardHover(tile, image, card) {
  if (!image || !card?.animationUrl) return;
  let started = false;
  let failed = false;
  const start = () => {
    if (started || failed) return;
    started = true;
    if (image.tagName === 'VIDEO') {
      mediaControls.get(image)?.setActive(true);
    } else {
      image.src = playerCardImage(card, { reducedMotion: prefersStillCards() });
    }
  };
  // Hover/focus starts a loop for this tile's lifetime. Visibility and page
  // disposal still pause/release video through the shared media controller.
  tile.addEventListener('mouseenter', start);
  tile.addEventListener('focusin', start);
  image.addEventListener('error', () => {
    failed = true;
    if (image.tagName !== 'VIDEO') image.src = playerCardImage(card, { animate: false });
  });
}

module.exports = { restartPlayerCardMedia, disposePlayerCardMedia, layerPlayerCardMedia, presentPlayerCardMedia, playerCardImage, prefersStillCards, bindPlayerCardHover, positionPlayerCardCanvas, createPlayerCardMedia, hydratePlayerCardMedia, warmEquippedPlayerCard, verifyPlayerCardAlpha, selectPlayerCardVideo };
