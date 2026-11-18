import { requestMatchData } from "./gameData.js";

export const supported = url => url.origin === location.origin && /^(\/$|\/party\/[^/]+\/?$|\/game\/[^/]+\/?$)/.test(url.pathname);

export const gameRoutePattern = /^\/game\/([^/]+)\/?$/;

const routePrefetchLifetimeMs = 15000;

export function prefetchGameData(matchId, signal) {
  const request = requestMatchData(matchId, { signal });
  // The user may leave before a prefetched promise is consumed.
  request.catch(() => {});
  return request;
}

// A prefetched response stands in for the first attempt, so retry timing and
// limits are unchanged when it fails.
export async function fetchRoute(url, signal, retryConnectionFailure, prefetched) {
  for (let attempt = 0; ; attempt++) {
    try {
      if (attempt === 0 && prefetched) return await prefetched;
      return await fetch(url, { credentials: 'same-origin', signal });
    } catch (error) {
      if (!retryConnectionFailure || attempt >= 2 || signal.aborted || error.name !== 'TypeError') throw error;
      // A brief server restart or connection drop should not strand a finished match.
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      if (signal.aborted) throw error;
    }
  }
}

export function createRoutePrefetch({ getTicket }) {
  let routePrefetch = null;

  function discardRoutePrefetch() {
    routePrefetch?.controller.abort();
    routePrefetch = null;
  }

  function prefetchRoute(target) {
    const url = new URL(target, location.href);
    if (!supported(url) || routePrefetch?.href === url.href) return;
    discardRoutePrefetch();
    const controller = new AbortController();
    const page = fetch(url.href, { credentials: 'same-origin', signal: controller.signal });
    page.catch(() => {});
    const match = url.pathname.match(gameRoutePattern);
    routePrefetch = {
      href: url.href, controller, page, at: Date.now(),
      gameData: match ? prefetchGameData(match[1], controller.signal) : null,
    };
  }

  function takeRoutePrefetch(href, signal) {
    const entry = routePrefetch;
    routePrefetch = null;
    if (!entry) return null;
    if (entry.href !== href || Date.now() - entry.at > routePrefetchLifetimeMs) {
      entry.controller.abort();
      return null;
    }
    signal.addEventListener('abort', () => entry.controller.abort(), { once: true });
    return entry;
  }

  let gameDataHandoff = null;

  // The game bundle consumes its match data once, from the route that mounted it.
  // A direct load or refresh of /game/:id would otherwise request its match data
  // only after Phaser and the game bundle have downloaded and run. /gamedata
  // changes no server state, so start it with the document instead.
  const initialGameMatch = location.pathname.match(gameRoutePattern);
  if (initialGameMatch) {
    gameDataHandoff = { ticket: getTicket(), matchId: initialGameMatch[1], request: prefetchGameData(initialGameMatch[1]) };
  }
  function consumeGameData(matchId) {
    const entry = gameDataHandoff;
    gameDataHandoff = null;
    return entry && entry.ticket === getTicket() && entry.matchId === String(matchId) ? entry.request : null;
  }

  function handOffGameData(matchId, ticket, request) {
    gameDataHandoff = matchId ? { ticket, matchId, request } : null;
  }

  return { prefetchRoute, takeRoutePrefetch, discardRoutePrefetch, consumeGameData, handOffGameData };
}
