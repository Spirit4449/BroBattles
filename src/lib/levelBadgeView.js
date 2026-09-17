import { LEVEL_CAP } from "../shared/characterStats.js";

export function normalizeCharacterLevel(level) {
  return Math.max(1, Math.min(LEVEL_CAP, Number(level) || 1));
}

function applyClassNames(element, className) {
  String(className || "")
    .split(/\s+/)
    .filter(Boolean)
    .forEach((name) => element.classList.add(name));
}

export function renderLevelBadge(
  root,
  level,
  { className = "", ariaHidden = false, ariaLabel = "" } = {},
) {
  const normalizedLevel = normalizeCharacterLevel(level);
  root.replaceChildren();
  root.classList.add("level-badge");
  applyClassNames(root, className);
  root.dataset.level = String(normalizedLevel);

  if (ariaHidden) {
    root.setAttribute("aria-hidden", "true");
    root.removeAttribute("role");
    root.removeAttribute("aria-label");
    root.removeAttribute("title");
  } else {
    const label = ariaLabel || `Level ${normalizedLevel} of ${LEVEL_CAP}`;
    root.removeAttribute("aria-hidden");
    root.setAttribute("role", "img");
    root.setAttribute("aria-label", label);
    root.title = label;
  }

  const caption = document.createElement("span");
  caption.className = "level-badge__caption character-level-caption";
  caption.setAttribute("aria-hidden", "true");
  const captionText = document.createElement("span");
  captionText.className = "level-badge__caption-text";
  captionText.textContent = "LEVEL";
  caption.appendChild(captionText);

  const art = document.createElement("img");
  art.className = "level-badge__art character-level-art";
  art.setAttribute("aria-hidden", "true");
  art.src = `/assets/levels/${normalizedLevel}.webp`;
  art.alt = "";
  art.draggable = false;

  root.append(caption, art);
  return root;
}

export function createLevelBadge(level, options = {}) {
  return renderLevelBadge(document.createElement("div"), level, options);
}

export function clearLevelBadge(root) {
  root.replaceChildren();
  root.classList.remove("level-badge");
  delete root.dataset.level;
  root.removeAttribute("role");
  root.removeAttribute("aria-label");
  root.removeAttribute("title");
}
