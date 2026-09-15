import ICONS from "../shared/profileIconsCatalog.json";
import { buildCharacterSkinBodyUrl } from "./skinAssets.js";

function normalizeProfileIconId(iconId) {
  const id = String(iconId || "")
    .trim()
    .toLowerCase();
  if (!id) return "";
  if (!/^[a-z0-9_-]{1,64}$/.test(id)) return "";
  return id;
}

export function buildProfileIconUrl(profileIconId, charClass = "ninja") {
  const iconId = normalizeProfileIconId(profileIconId);
  if (iconId) {
    return ICONS.icons.find(icon => icon.id === iconId)?.assetUrl || "/assets/profile-icons/ninja.webp";
  }
  const fallbackClass = String(charClass || "ninja")
    .trim()
    .toLowerCase();
  return buildCharacterSkinBodyUrl(fallbackClass || "ninja", "");
}

export function buildProfileIconAlt(profileIconId, charClass = "ninja") {
  const iconId = normalizeProfileIconId(profileIconId);
  if (iconId) return iconId;
  return String(charClass || "ninja");
}

// Numeric milestone artwork is supplied separately. Use an honest trophy fallback
// until those files arrive; the catalog URLs work immediately once supplied.
if (typeof document !== "undefined") document.addEventListener("error", event => {
  const img = event.target;
  if (img?.tagName !== "IMG") return;
  const icon = ICONS.icons.find(icon => icon.fallbackAssetUrl && img.getAttribute("src") === icon.assetUrl);
  if (icon) img.src = icon.fallbackAssetUrl;
}, true);
