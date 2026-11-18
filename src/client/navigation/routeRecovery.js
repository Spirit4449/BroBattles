import { requestMatchData } from "./gameData.js";
import { gameRoutePattern } from "./routePrefetch.js";

export function createRouteRecovery({ getTicket, presentation, onFailure, navigate, prepareLobbyReturn }) {
  let routeFailed = false;
  let recoveryRequest;
  let retryAvailableAt = 0;
  let retryTimer;
  const unavailableMatchCodes = new Set(['MATCH_UNAVAILABLE', 'MATCH_ENDED']);
  let failureCode;

  let readinessTimer;
  let readinessTicket = null;
  const readinessTimeoutMs = 45000;
  // Fail only when a screen stops advancing, so a slow but progressing load
  // is never abandoned.
  function armReadinessTimer(ticket) {
    clearTimeout(readinessTimer);
    readinessTicket = ticket;
    readinessTimer = setTimeout(() => { if (ticket === getTicket()) fail(new Error('Screen readiness timed out')); }, readinessTimeoutMs);
  }
  function clearReadinessTimer() {
    clearTimeout(readinessTimer);
    readinessTicket = null;
  }

  function fail(error) {
    if (routeFailed) return;
    routeFailed = true;
    onFailure();
    clearReadinessTimer();
    recoveryRequest?.abort();
    recoveryRequest = null;
    failureCode = error.code;
    console.error('[navigation]', error);
    presentation.showTransition('An error occurred');
    const retry = presentation.getNode().querySelector('button');
    retry.hidden = false;
    if (retryAvailableAt) retryAvailableAt = Math.max(retryAvailableAt, Date.now() + 2000);
    const delay = Math.max(0, retryAvailableAt - Date.now());
    retry.disabled = delay > 0;
    retry.textContent = delay > 0 ? 'Please wait…' : 'Try again';
    clearTimeout(retryTimer);
    if (delay) retryTimer = setTimeout(() => {
      if (!routeFailed || presentation.getNode()?.querySelector('button') !== retry) return;
      retry.disabled = false;
      retry.textContent = 'Try again';
    }, delay);
  }

  async function retryFailedRoute() {
    if (!routeFailed || recoveryRequest || Date.now() < retryAvailableAt) return;
    const destination = presentation.getNode()?.dataset.destination || location.href;
    const match = new URL(destination, location.href).pathname.match(gameRoutePattern);
    const code = failureCode;
    const ticket = getTicket();
    const controller = new AbortController();
    recoveryRequest = controller;
    routeFailed = false;
    retryAvailableAt = Date.now() + 2000;
    const button = presentation.getNode().querySelector('button');
    button.disabled = true;
    button.textContent = 'Trying again…';
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      let returnToLobby = match && unavailableMatchCodes.has(code);
      let gameData = null;
      if (match && !returnToLobby) {
        const { ok, body: result } = await requestMatchData(match[1], { signal: controller.signal });
        returnToLobby = unavailableMatchCodes.has(result.code);
        if (!returnToLobby && (!ok || !result.success)) {
          throw new Error(result.error || 'Unable to check match');
        }
        // The check already fetched this match's data; the game reuses it.
        gameData = Promise.resolve({ ok, body: result });
      }
      if (ticket !== getTicket() || recoveryRequest !== controller) return;
      clearTimeout(timeout);
      if (returnToLobby) await prepareLobbyReturn();
      else await navigate(destination, { replace: true, gameData });
    } catch (error) {
      if (ticket === getTicket() && recoveryRequest === controller) fail(error);
    } finally {
      clearTimeout(timeout);
      if (recoveryRequest === controller) recoveryRequest = null;
    }
  }

  function resetForNavigation() {
    routeFailed = false;
    recoveryRequest?.abort();
    recoveryRequest = null;
    clearTimeout(retryTimer);
  }

  function refreshReadinessTimer() {
    const ticket = getTicket();
    if (readinessTicket === ticket) armReadinessTimer(ticket);
  }

  return {
    fail,
    retryFailedRoute,
    armReadinessTimer,
    clearReadinessTimer,
    refreshReadinessTimer,
    resetForNavigation,
    isFailed: () => routeFailed,
  };
}
