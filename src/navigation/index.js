import { createPageScope } from './pageScope';
import { createBattlePreloader, getTemplateResources } from './preload';
import { createLobbyReturnController } from './lobbyReturn';

// Retain the decoded transition artwork for the lifetime of navigation, outside
// page scopes and speculative asset warming. Start before either page boots.
const transitionArtwork = window.Image ? new window.Image() : null;
let transitionArtworkReady = !transitionArtwork;
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

const bindings = 'window,document,location,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame,cancelAnimationFrame,fetch,Audio,ResizeObserver,MutationObserver,IntersectionObserver';
const supported = url => url.origin === location.origin && /^(\/$|\/party\/[^/]+\/?$|\/game\/[^/]+\/?$)/.test(url.pathname);
let currentScope;
let sequence = 0;
let transition;
let transitionShownAt = 0;
let transitionEntrance = Promise.resolve();
let transitionExitTimer;
let transitionExitAnimation;
let transitionPresentation = 0;
const transitionMinimumMs = 1000;
const lobbyReturnMinimumMs = 300;
const transitionFadeMs = 120;
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
let readinessTimer;
let audioContext;
let pendingFetch;
let cleanupPromise = Promise.resolve();
let mounted = true;
let lobbyNavigator;
let routeProgress = 0;
const preloader = createBattlePreloader();
const lobbyReturn = createLobbyReturnController({ navigate, getRouteVersion: () => sequence, getScopeId: () => currentScope?.id, onStatusReady: () => updateRouteLoadingBar(25) });
let routeHints = [];
const styleLoadsByNode = new WeakMap();
const styleOwners = new WeakMap();
function clearRouteHints() {
  routeHints.forEach(link => link.remove());
  routeHints = [];
}
function preloadRouteScripts(html) {
  for (const url of getTemplateResources(html).filter(url => /\.js(?:\?|$)/.test(url))) {
    if (url.includes('phaser-arcade-physics') && window.Phaser) continue;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'script';
    link.href = url;
    document.head.append(link);
    routeHints.push(link);
  }
}
function markRoute(phase) {
  window.performance?.mark?.(`bb:route:${sequence}:${phase}`);
}
const routeLoaderFontStyleId = 'bb-route-loader-font';

// Navigation is the one stylesheet that remains mounted while pages swap.
// Keep the loading font here as well, otherwise removing game.css can briefly
// make the route bar fall back to a system font before lobby.css has settled.
function ensureRouteLoaderFont() {
  if (!document.head?.append || document.getElementById?.(routeLoaderFontStyleId)) return;
  const style = document.createElement('style');
  style.id = routeLoaderFontStyleId;
  style.dataset.navigation = 'route-loader-font';
  style.textContent = '@font-face{font-family:"Press Start 2P";src:url("/assets/PressStart2P.woff2") format("woff2");font-display:block}';
  document.head.append(style);
  // Begin fetching before a player starts a route, so the loader never shows
  // a fallback font on the first game or lobby transition.
  document.fonts?.load?.('16px "Press Start 2P"').catch(() => {});
}

ensureRouteLoaderFont();

function scope() {
  if (!currentScope || !currentScope.active) currentScope = createPageScope(navigate);
  return currentScope;
}
function getAudioContext() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (Context && (!audioContext || audioContext.state === 'closed')) audioContext = new Context();
  return audioContext;
}
function unlockAudio() { getAudioContext()?.resume().catch(() => {}); }
document.addEventListener('pointerdown', unlockAudio, { passive: true });
document.addEventListener('keydown', unlockAudio);

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
    retry.onclick = () => navigate(transition.dataset.destination || location.href, { replace: true });
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
function ready() {
  if (!mounted) return;
  clearTimeout(readinessTimer);
  updateRouteLoadingBar(100);
  dismissTransition();
  clearRouteHints();
  markRoute('ready');
  if (document.body.dataset.bbScreen === 'lobby') preloader.start('battle');
}
function fail(error) {
  lobbyReturn.clear();
  clearRouteHints();
  preloader.stop();
  console.error('[navigation]', error);
  showTransition('Unable to finish loading. Please try again.');
  transition.querySelector('button').hidden = false;
}
document.addEventListener('lobby:ready', ready);
document.addEventListener('game:ready', ready);
// A join request is also an interactive, finished lobby screen.
document.addEventListener('lobby:join-request', ready);

function runInline(fn) {
  const owner = scope();
  fn(...bindings.split(',').map(key => owner[key]));
}
async function executeScript(source, owner) {
  if (!owner.active) return;
  // The edge may inject analytics into fetched HTML. The initial document has
  // already handled those scripts; replaying them on a route change can make a
  // browser extension's blocked beacon fail the entire navigation.
  if (source.src && new URL(source.src, location.href).origin !== location.origin) return;
  if (source.src && (/\/socket\.io\/socket\.io\.js/.test(source.src) || /\/bundles\/navigation[.]/.test(source.src))) return;
  if (source.src && /phaser-arcade-physics/.test(source.src) && window.Phaser) return;
  const script = document.createElement('script');
  if (source.src) {
    script.src = source.src;
    script.dataset.bbPageScope = owner.id;
    script.async = false;
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Unable to load ${source.src}`));
      document.body.append(script);
    });
  } else {
    // Inline templates use the same lexical lifetime as their entry bundle.
    script.textContent = source.textContent;
    document.body.append(script);
  }
  script.remove();
}
async function navigate(target, { replace = false, pop = false, lobbyReturnStatus = null } = {}) {
  lobbyReturn.clear();
  clearRouteHints();
  const url = new URL(target, location.href);
  if (!supported(url)) {
    if (replace) location.replace(url.href); else location.assign(url.href);
    return;
  }
  const ticket = ++sequence;
  cancelTransitionExit();
  const newStyles = [];
  const discardNewStyles = () => newStyles.forEach(node => {
    if (styleOwners.get(node) === ticket) node.remove();
  });
  markRoute('start');
  mounted = false;
  preloader.stop();
  pendingFetch?.abort();
  const controller = new AbortController();
  pendingFetch = controller;
  const inLobby = document.body.dataset.bbScreen === 'lobby' && !!lobbyNavigator;
  const returningToLobby = document.body.dataset.bbScreen === 'game' && !url.pathname.startsWith('/game/');
  // Leave the outgoing screen intact until the transition image is decoded.
  if (!inLobby && !transitionArtworkReady) {
    await prepareTransitionArtwork();
    if (ticket !== sequence) return;
  }
  // Keep the interactive lobby visible during a party request.
  if (returningToLobby) {
    showLobbyLoadingBar();
    transition.dataset.destination = url.href;
    transition.dataset.lobbyReturn = 'true';
  } else if (url.pathname.startsWith('/game/')) {
    showBattleLoadingBar();
    transition.dataset.destination = url.href;
    transition.dataset.lobbyReturn = 'false';
  } else if (!inLobby) {
    showTransition('Loading lobby…');
    transition.dataset.destination = url.href;
    transition.dataset.lobbyReturn = 'false';
  }
  clearTimeout(readinessTimer);
  readinessTimer = setTimeout(() => { if (ticket === sequence) fail(new Error('Screen readiness timed out')); }, 45000);
  try {
    const response = await fetch(url.href, { credentials: 'same-origin', signal: controller.signal });
    const finalUrl = new URL(response.url);
    if (!supported(finalUrl)) { lobbyReturn.clear(); location.assign(finalUrl.href); return; }
    if (!response.ok) throw new Error(`Page request failed (${response.status})`);
    const source = await response.text();
    const html = new DOMParser().parseFromString(source, 'text/html');
    if (ticket !== sequence) return;
    markRoute('document');
    const loadingLobby = html.body.dataset.bbScreen === 'lobby';
    updateRouteLoadingBar(loadingLobby ? 45 : 20);
    if (inLobby && html.body.dataset.bbScreen === 'lobby') {
      if (!pop) history[replace ? 'replaceState' : 'pushState']({}, '', finalUrl.href);
      else if (finalUrl.href !== location.href) history.replaceState({}, '', finalUrl.href);
      mounted = true;
      await lobbyNavigator(finalUrl, controller.signal);
      if (ticket === sequence) ready();
      return;
    }
    preloadRouteScripts(source);
    lobbyNavigator = null;
    const outgoing = currentScope;
    cleanupPromise = cleanupPromise.then(() => outgoing?.dispose());
    const cleanup = cleanupPromise.then(() => { if (ticket === sequence) markRoute('cleanup'); });
    const scripts = [...html.querySelectorAll('script')];
    scripts.forEach(script => script.remove());
    const oldStyles = [...document.head.querySelectorAll('link[rel="stylesheet"], style:not([data-navigation])')];
    const retained = new Set();
    const styleLoads = [];
    // Retain shared sheets without detaching them: moving a loaded <link>
    // can deactivate its CSS until the browser processes it again. Insert new
    // sheets around retained anchors so the destination cascade is still exact.
    const destinationStyles = [...html.head.querySelectorAll('link[rel="stylesheet"], style')];
    let previousStyleIndex = -1;
    const anchors = destinationStyles.map(node => {
      const index = oldStyles.findIndex((old, index) => index > previousStyleIndex &&
        node.tagName === old.tagName &&
        (node.tagName === 'LINK' ? node.href === old.href : node.textContent === old.textContent));
      if (index < 0) return null;
      previousStyleIndex = index;
      return oldStyles[index];
    });
    for (const [index, node] of destinationStyles.entries()) {
      const existing = anchors[index];
      if (existing) {
        retained.add(existing);
        styleOwners.set(existing, ticket);
        if (styleLoadsByNode.has(existing)) styleLoads.push(styleLoadsByNode.get(existing));
        continue;
      }
      const copy = node.cloneNode(true);
      styleOwners.set(copy, ticket);
      newStyles.push(copy);
      if (copy.tagName === 'LINK' && new URL(copy.href).origin === location.origin) {
        const loading = new Promise((resolve, reject) => {
          copy.onload = resolve;
          copy.onerror = () => {
            copy.remove();
            reject(new Error(`Unable to load ${copy.href}`));
          };
        });
        styleLoadsByNode.set(copy, loading);
        styleLoads.push(loading);
      }
      const nextAnchor = anchors.slice(index + 1).find(Boolean);
      if (nextAnchor) document.head.insertBefore(copy, nextAnchor);
      else document.head.append(copy);
    }
    for (const node of html.head.querySelectorAll('link[rel="preload"][as="font"]')) {
      if (![...document.head.querySelectorAll('link[rel="preload"]')].some(old => old.href === node.href)) {
        document.head.append(node.cloneNode(true));
      }
    }
    await Promise.all([...styleLoads, cleanup, transitionEntrance]);
    if (ticket !== sequence) { discardNewStyles(); return; }
    markRoute('styles');
    updateRouteLoadingBar(loadingLobby ? 70 : 35);
    // Keep the actual html/body nodes: the fullscreen element stays attached.
    if (!pop) history[replace ? 'replaceState' : 'pushState']({}, '', finalUrl.href);
    else if (finalUrl.href !== location.href) history.replaceState({}, '', finalUrl.href);
    document.title = html.title;
    for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
    for (const attribute of [...html.body.attributes]) document.body.setAttribute(attribute.name, attribute.value);
    oldStyles.filter(node => !retained.has(node)).forEach(node => node.remove());
    document.body.replaceChildren(...html.body.childNodes, ...(transition ? [transition] : []));
    // Keep the route loader above the incoming game template until game:ready.
    // Its position and styling match the template loader exactly, avoiding a
    // flash or vertical jump while the game bundle initializes.
    currentScope = createPageScope(navigate);
    if (html.body.dataset.bbScreen === 'lobby' && finalUrl.href === url.href) {
      lobbyReturn.bind(lobbyReturnStatus, ticket, currentScope.id);
    }
    mounted = true;
    // Each entry is deliberately a fresh runtime. Discard old lazy-chunk
    // registrations so they cannot retain a retired page's module closures.
    window.webpackChunkBroBattles = [];
    window.__BOOT_GAME__ = undefined;
    window.updateLoading = undefined;
    window.markMatchBackgroundReady = undefined;
    for (const [index, script] of scripts.entries()) {
      if (ticket !== sequence) return;
      await executeScript(script, currentScope);
      if (ticket !== sequence) return;
      updateRouteLoadingBar(loadingLobby ? 70 + 18 * (index + 1) / scripts.length : 35 + 13 * (index + 1) / scripts.length);
    }
    if (ticket === sequence) markRoute('scripts');
    if (!html.body.dataset.bbScreen && ticket === sequence) ready();
  } catch (error) {
    discardNewStyles();
    if (ticket === sequence && error.name !== 'AbortError') fail(error);
  }
}
document.addEventListener('click', event => {
  const link = event.target.closest?.('a[href]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || link.download || (link.target && link.target !== '_self')) return;
  const url = new URL(link.href);
  if (!supported(url) || (url.pathname === location.pathname && url.search === location.search && url.hash)) return;
  event.preventDefault();
  void navigate(url.href);
});
window.addEventListener('popstate', () => { if (supported(new URL(location.href))) void navigate(location.href, { pop: true }); });
function scriptScope() {
  const id = document.currentScript?.dataset.bbPageScope;
  if (id && (id !== currentScope?.id || !currentScope.active)) return null;
  return scope();
}
function progress(percent, message) {
  if (!transition || !mounted) return;
  if (transition.dataset.presentation === 'loading-bar') {
    updateRouteLoadingBar(Math.min(99, Number(percent) || 0), message);
    return;
  }
  // Late asset callbacks must not overwrite a failure and its retry action.
}
window.__BB_NAVIGATION__ = {
  setLobbyNavigator(fn) { lobbyNavigator = fn; }, scope, scriptScope, runInline, navigate, getAudioContext,
  preload: preloader.enqueue, selectPreloadMode: preloader.selectMode,
  warmLobby() { preloader.start('lobby'); },
  async prepareLobbyReturn(fallbackPartyId) {
    const routeVersion = sequence;
    preloader.stop();
    if (!transitionArtworkReady) {
      await prepareTransitionArtwork();
      if (routeVersion !== sequence) return;
    }
    mounted = false;
    showLobbyLoadingBar();
    transition.dataset.destination = location.href;
    transition.dataset.lobbyReturn = 'true';
    return lobbyReturn.prepare(fallbackPartyId);
  },
  async beginBattleLoading() {
    const ticket = sequence;
    if (!transitionArtworkReady) await prepareTransitionArtwork();
    if (ticket !== sequence) return;
    if (!transition) showBattleLoadingBar();
    await transitionEntrance;
  },
  consumeLobbyReturnStatus: lobbyReturn.consume,
  fail, progress,
};
