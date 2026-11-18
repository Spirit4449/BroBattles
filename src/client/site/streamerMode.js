import { getSettings } from "./preferences";

// Existing lobby code reads textContent as identity. Keep that data intact and
// obscure its presentation; the accessibility tree receives only a neutral label.
const privateSelector = [
  "#username-text",
  "input[autocomplete=username]",
  "#spectate-player-name",
  "#party-join-request-owner",
  "#party-join-request-title",
  ".party-discovery-title",
  ".party-discovery-meta span",
  ".bb-chat-reply-preview strong",
  ".username",
  ".mm-name",
  ".bs-card-player-name",
  ".team-hud-player-name",
  "#profile-username",
  "#profile-hero-name",
  "#profile-popup-title",
  "#profile-new-username",
  "#guestName",
  ".bb-chat-author",
  ".bb-chat-game-line-name",
  ".bb-chat-viewer-name",
  ".bb-chat-typing-text",
  ".bb-chat-reply-author",
  ".bb-chat-reply-name",
  ".bb-chat-reply-banner strong",
  ".leaderboard-name",
  ".leaderboard-username",
  ".sonner__hdr",
  ".sonner__msg",
  "#party-slot-menu-name",
  ".party-discovery-member-name",
  ".bb-game-over-result-row [role=cell]:first-child",
  "[data-private-name]",
].join(",");

const savedAttributes = new WeakMap();

const privateAttributes = new WeakMap();

const privateAttributeSelectors = [
  [".bb-chat-inline-reaction[data-tooltip]", "data-tooltip"],
  [".party-discovery-meta[title],.party-discovery-member[title]", "title"],
  [".leaderboard-row[aria-label]", "aria-label"],
];

function applyStreamer() {
  const on = getSettings().streamer;
  document.documentElement.classList.toggle("bb-streamer", on);
  for (const [selector, attribute] of privateAttributeSelectors)
    for (const node of document.querySelectorAll(selector)) {
      const current = node.getAttribute(attribute);
      if (on && current !== "Player") {
        privateAttributes.set(node, current);
        node.setAttribute(attribute, "Player");
      } else if (!on && privateAttributes.has(node)) {
        node.setAttribute(attribute, privateAttributes.get(node));
        privateAttributes.delete(node);
      }
    }
  for (const image of document.querySelectorAll(
    ".bb-chat-typing-icon img,.bb-chat-viewer-avatar img,.bb-chat-avatar img",
  )) {
    if (on) {
      if (!savedAttributes.has(image))
        savedAttributes.set(image, { alt: image.getAttribute("alt") });
      if (image.alt !== "Player") image.alt = "Player";
    } else if (savedAttributes.has(image)) {
      image.alt = savedAttributes.get(image).alt || "";
      savedAttributes.delete(image);
    }
  }
  for (const node of document.querySelectorAll(privateSelector)) {
    node.classList.toggle("bb-private-name", on);
    if (on) {
      if (!savedAttributes.has(node))
        savedAttributes.set(node, {
          role: node.getAttribute("role"),
          label: node.getAttribute("aria-label"),
          title: node.getAttribute("title"),
        });
      if (node.getAttribute("aria-label") !== "Player") {
        node.setAttribute("aria-label", "Player");
        if (!node.matches("input")) node.setAttribute("role", "img");
        node.removeAttribute("title");
      }
    } else if (savedAttributes.has(node)) {
      const attrs = savedAttributes.get(node);
      for (const [key, value] of Object.entries({
        role: attrs.role,
        "aria-label": attrs.label,
        title: attrs.title,
      })) {
        if (value === null) node.removeAttribute(key);
        else node.setAttribute(key, value);
      }
      savedAttributes.delete(node);
    }
  }
}

export { privateSelector, applyStreamer };
