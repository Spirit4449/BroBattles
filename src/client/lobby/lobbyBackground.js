import { getLobbyBgAsset } from "../game/maps/manifest";

// Cross-fades the lobby backdrop to a map's art and remembers it per
// party/solo scope so public/index.html can paint it before the bundle loads.
let lobbyBackgroundRequestSequence = 0;

export function setLobbyBackground(mapValue) {
  const nextUrl = getLobbyBgAsset(mapValue);
  const current = document.body.dataset.lobbyBackgroundUrl || "";
  const target = `url("${nextUrl}")`;
  const requestId = String(++lobbyBackgroundRequestSequence);
  const existingOverlay = document.getElementById("lobby-bg-fade");
  if (current === nextUrl) {
    if (existingOverlay) {
      existingOverlay.dataset.backgroundRequestId = requestId;
      existingOverlay.classList.remove("active");
    }
    return;
  }

  let overlay = existingOverlay;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "lobby-bg-fade";
    document.body.appendChild(overlay);
  }

  const preload = new Image();
  let applied = false;
  overlay.dataset.backgroundRequestId = requestId;

  const applyLoadedBackground = () => {
    if (applied || overlay.dataset.backgroundRequestId !== requestId) return;
    applied = true;
    overlay.style.backgroundImage = target;
    overlay.classList.add("active");

    setTimeout(() => {
      if (overlay.dataset.backgroundRequestId !== requestId) return;
      document.body.style.backgroundImage = target;
      document.body.dataset.lobbyBackgroundUrl = nextUrl;
      try {
        const partyMatch =
          window.location.pathname.match(/^\/party\/([^/?#]+)/);
        const backgroundScope = partyMatch ? `party:${partyMatch[1]}` : "solo";
        localStorage.setItem(
          `bb_lobby_background_url:${backgroundScope}`,
          nextUrl,
        );
      } catch (_) {}
      overlay.classList.remove("active");
    }, 240);
  };

  preload.onload = applyLoadedBackground;
  preload.src = nextUrl;
  if (preload.complete) queueMicrotask(applyLoadedBackground);
}
