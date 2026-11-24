// Progress for the lobby's first-load cover. Real milestones set a floor;
// between milestones the bar eases toward a ceiling so it keeps moving while
// a download or request is in flight, but never passes the next milestone.
// State lives on the element so lobbyPaint and the lobby bundle share it.
const TICK_MS = 120;
const EASE_PER_TICK = 0.06;

function getCover() {
  const loading = document.getElementById("lobby-loading");
  return loading && !loading.hidden && loading.isConnected ? loading : null;
}

function render(loading, value) {
  const pct = Math.round(value);
  const fill = loading.querySelector(".loading-fill");
  const percent = loading.querySelector(".lobby-loading-percent");
  if (fill) fill.style.width = `${pct}%`;
  if (percent) percent.textContent = `${pct}%`;
}

function ensureTicker(loading) {
  if (loading.dataset.progressTicking) return;
  loading.dataset.progressTicking = "true";
  const timer = window.setInterval(() => {
    if (!getCover() || loading.hasAttribute("data-leaving")) {
      window.clearInterval(timer);
      delete loading.dataset.progressTicking;
      return;
    }
    const value = Number(loading.dataset.progress) || 0;
    const ceiling = Number(loading.dataset.progressCeiling) || value;
    if (ceiling - value < 0.2) return;
    const next = value + (ceiling - value) * EASE_PER_TICK;
    loading.dataset.progress = String(next);
    render(loading, next);
  }, TICK_MS);
}

/** Reach at least `floor` now, then drift toward `ceiling` until the next milestone. */
export function setLobbyLoadingProgress(floor, ceiling = floor) {
  const loading = getCover();
  if (!loading) return;
  const clamp = n => Math.min(100, Math.max(0, Number(n) || 0));
  const current = Number(loading.dataset.progress) || 0;
  const value = Math.max(current, clamp(floor));
  loading.dataset.progress = String(value);
  loading.dataset.progressCeiling = String(Math.max(value, clamp(ceiling)));
  render(loading, value);
  if (value < 100) ensureTicker(loading);
}
