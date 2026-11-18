import { API_PATHS } from "../../shared/net/apiPaths.js";
import { SITE_ACCOUNT_CACHE_KEY as SESSION_CACHE } from "../lib/storageKeys.js";
import { readJson, writeJson } from "../lib/safeStorage.js";
import { renderSiteAccount } from "./navigation";
import { api } from "./siteApi";

// The last known account lets the next page draw its header control at once.
function renderCachedAccount() {
  const cached = readJson(() => sessionStorage, SESSION_CACHE);
  if (cached) renderSiteAccount(cached);
}

async function refreshUnread() {
  try {
    const data = await api(API_PATHS.API_SITE_SESSION);
    renderSiteAccount(data);
    document.querySelectorAll("[data-admin-link]").forEach((node) => {
      node.hidden = !data.admin;
    });
    const hasUnread = data.unread > 0;
    const unreadLabel = `${data.unread} unread ${data.unread === 1 ? "message" : "messages"}`;
    document
      .querySelectorAll("[data-support-unread]")
      .forEach((node) => node.classList.toggle("is-visible", hasUnread));
    const waffle = document.querySelector(".site-waffle");
    if (waffle)
      waffle.setAttribute(
        "aria-label",
        hasUnread ? `Open site menu. ${unreadLabel}.` : "Open site menu",
      );
    const helpLink = document.querySelector('.site-menu a[href="/help"]');
    if (helpLink)
      helpLink.setAttribute(
        "aria-label",
        hasUnread ? `Help Center. ${unreadLabel}.` : "Help Center",
      );
    document
      .querySelectorAll('a[href="/help/requests"]')
      .forEach((link) =>
        link.setAttribute("aria-label", hasUnread ? `My requests. ${unreadLabel}.` : "My requests"),
      );
    writeJson(() => sessionStorage, SESSION_CACHE, {
      member: data.member,
      username: data.username,
    });
    return data;
  } catch (_) {
    if (!document.querySelector(".site-header .site-account[data-identity]"))
      renderSiteAccount(null);
    return null;
  }
}

export { renderCachedAccount, refreshUnread };
