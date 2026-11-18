import { getNavigation } from "../lib/globals.cjs";
import { API_PATHS } from "../../shared/net/apiPaths.js";
import { postJson } from '../lib/http.js';

function partyPath(partyId) {
  const id = Number(partyId);
  return Number.isFinite(id) && id > 0 ? `/party/${id}` : '/';
}

export async function returnFromMatch({ gameData, username, refreshStatus = false }) {
  const partyId = gameData?.players?.find(player => player.name === username)?.party_id;
  if (getNavigation()?.prepareLobbyReturn) {
    return getNavigation().prepareLobbyReturn(Number(partyId));
  }
  let target = partyPath(partyId);
  if (refreshStatus) {
    try {
      const data = await postJson(API_PATHS.STATUS);
      target = data?.banned ? '/banned' : partyPath(data?.party_id);
    } catch (error) {
      if (error.payload?.banned) target = '/banned';
    }
  }
  window.location.replace(target);
}

// Router-owned, single-use data. It never lives in storage or survives a route.
export function createLobbyReturnController({ navigate, getRouteVersion, getScopeId, onStatusReady = () => {} }) {
  let pending;
  let handoff;
  function clear() {
    pending?.controller.abort();
    pending = null;
    handoff = null;
  }
  return {
    clear,
    bind(status, ticket, scopeId) {
      handoff = status ? { status, ticket, scopeId } : null;
    },
    consume() {
      const value = handoff;
      handoff = null;
      return value?.ticket === getRouteVersion() && value?.scopeId === getScopeId() ? value.status : null;
    },
    prepare(fallbackPartyId) {
      if (pending) return pending.promise;
      const request = { controller: new AbortController() };
      pending = request;
      const version = getRouteVersion();
      request.promise = (async () => {
        let status = null;
        const timeout = setTimeout(() => request.controller.abort(), 8000);
        try {
          const data = await postJson(API_PATHS.STATUS, undefined, { signal: request.controller.signal });
          if (data?.banned) {
            if (pending === request && version === getRouteVersion()) await navigate('/banned', { replace: true });
            return;
          }
          if (data?.success && data?.userData) status = data;
        } catch (error) {
          if (error.payload?.banned) {
            if (pending === request && version === getRouteVersion()) await navigate('/banned', { replace: true });
            return;
          }
          // Normal lobby bootstrap retries if status was unavailable.
        }
        finally { clearTimeout(timeout); }
        if (pending !== request || version !== getRouteVersion()) return;
        onStatusReady();
        const target = partyPath(status ? status.party_id : fallbackPartyId);
        await navigate(target, { replace: true, lobbyReturnStatus: status });
      })().finally(() => { if (pending === request) pending = null; });
      return request.promise;
    },
  };
}
