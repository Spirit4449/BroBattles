import { escapeHtml, assetUrl } from "../shared/html.cjs";

export function createPlayerCardTile(card, { selected = false, lobby = false } = {}) {
  const rarity = String(card?.rarity || "common").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const tile = document.createElement(lobby ? "article" : "div");
  tile.className = `${lobby ? "profile-card-tile" : "card-tile"} ${rarity}${lobby && selected ? " is-selected" : ""}`;
  tile.innerHTML = `
    <img src="${escapeHtml(assetUrl(card?.assetUrl))}" alt="${escapeHtml(card?.name)}" />
    <div class="${lobby ? "profile-card-meta" : "card-meta"}">
      <strong>${escapeHtml(card?.name)}</strong>
      <span class="profile-card-rarity ${rarity}">${rarity}</span>
    </div>
    <div class="${lobby ? "profile-card-actions" : "card-actions"}">${
      // The lobby button already states equipped/owned, so it stands alone.
      lobby ? "" : `
      <span>${selected ? "Equipped" : "Owned"}</span>`}
      <button class="${lobby ? "profile-card-btn pixel-menu-button" : "profile-btn"}" type="button">
        ${lobby ? (selected ? "Equipped" : "Equip") : selected ? "Selected" : "Equip"}
      </button>
    </div>`;
  const button = tile.querySelector("button");
  button.dataset.cardId = String(card?.id ?? "");
  button.disabled = selected;
  return tile;
}
