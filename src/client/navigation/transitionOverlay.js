// Retain the decoded transition artwork for the lifetime of navigation, outside
// page scopes and speculative asset warming. Start before either page boots.
const transitionArtwork = window.Image ? new window.Image() : null;
let transitionArtworkReady = !transitionArtwork;
let transitionArtworkFailed = false;
let transitionArtworkPromise;
function prepareTransitionArtwork() {
  if (transitionArtworkReady || transitionArtworkPromise) return transitionArtworkPromise;
  transitionArtworkPromise = new Promise(resolve => {
    let settled = false;
    const finish = ready => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      transitionArtwork.onload = transitionArtwork.onerror = null;
      transitionArtworkReady = ready;
      if (!ready) transitionArtworkFailed = true;
      resolve(ready);
    };
    // A failed image must not trap players on the outgoing screen forever.
    const timeout = setTimeout(() => finish(false), 12000);
    transitionArtwork.fetchPriority = 'high';
    transitionArtwork.onload = () => {
      if (transitionArtwork.decode) transitionArtwork.decode().then(() => finish(true), () => finish(false));
      else finish(true);
    };
    transitionArtwork.onerror = () => finish(false);
    transitionArtwork.src = '/assets/loadingscreen.webp';
  }).then(ready => {
    if (!ready) transitionArtworkPromise = null;
    return ready;
  });
  return transitionArtworkPromise;
}
prepareTransitionArtwork();
// Only the first attempt holds the outgoing screen. After a failure the image
// retries in the background so a broken asset cannot stall every transition.
function awaitTransitionArtwork() {
  if (transitionArtworkReady) return null;
  const pending = prepareTransitionArtwork();
  return transitionArtworkFailed ? null : pending;
}

const transitionMinimumMs = 1000;

const lobbyReturnMinimumMs = 300;

const transitionFadeMs = 120;

export function createTransitionOverlay({ onRetry }) {
  let transition;

  let transitionShownAt = 0;

  let transitionEntrance = Promise.resolve();

  let transitionExitTimer;

  let transitionExitAnimation;

  let transitionPresentation = 0;

  function cancelTransitionExit() {
    ++transitionPresentation;
    clearTimeout(transitionExitTimer);
    transitionExitAnimation?.cancel();
    transitionExitAnimation = null;
  }

  function beginTransitionPresentation() {
    cancelTransitionExit();
    transitionShownAt = Date.now();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const entrance = !reducedMotion && transition.animate?.(
      [{ opacity: 0 }, { opacity: 1 }], { duration: transitionFadeMs, easing: 'ease-out' });
    transitionEntrance = entrance ? entrance.finished.catch(() => {}) : Promise.resolve();
  }

  function dismissTransition() {
    if (!transition) return;
    cancelTransitionExit();
    const panel = transition;
    const presentation = transitionPresentation;
    const minimumMs = panel.dataset.lobbyReturn === 'true'
      ? lobbyReturnMinimumMs : transitionMinimumMs;
    transitionExitTimer = setTimeout(async () => {
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      transitionExitAnimation = !reducedMotion && panel.animate?.(
        [{ opacity: 1 }, { opacity: 0 }], { duration: transitionFadeMs, easing: 'ease-in', fill: 'forwards' });
      if (transitionExitAnimation) await transitionExitAnimation.finished.catch(() => {});
      if (presentation !== transitionPresentation || panel !== transition) return;
      panel.remove();
      transition = null;
      transitionExitAnimation = null;
    }, Math.max(240, minimumMs - (Date.now() - transitionShownAt)));
  }

  let routeProgress = 0;

  function showTransition(message) {
    cancelTransitionExit();
    if (!transition) {
      transition = document.createElement('div');
      transition.id = 'bb-route-transition';
      transition.setAttribute('role', 'status');
      transition.setAttribute('aria-live', 'polite');
      document.body.append(transition);
      beginTransitionPresentation();
    }

    if (transition.dataset.presentation !== 'message') {
      transition.replaceChildren();
      const panel = document.createElement('div');
      panel.className = 'bb-loading-panel';
      const label = document.createElement('p');
      label.id = 'bb-route-message';
      const retry = document.createElement('button');
      retry.textContent = 'Try again';
      retry.className = 'bb-loading-retry';
      retry.type = 'button';
      retry.hidden = true;
      retry.onclick = onRetry;
      panel.append(label, retry);
      transition.append(panel);
      transition.dataset.presentation = 'message';
    }
    transition.querySelector('p').textContent = message;
    transition.querySelector('button').hidden = true;
    transition.hidden = false;
    transition.style.display = 'grid';
  }

  function updateRouteLoadingBar(progress, message) {
    if (transition?.dataset.presentation !== 'loading-bar') return;
    const pct = Math.max(routeProgress, Math.round(Math.max(0, Math.min(100, Number(progress) || 0))));
    routeProgress = pct;
    const fill = transition.querySelector('#bb-route-loading-fill');
    const percent = transition.querySelector('#bb-route-loading-percent');
    const label = transition.querySelector('#bb-route-loading-text');
    if (fill) fill.style.width = `${pct}%`;
    if (percent) percent.textContent = `${pct}%`;
    if (message) label.textContent = message;
  }

  function showLoadingBar(labelText) {
    cancelTransitionExit();
    if (!transition) {
      transition = document.createElement('div');
      transition.id = 'bb-route-transition';
      transition.setAttribute('role', 'status');
      transition.setAttribute('aria-live', 'polite');
      document.body.append(transition);
      beginTransitionPresentation();
    }

    if (transition.dataset.presentation !== 'loading-bar') {
      routeProgress = 0;
      transition.replaceChildren();
      const wrap = document.createElement('div');
      wrap.id = 'bb-route-loading-wrap';
      // Keep this geometry identical to game.html's loading wrap. The route
      // overlay remains in place until the game reports ready, so players never
      // see a centered message jump down into a second loading indicator.

      const label = document.createElement('p');
      label.id = 'bb-route-loading-text';
      label.textContent = labelText;

      const shell = document.createElement('div');
      shell.className = 'loading-shell';

      const fill = document.createElement('div');
      fill.id = 'bb-route-loading-fill';
      fill.className = 'loading-fill';

      const percent = document.createElement('span');
      percent.id = 'bb-route-loading-percent';
      percent.textContent = '0%';
      percent.setAttribute('aria-hidden', 'true');

      shell.append(fill, percent);
      wrap.append(label, shell);
      transition.append(wrap);
      transition.dataset.presentation = 'loading-bar';
    }
    updateRouteLoadingBar(8, labelText);
    transition.hidden = false;
    transition.style.display = 'block';
  }

  function showLobbyLoadingBar() {
    showLoadingBar('Loading lobby…');
  }

  function showBattleLoadingBar() {
    showLoadingBar('Preparing your battle…');
  }

  return {
    awaitTransitionArtwork,
    showTransition,
    showLobbyLoadingBar,
    showBattleLoadingBar,
    updateRouteLoadingBar,
    cancelTransitionExit,
    dismissTransition,
    getNode: () => transition,
    getEntrance: () => transitionEntrance,
    getProgress: () => routeProgress,
  };
}
