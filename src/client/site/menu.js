import { API_PATHS } from "../../shared/net/apiPaths.js";
import config from "../../shared/site/siteConfig.json";
import { playSound } from "../ui/uiSounds";
import { getJson } from "../lib/http.js";
import { element } from "../ui/dom";
import { openSettings } from "./settingsDialog";

let navigationGuard = async () => true;

function setNavigationGuard(guard) {
  navigationGuard = guard;
}

function wireNavigation() {
  const host = document.querySelector("#navbar > .flex, .site-brand, .site-menu-host");
  if (host && !document.querySelector(".site-waffle")) {
    const wrap = element("div", null, "site-nav-wrap");
    const button = element("button", null, "site-waffle pixel-menu-button");
    button.type = "button";
    button.setAttribute("aria-label", "Open site menu");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "site-menu");
    for (let i = 0; i < 9; i++) {
      const dot = element("i");
      dot.setAttribute("aria-hidden", "true");
      button.append(dot);
    }
    const notification = element("span", null, "site-waffle-notification");
    notification.dataset.supportUnread = "";
    notification.setAttribute("aria-hidden", "true");
    button.append(notification);
    const menu = element("nav", null, "site-menu");
    menu.id = "site-menu";
    menu.setAttribute("aria-label", "Site navigation");
    menu.hidden = true;
    const withIcon = (node, icon) => {
      const img = element("img", null, "site-menu-icon");
      img.src = `/assets/icons/menu/${icon}.webp`;
      img.alt = "";
      img.width = img.height = 24;
      node.prepend(img);
      return node;
    };
    for (const [label, url, icon] of [
      ["About", "/about", "about"],
      ["News", "/news", "news"],
      ["Help Center", "/help", "help"],
      ["Feedback", "/feedback", "feedback"],
    ]) {
      const a = withIcon(element("a", label), icon);
      a.href = url;
      if (url === "/help") {
        const badge = element("span", "NEW", "site-support-badge");
        badge.dataset.supportUnread = "";
        badge.setAttribute("aria-hidden", "true");
        a.append(badge);
      }
      menu.append(a);
    }
    const settings = withIcon(element("button", "Settings"), "settings");
    settings.type = "button";
    settings.onclick = () => {
      toggle(false);
      openSettings();
    };
    menu.append(settings);
    for (const [label, url, icon] of [
      ["Admin Panel", "/admin", "admin"],
      ["Map Studio", "/map-editor", "map-studio"],
    ]) {
      const a = withIcon(element("a", label), icon);
      a.href = url;
      a.dataset.adminLink = "";
      a.hidden = true;
      menu.append(a);
    }
    menu.append(element("hr"));
    for (const [label, url, icon] of [
      ["Privacy Policy", "/privacy", "privacy"],
      ["Terms of Service", "/terms", "terms"],
    ]) {
      const a = withIcon(element("a", label, "site-menu-legal"), icon);
      a.href = url;
      menu.append(a);
    }
    const versionLabel = element("small", config.version);
    menu.append(versionLabel);
    const refreshVersion = async () => {
      try {
        const data = await getJson(API_PATHS.API_VERSION, {
          cache: "no-store",
          fallbackMessage: "Version unavailable",
        });
        const status =
          {
            current: "Up to date",
            different: `Deployment differs from ${data.branch}`,
            modified: "Uncommitted changes",
            development: "Development",
            unknown: "Unable to check",
          }[data.status] || "Unable to check";
        versionLabel.textContent = `${data.version || config.version}${data.build ? ` · Build ${data.build}` : ""} · ${status}`;
        versionLabel.title = data.commit
          ? `Commit ${data.commit} · Built ${data.builtAt}${data.checkedAt ? ` · Checked ${data.checkedAt}` : ""}`
          : "";
      } catch (_) {
        versionLabel.textContent = `${config.version} · Unable to check`;
      }
    };
    refreshVersion();
    wrap.append(button, menu);
    host.querySelector(".site-menu-placeholder")?.remove();
    host.prepend(wrap);
    menu.addEventListener("click", async (event) => {
      const link = event.target.closest("a");
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (await navigationGuard()) location.assign(link.href);
    });
    const toggle = (value) => {
      menu.hidden = !value;
      button.setAttribute("aria-expanded", String(value));
      if (value) refreshVersion();
    };
    button.onclick = () => {
      playSound("cursor4");
      toggle(menu.hidden);
    };
    wrap.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        toggle(false);
        button.focus();
      }
      if (event.key === "ArrowDown" && event.target === button) {
        event.preventDefault();
        toggle(true);
        menu.querySelector("a").focus();
      }
    });
    document.addEventListener("click", (event) => {
      if (!wrap.contains(event.target)) toggle(false);
    });
    wrap.addEventListener("focusout", (event) => {
      if (event.relatedTarget && !wrap.contains(event.relatedTarget)) toggle(false);
    });
  }
  if (location.pathname.startsWith("/game/") || location.pathname === "/map-editor/playtest") {
    const button = element("button", null, "site-battle-settings fullscreen-toggle");
    button.setAttribute("aria-label", "Settings");
    const img = element("img");
    img.src = "/assets/icons/settings.webp";
    img.alt = "";
    button.append(img);
    button.onclick = openSettings;
    document.body.append(button);
  }
}

export { wireNavigation, setNavigationGuard };
