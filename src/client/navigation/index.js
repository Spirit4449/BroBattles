import { BROWSER_EVENTS } from "../lib/browserEvents.js";
import { BROWSER_GLOBALS } from "../lib/globals.cjs";
import { createRouteRecovery } from "./routeRecovery.js";
import { createRouteStyles, ensureRouteLoaderFont } from "./routeStyles.js";
import { createTransitionOverlay } from "./transitionOverlay.js";
import { createRoutePrefetch, fetchRoute, gameRoutePattern, prefetchGameData, supported } from "./routePrefetch.js";
import { executeScript } from "./scriptRunner.js";
import { createPageScope } from './pageScope';
import { createBattlePreloader } from './preload';
import { createLobbyReturnController } from './lobbyReturn';
import { createLobbyAudio } from './lobbyAudio.mjs';
import { getSettings, subscribeSettings } from '../site/preferences';

let currentScope;
let sequence = 0;
const presentation = createTransitionOverlay({ onRetry: () => recovery.retryFailedRoute() });
const {
  awaitTransitionArtwork, showTransition, showLobbyLoadingBar, showBattleLoadingBar,
  updateRouteLoadingBar, cancelTransitionExit, dismissTransition,
} = presentation;
let audioContext;
let pendingFetch;
let cleanupPromise = Promise.resolve();
let retiredScope;
function retireCurrentPage() {
  const outgoing = currentScope;
  if (outgoing && outgoing !== retiredScope) {
    retiredScope = outgoing;
    cleanupPromise = cleanupPromise.then(() => outgoing.dispose());
  }
  return cleanupPromise;
}

let mounted = true;
let lobbyNavigator;
const preloader = createBattlePreloader();
const lobbyReturn = createLobbyReturnController({ navigate, getRouteVersion: () => sequence, getScopeId: () => currentScope?.id, onStatusReady: () => updateRouteLoadingBar(25) });
const routeRequests = createRoutePrefetch({ getTicket: () => sequence });
const { prefetchRoute, takeRoutePrefetch, discardRoutePrefetch, consumeGameData, handOffGameData } = routeRequests;
function markRoute(phase) {
  window.performance?.mark?.(`bb:route:${sequence}:${phase}`);
}

const { clearRouteHints, preloadRouteScripts, createStyleSwap } = createRouteStyles();
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
const lobbyAudio = createLobbyAudio({ getAudioContext, readSettings: getSettings });
subscribeSettings(() => lobbyAudio.refresh());
document.addEventListener('visibilitychange', () => lobbyAudio.setHidden(document.hidden));
function unlockAudio() { getAudioContext()?.resume().catch(() => {}); lobbyAudio.unlock(); }
document.addEventListener('pointerdown', unlockAudio, { passive: true });
document.addEventListener('keydown', unlockAudio);

function ready() {
  if (!mounted || recovery.isFailed()) return;
  clearReadinessTimer();
  updateRouteLoadingBar(100);
  dismissTransition();
  clearRouteHints();
  markRoute('ready');
  if (document.body.dataset.bbScreen === 'lobby') {
    lobbyAudio.enterLobby();
    preloader.start('battle');
  } else preloader.start('cards');
}
const recovery = createRouteRecovery({
  getTicket: () => sequence,
  presentation,
  navigate,
  prepareLobbyReturn,
  onFailure() {
    lobbyAudio.handoff();
    mounted = false;
    ++sequence;
    pendingFetch?.abort();
    discardRoutePrefetch();
    handOffGameData(null);
    lobbyReturn.clear();
    clearRouteHints();
    preloader.stop();
  },
});
const { fail, armReadinessTimer, clearReadinessTimer } = recovery;

document.addEventListener(BROWSER_EVENTS.LOBBY_REVEALED, ready);
document.addEventListener(BROWSER_EVENTS.BATTLE_REVEALED, ready);
// A join request is also an interactive, finished lobby screen.
document.addEventListener(BROWSER_EVENTS.LOBBY_JOIN_REQUEST, ready);

async function navigate(target, { replace = false, pop = false, lobbyReturnStatus = null, gameData = null } = {}) {
  lobbyReturn.clear();
  clearRouteHints();
  const url = new URL(target, location.href);
  if (!supported(url)) {
    if (replace) location.replace(url.href); else location.assign(url.href);
    return;
  }
  const ticket = ++sequence;
  recovery.resetForNavigation();
  cancelTransitionExit();
  const styles = createStyleSwap(ticket);
  markRoute('start');
  mounted = false;
  // A download already in flight finishes into the HTTP cache for the next screen.
  preloader.stop({ finishActive: true });
  pendingFetch?.abort();
  const controller = new AbortController();
  pendingFetch = controller;
  const inLobby = document.body.dataset.bbScreen === 'lobby' && !!lobbyNavigator;
  const returningToLobby = document.body.dataset.bbScreen === 'game' && !url.pathname.startsWith('/game/');
  const prefetched = takeRoutePrefetch(url.href, controller.signal);
  // Request the page (and a battle's match data) before waiting on artwork,
  // so the network overlaps the transition.
  const pageRequest = fetchRoute(url.href, controller.signal, returningToLobby, prefetched?.page);
  pageRequest.catch(() => {});
  const gameMatch = url.pathname.match(gameRoutePattern);
  if (gameMatch) {
    handOffGameData(gameMatch[1], ticket, gameData || prefetched?.gameData || prefetchGameData(gameMatch[1], controller.signal));
  } else handOffGameData(null);
  // Leave the outgoing screen intact until the transition image is decoded.
  const artwork = !inLobby && awaitTransitionArtwork();
  if (artwork) {
    await artwork;
    if (ticket !== sequence) return;
  }
  // Keep the interactive lobby visible during a party request.
  if (returningToLobby) {
    showLobbyLoadingBar();
    presentation.getNode().dataset.destination = url.href;
    presentation.getNode().dataset.lobbyReturn = 'true';
    retireCurrentPage();
  } else if (url.pathname.startsWith('/game/')) {
    lobbyAudio.loading();
    showBattleLoadingBar();
    presentation.getNode().dataset.destination = url.href;
    presentation.getNode().dataset.lobbyReturn = 'false';
  } else if (!inLobby) {
    showTransition('Loading lobby…');
    presentation.getNode().dataset.destination = url.href;
    presentation.getNode().dataset.lobbyReturn = 'false';
  }
  armReadinessTimer(ticket);
  try {
    const response = await pageRequest;
    if (ticket !== sequence) return;
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
    retireCurrentPage();
    const cleanup = cleanupPromise.then(() => { if (ticket === sequence) markRoute('cleanup'); });
    const scripts = [...html.querySelectorAll('script')];
    scripts.forEach(script => script.remove());
    const styleLoads = styles.prepare(html.head);
    await Promise.all([...styleLoads, cleanup, presentation.getEntrance()]);
    if (ticket !== sequence) { styles.discard(); return; }
    markRoute('styles');
    updateRouteLoadingBar(loadingLobby ? 70 : 35);
    // Keep the actual html/body nodes: the fullscreen element stays attached.
    if (!pop) history[replace ? 'replaceState' : 'pushState']({}, '', finalUrl.href);
    else if (finalUrl.href !== location.href) history.replaceState({}, '', finalUrl.href);
    document.title = html.title;
    for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
    for (const attribute of [...html.body.attributes]) document.body.setAttribute(attribute.name, attribute.value);
    styles.commit();
    document.body.replaceChildren(...html.body.childNodes, ...(presentation.getNode() ? [presentation.getNode()] : []));
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
    for (const [index, script] of scripts.entries()) {
      if (ticket !== sequence) return;
      await executeScript(script, currentScope);
      if (ticket !== sequence) return;
      updateRouteLoadingBar(loadingLobby ? 70 + 18 * (index + 1) / scripts.length : 35 + 13 * (index + 1) / scripts.length);
    }
    if (ticket === sequence) markRoute('scripts');
    if (!html.body.dataset.bbScreen && ticket === sequence) ready();
  } catch (error) {
    styles.discard();
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
  if (!presentation.getNode() || !mounted) return;
  if (presentation.getNode().dataset.presentation === 'loading-bar') {
    const previous = presentation.getProgress();
    updateRouteLoadingBar(Math.min(99, Number(percent) || 0), message);
    if (presentation.getProgress() > previous) recovery.refreshReadinessTimer();
    return;
  }
  // Late asset callbacks must not overwrite a failure and its retry action.
}
async function prepareLobbyReturn(fallbackPartyId) {
  const routeVersion = sequence;
  preloader.stop({ finishActive: true });
  const partyId = Number(fallbackPartyId);
  const hasParty = Number.isFinite(partyId) && partyId > 0;
  const destination = new URL(hasParty ? `/party/${partyId}` : '/', location.href).href;
  // The match party is usually still current: load its page alongside /status.
  if (hasParty) prefetchRoute(destination);
  const returning = lobbyReturn.prepare(fallbackPartyId);
  const artwork = awaitTransitionArtwork();
  if (artwork) await artwork;
  // A fast /status may already have started the lobby route, which shows its own loader.
  if (routeVersion !== sequence) return returning;
  mounted = false;
  showLobbyLoadingBar();
  presentation.getNode().dataset.destination = destination;
  presentation.getNode().dataset.lobbyReturn = 'true';
  if (document.body.dataset.bbScreen === 'game') retireCurrentPage();
  return returning;
}

window[BROWSER_GLOBALS.navigation] = {
  lobbyAudio,
  setLobbyNavigator(fn) { lobbyNavigator = fn; }, scope, scriptScope, navigate, getAudioContext,
  preload: preloader.enqueue, selectPreloadMode: preloader.selectMode,
  requestCardAnimation: preloader.requestCardAnimation,
  warmPlayerCard: preloader.warmPlayerCard,
  warmRosterCards: preloader.warmRosterCards,
  holdGameplayDownloads: preloader.holdGameplay,
  warmLobby() { preloader.start('lobby'); },
  prefetchRoute,
  consumeGameData,
  prepareLobbyReturn,
  async beginBattleLoading() {
    preloader.stop({ finishActive: true });
    const ticket = sequence;
    const artwork = awaitTransitionArtwork();
    if (artwork) await artwork;
    if (ticket !== sequence) return;
    if (!presentation.getNode()) showBattleLoadingBar();
    await presentation.getEntrance();
  },
  consumeLobbyReturnStatus: lobbyReturn.consume,
  fail, progress,
};
