import "../styles/broPortrait.css";
import ICONS from "../shared/profileIconsCatalog.json";
import { BRO_PORTRAIT_PALETTES, buildBroPortraitSvg } from "./broPortrait.mjs";
import ninjaBody from "../../public/assets/ninja/body.webp?portrait";
import thorgBody from "../../public/assets/thorg/body.webp?portrait";
import dravenBody from "../../public/assets/draven/body.webp?portrait";
import wizardBody from "../../public/assets/wizard/body.webp?portrait";
import huntressBody from "../../public/assets/huntress/body.webp?portrait";
import gloopBody from "../../public/assets/gloop/body.webp?portrait";

const bodies = { ninja: ninjaBody, thorg: thorgBody, draven: dravenBody,
  wizard: wizardBody, huntress: huntressBody, gloop: gloopBody };
const portraitUrls = new Map();

function broPortraitUrl(character) {
  const id = Object.hasOwn(bodies, character) ? character : "ninja";
  if (!portraitUrls.has(id)) {
    const svg = buildBroPortraitSvg(bodies[id], BRO_PORTRAIT_PALETTES[id]);
    portraitUrls.set(id, `data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, "%27")}`);
  }
  return portraitUrls.get(id);
}

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
  const character = normalizeProfileIconId(charClass) || "ninja";
  if (Object.hasOwn(bodies, iconId)) return broPortraitUrl(iconId);
  if (iconId) {
    return ICONS.icons.find(icon => icon.id === iconId)?.assetUrl || broPortraitUrl(character);
  }
  return broPortraitUrl(character === "hunteress" ? "huntress" : character);
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
