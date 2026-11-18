import { API_PATHS } from "../../shared/net/apiPaths.js";
import { renderHeader } from "../../shared/site/siteHeader.cjs";
import { initializeDesktopNavigation } from "./navigation";
import { getSettings, subscribeSettings } from "./preferences";
import { initUISounds } from "../ui/uiSounds";
import { openLegal } from "./legal";
import { wireNavigation } from "./menu";
import { privateSelector, applyStreamer } from "./streamerMode";
import { renderCachedAccount, refreshUnread } from "./siteSession";
import { initializeRuntimeStatus } from "./runtimeStatus";

import "./site.css";

import "./pixelChecks.css";

function initialize() {
  // Tool pages (admin, Map Studio) borrow only the waffle menu, not the lobby's sounds, runtime status or streamer masking.
  const toolPage = !!document.querySelector(".site-menu-host");
  if (!toolPage) {
    initUISounds();
    initializeRuntimeStatus();
  }
  // Auth pages have no lobby header: supply a compact shared brand header.
  if (
    [API_PATHS.SIGNUP, API_PATHS.LOGIN].includes(location.pathname) &&
    !document.querySelector(".site-brand")
  ) {
    document.body.insertAdjacentHTML("afterbegin", renderHeader(location.pathname));
  }
  wireNavigation();
  initializeDesktopNavigation();
  renderCachedAccount();
  if (!toolPage) {
    applyStreamer();
    subscribeSettings(applyStreamer);
  }
  let pending = false;
  if (!toolPage)
    new MutationObserver((records) => {
      if (!getSettings().streamer || pending) return;
      const relevant = records.some(
        (record) =>
          record.type === "attributes" ||
          Array.from(record.addedNodes).some((node) => node.nodeType === 1) ||
          (record.target.matches?.(privateSelector) &&
            !record.target.classList.contains("bb-private-name")),
      );
      if (relevant) {
        pending = true;
        queueMicrotask(() => {
          pending = false;
          applyStreamer();
        });
      }
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["title", "data-tooltip", "aria-label", "alt"],
    });
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-legal]");
    if (link) {
      event.preventDefault();
      openLegal(link.dataset.legal);
    }
  });
  refreshUnread();
  const unreadTimer = setInterval(() => {
    if (!document.hidden) refreshUnread();
  }, 30000);
  window.addEventListener("pagehide", () => clearInterval(unreadTimer), { once: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshUnread();
  });
}

let scheduled = false;
export function initSiteShell() {
  if (scheduled) return;
  scheduled = true;
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
}
export { api } from "./siteApi";
export { element } from "../ui/dom";
export { openSettings } from "./settingsDialog";
export { setNavigationGuard } from "./menu";
export { refreshUnread } from "./siteSession";
export { ensureLegalAcceptance } from "./legal";
