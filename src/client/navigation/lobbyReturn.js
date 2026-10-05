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
          const response = await fetch('/status', { method: 'POST', credentials: 'same-origin', signal: request.controller.signal });
          const data = await response.json();
          if (data?.banned) {
            if (pending === request && version === getRouteVersion()) await navigate('/banned', { replace: true });
            return;
          }
          if (response.ok && data?.success && data?.userData) status = data;
        } catch (_) { /* Normal lobby bootstrap retries if status was unavailable. */ }
        finally { clearTimeout(timeout); }
        if (pending !== request || version !== getRouteVersion()) return;
        onStatusReady();
        const partyId = Number(status ? status.party_id : fallbackPartyId);
        const target = Number.isFinite(partyId) && partyId > 0 ? `/party/${partyId}` : '/';
        await navigate(target, { replace: true, lobbyReturnStatus: status });
      })().finally(() => { if (pending === request) pending = null; });
      return request.promise;
    },
  };
}
