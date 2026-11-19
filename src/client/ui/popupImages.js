const warmedImages = new Map();
const WARM_IMAGE_LIMIT = 24;
const POPUP_IMAGE_WAIT_MS = 220;

export function warmPopupImages(sources, { background = false } = {}) {
  const connection = navigator.connection;
  if (background && (document.hidden || navigator.onLine === false ||
    connection?.saveData || /2g|3g/.test(connection?.effectiveType || ""))) return;

  for (const src of new Set(sources)) {
    if (!src || warmedImages.has(src)) continue;
    const image = new Image();
    if (background) image.fetchPriority = "low";
    image.onerror = () => {
      if (warmedImages.get(src) === image) warmedImages.delete(src);
    };
    warmedImages.set(src, image);
    if (warmedImages.size > WARM_IMAGE_LIMIT) {
      warmedImages.delete(warmedImages.keys().next().value);
    }
    image.src = src;
    image.decode?.().catch(() => {});
  }
}

// Let requested artwork decode before the entrance animation, with a short
// deadline so a slow or broken image cannot hold the popup closed.
export function waitForPopupImages(root) {
  const images = [...root.querySelectorAll("img[src]")].filter(image => image.decode);
  if (!images.length) return null;
  return new Promise(resolve => {
    const timer = window.setTimeout(resolve, POPUP_IMAGE_WAIT_MS);
    Promise.allSettled(images.map(image => image.decode())).then(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });
}
