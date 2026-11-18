import { BROWSER_EVENTS } from "../lib/browserEvents.js";
import { getSuspension } from "../lobby/session.mjs";
import { API_PATHS } from "../../shared/net/apiPaths.js";
import { sonner } from "../ui/sonner";
import { renderReadyRestrictions } from "../views/readyRestrictionView.js";
import { getJson } from "../lib/http.js";

function initializeRuntimeStatus() {
  let runtime = {},
    offset = 0;
  let announcementShown = false;
  const isGameEntry = location.pathname === "/" || location.pathname.startsWith("/game/");
  function showAnnouncement() {
    const message = String(runtime.announcements || "").trim();
    if (!isGameEntry || announcementShown || !message) return;
    if (document.querySelector("#lobby-area[data-loading]")) return;
    announcementShown = true;
    sonner("Global announcement", message, "Dismiss", undefined, { persistent: true });
  }
  document.addEventListener(BROWSER_EVENTS.LOBBY_REVEALED, showAnnouncement, { once: true });
  function render() {
    const now = Date.now() + offset;
    renderReadyRestrictions(document, {
      maintenanceUntil: runtime.maintenanceUntil,
      suspendedUntil: getSuspension()?.matchmaking,
      now,
    });
  }
  async function refresh() {
    try {
      runtime = await getJson(API_PATHS.API_SITE_RUNTIME, { cache: "no-store" });
      showAnnouncement();
      offset = Number.isFinite(runtime.serverTime) ? runtime.serverTime - Date.now() : 0;
      render();
    } catch (_) {
      /* Keep the last known announcement during a network interruption. */
    }
  }
  const clock = setInterval(render, 1000);
  window.addEventListener("pagehide", () => clearInterval(clock), { once: true });

  refresh();
  const timer = setInterval(() => {
    if (!document.hidden) refresh();
  }, 15000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
}

export { initializeRuntimeStatus };
