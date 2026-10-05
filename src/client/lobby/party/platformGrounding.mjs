// Standing surface at the center of each 638px-wide platform image.
const SURFACES = {
  '/assets/lushy/lobbyPlatform.webp': 32,
  '/assets/mangrove/lobbyPlatform.webp': 100,
  '/assets/serenity/lobbyPlatform.webp': 54,
  '/assets/bank-bust/lobbyPlatform.webp': 4,
};

export function platformSurfaceOffset(backgroundImage, width) {
  const entry = Object.entries(SURFACES).find(([url]) => backgroundImage.includes(url));
  return width * (entry?.[1] ?? 0) / 638;
}

let observer;
let pending = false;
export function refreshPlatformGrounding() {
  if (pending) return;
  pending = true;
  queueMicrotask(() => {
    pending = false;
    const align = element => {
      const offset = platformSurfaceOffset(getComputedStyle(element).backgroundImage, element.clientWidth);
      element.style.setProperty('--platform-surface-offset', `${offset}px`);
    };
    observer ||= new ResizeObserver(entries => entries.forEach(({ target }) => align(target)));
    // Drop removed matchmaking slots and observe the current responsive layout.
    observer.disconnect();
    document.querySelectorAll('.platform-image, .mm-platform').forEach(element => {
      align(element);
      observer.observe(element);
    });
  });
}
