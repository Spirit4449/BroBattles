import { escapeHtml, assetUrl } from "../../shared/site/html.cjs";
import { bindPlayerCardHover, presentPlayerCardMedia, createPlayerCardMedia } from "./playerCardAnimation.cjs";

const CARD_RARITY_ORDER = { common: 0, rare: 1, epic: 2, legendary: 3 };

export function comparePlayerCardsByRarity(a, b) {
  const rank = card => CARD_RARITY_ORDER[String(card?.rarity || 'common').toLowerCase()] ?? 4;
  return rank(a) - rank(b) || String(a?.name || '').localeCompare(String(b?.name || ''));
}

export function createPlayerCardTile(card, { selected = false, lobby = false } = {}) {
  const rarity = String(card?.rarity || "common").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const tile = document.createElement(lobby ? "article" : "div");
  tile.tabIndex = 0;
  tile.setAttribute('aria-label', String(card?.name || 'Player card'));
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
  const media = createPlayerCardMedia(card, { hover: true });
  tile.querySelector("img").replaceWith(presentPlayerCardMedia(media, card));
  bindPlayerCardHover(tile, media, card);
  return tile;
}
