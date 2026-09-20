// Keep the static template hidden until the authoritative roster is committed.
let revealPending = false;
let failureTimer;

export function watchLobbyLoading() {
  failureTimer = window.setTimeout(showLobbyLoadError, 12000);
}

export function showLobbyLoadError() {
  const lobby = document.getElementById("lobby-area");
  if (!lobby?.hasAttribute("data-loading")) return;
  const loading = document.getElementById("lobby-loading");
  loading.querySelector("span").textContent = "Taking longer to load your lobby…";
  loading.querySelector("button").hidden = false;
}

export async function revealLobby() {
  const lobby = document.getElementById("lobby-area");
  if (!lobby?.hasAttribute("data-loading") || revealPending) return;
  revealPending = true;
  // Allow cached sprites to decode without holding the lobby on a slow asset.
  const images = [...lobby.querySelectorAll("img")].filter(img => img.getAttribute("src"));
  let assetTimer;
  await Promise.race([
    Promise.allSettled(images.map(img => img.decode?.())),
    new Promise(resolve => { assetTimer = window.setTimeout(resolve, 450); }),
  ]);
  if (window.__BB_PAGE_SCOPE__ && !window.__BB_PAGE_SCOPE__.active) return;
  window.clearTimeout(assetTimer);
  window.clearTimeout(failureTimer);
  lobby.removeAttribute("data-loading");
  lobby.setAttribute("aria-busy", "false");
  document.dispatchEvent(new Event("lobby:ready"));
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  [...lobby.querySelectorAll(":scope > .platform, :scope > #vs-container")].forEach((platform, index) => {
    platform.animate([
      { opacity: 0, translate: "0 14px" },
      { opacity: 1, translate: "0 0" },
    ], { duration: 320, delay: index * 35, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
  });
}
