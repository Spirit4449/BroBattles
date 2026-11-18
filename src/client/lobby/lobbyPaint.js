import { SOLO_MAP_STORAGE_KEY } from "../../shared/storageKeys.js";
import { lobbyBackgroundStorageKey } from "./lobbyBackgroundCache.js";

const backgrounds = {
  1: "/assets/lushy/lobbyBg.webp",
  2: "/assets/mangrove/lobbyBg.webp",
  3: "/assets/serenity/lobbyBg.webp",
  4: "/assets/bank-bust/lobbyBg.webp",
};
const retiredBackgrounds = {
  "/assets/site/lushy-home.webp": backgrounds[1],
  "/assets/site/lushy-home-v2.webp": backgrounds[1],
  "/assets/site/mangrove-home.webp": backgrounds[2],
  "/assets/site/serenity-home.webp": backgrounds[3],
  "/assets/site/bank-home.webp": backgrounds[4],
};

function restoreBackground() {
  const key = lobbyBackgroundStorageKey(location.pathname);
  const inParty = key !== lobbyBackgroundStorageKey("/");
  try {
    let cachedUrl = localStorage.getItem(key);
    if (cachedUrl && !/^\/assets\/[a-z0-9/_-]+\.(webp|png|jpe?g)$/i.test(cachedUrl)) cachedUrl = null;
    if (retiredBackgrounds[cachedUrl]) {
      cachedUrl = retiredBackgrounds[cachedUrl];
      localStorage.setItem(key, cachedUrl);
    }
    const url = cachedUrl || (!inParty && (backgrounds[localStorage.getItem(SOLO_MAP_STORAGE_KEY)] || backgrounds[1]));
    if (!url) return;
    document.body.style.backgroundImage = `url("${url}")`;
    document.body.dataset.lobbyBackgroundUrl = url;
  } catch {
    // Browsers can deny storage on this page.
  }
}

restoreBackground();
