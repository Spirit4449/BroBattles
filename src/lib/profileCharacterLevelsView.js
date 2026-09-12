import { getAllCharacters, LEVEL_CAP } from "../shared/characterStats.js";
import { buildProfileIconUrl } from "./profileIconAssets.js";

function toDisplayName(id) {
  return String(id || "")
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function renderCharacterLevelGrid(grid, charLevels = {}) {
  if (!grid) return;
  grid.innerHTML = "";

  const validChars = new Set(
    typeof getAllCharacters === "function" ? getAllCharacters() : [],
  );
  const mergedLevels = {};

  Object.entries(charLevels || {}).forEach(([charId, rawLevel]) => {
    let id = String(charId || "")
      .trim()
      .toLowerCase();
    if (id === "hunteress") id = "huntress";
    if (validChars.size > 0 && !validChars.has(id)) return;

    const level = Number(rawLevel) || 0;
    if (level > 0) {
      mergedLevels[id] = Math.max(mergedLevels[id] || 0, level);
    }
  });

  const entries = Object.entries(mergedLevels)
    .map(([charId, level]) => ({ charId, level }))
    .sort((a, b) => b.level - a.level || a.charId.localeCompare(b.charId));

  const heading = grid.closest(".profile-card, .profile-panel")?.querySelector(
    "[data-bros-heading]",
  );
  if (heading) {
    const total = validChars.size || entries.length;
    heading.innerHTML = `
      <span>Bros</span>
      <span class="profile-bros-unlocked-count"><strong>${entries.length}/${total}</strong> unlocked</span>
    `;
  }

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "profile-character-level-empty";
    empty.textContent = "No unlocked Bros yet.";
    grid.appendChild(empty);
    return;
  }

  entries.forEach(({ charId, level }) => {
    const iconLevel = Math.max(1, Math.min(LEVEL_CAP, Number(level) || 1));
    const displayName = toDisplayName(charId);
    const card = document.createElement("article");
    card.className = "profile-character-level-card";
    card.setAttribute("aria-label", `${displayName}, level ${iconLevel}`);
    card.innerHTML = `
      <img src="${buildProfileIconUrl(charId, charId)}" alt="${displayName}" />
      <span class="profile-character-level-badge" aria-hidden="true">
        <img src="/assets/levels/${iconLevel}.webp" alt="" />
      </span>
      <div class="profile-character-level-name">${displayName}</div>
    `;
    grid.appendChild(card);
  });
}
