import { BROWSER_EVENTS } from "../lib/browserEvents.js";
import { getNavigation, getPageScope } from "../lib/globals.cjs";
import { setLobbyLoadingProgress } from "./lobbyLoadingBar.js";
export { setLobbyLoadingProgress };
const MIN_LOADING_DISPLAY_MS = 500;
const LOADING_EXIT_MS = 320;
let loadingStartedAt;
let loadingHold;
let loadingExit;
let revealPending = false;
let failureTimer;

export function dismissLobbyLoading(onReveal) {
  window.clearTimeout(failureTimer);
  const loading = document.getElementById("lobby-loading");
  // Route navigation already has a loading screen above the lobby template.
  if (!loading || loading.hidden || document.getElementById("bb-route-transition")) {
    if (loading) loading.hidden = true;
    onReveal();
    return;
  }

  const scope = getPageScope();
  const now = performance.now();
  const startedAt = Number(loading.dataset.shownAt ?? loadingStartedAt ?? now);
  const remaining = MIN_LOADING_DISPLAY_MS - (now - startedAt);
  loadingHold ??= remaining > 0
    ? new Promise(resolve => window.setTimeout(resolve, remaining))
    : Promise.resolve();

  return loadingHold.then(() => {
    if (scope?.active === false || !loading.isConnected) return;
    setLobbyLoadingProgress(100);
    loading.dataset.leaving = "";
    onReveal();
    if (!loadingExit) {
      const animation = !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches &&
        loading.animate?.([{ opacity: 1 }, { opacity: 0 }], {
          duration: LOADING_EXIT_MS,
          easing: "cubic-bezier(.4,0,.25,1)",
          fill: "forwards",
        });
      loadingExit = Promise.resolve(animation?.finished).catch(() => {}).then(() => {
        loading.hidden = true;
      });
    }
    return loadingExit;
  });
}

export function watchLobbyLoading() {
  loadingStartedAt = performance.now();
  setLobbyLoadingProgress(35, 55);
  failureTimer = window.setTimeout(showLobbyLoadError, 12000);
}

export function showLobbyLoadError() {
  const loading = document.getElementById("lobby-loading");
  if (!loading || loading.hidden) return;
  const label = loading.querySelector(".lobby-loading-label");
  if (label) label.textContent = "Taking longer to load your lobby…";
  loading.querySelector("button").hidden = false;
}

export async function revealLobby() {
  const lobby = document.getElementById("lobby-area");
  if (!lobby?.hasAttribute("data-loading") || revealPending) return;
  revealPending = true;
  getNavigation()?.progress(94);
  setLobbyLoadingProgress(80, 84);
  // Allow cached sprites to decode without holding the lobby on a slow asset.
  const images = [...lobby.querySelectorAll("img")].filter(img => img.getAttribute("src"));
  let decoded = 0;
  const countDecoded = () => {
    decoded += 1;
    setLobbyLoadingProgress(80 + 18 * decoded / images.length);
  };
  let assetTimer;
  await Promise.race([
    Promise.allSettled(images.map(img => Promise.resolve(img.decode?.()).finally(countDecoded))),
    new Promise(resolve => { assetTimer = window.setTimeout(resolve, 450); }),
  ]);
  if (getPageScope() && !getPageScope().active) return;
  window.clearTimeout(assetTimer);
  const exit = dismissLobbyLoading(() => {
    lobby.removeAttribute("data-loading");
    lobby.setAttribute("aria-busy", "false");
    animateLobbyRoster(lobby);
  });
  if (exit) await exit;
  if (getPageScope()?.active === false || !lobby.isConnected) return;
  document.dispatchEvent(new Event(BROWSER_EVENTS.LOBBY_REVEALED));
}

function animateLobbyRoster(lobby) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  [...lobby.querySelectorAll(":scope > .platform, :scope > #vs-container")].forEach((platform, index) => {
    platform.animate([
      { opacity: 0, translate: "0 14px" },
      { opacity: 1, translate: "0 0" },
    ], { duration: 320, delay: index * 35, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
  });
}
