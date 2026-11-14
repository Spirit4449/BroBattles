import { canonicalCharacterKey, getAllCharacters, getCharacterDisplayName } from "../../shared/characters/characterStats.js";
import { buildProfileIconUrl } from "./profileIconAssets.js";

export function renderFavoriteCharacter(container, favorite) {
  if (!container) return;
  container.replaceChildren();
  const character = canonicalCharacterKey(favorite?.character);
  const count = Number(favorite?.matchesPlayed) || 0;
  const hasFavorite = getAllCharacters().includes(character) && count > 0;
  const label = document.createElement("span");
  label.textContent = "Favorite Character";
  const name = document.createElement("strong");
  name.textContent = hasFavorite ? getCharacterDisplayName(character) : "None yet";
  container.title = hasFavorite
    ? `${count.toLocaleString()} ${count === 1 ? "battle" : "battles"} played · Most used`
    : "Finish a battle to discover your favorite character.";
  if (hasFavorite && container.classList.contains("profile-metric-card")) {
    const icon = document.createElement("span");
    icon.className = "profile-metric-icon";
    icon.setAttribute("aria-hidden", "true");
    const portrait = document.createElement("img");
    portrait.src = buildProfileIconUrl(character, character);
    portrait.alt = "";
    icon.append(portrait);
    container.append(icon);
  }
  container.append(label, name);
}
