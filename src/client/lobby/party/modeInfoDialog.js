// "How to play" dialog opened from the i button on each mode card in the mode
// picker. Uses the game's compact dialog frame (cs-confirm) so it shares the
// chroma header, pixel border, popup motion and focus trap with other popups.
import "./modeInfoDialog.css";
import { escapeHtml } from "../../../shared/site/html.cjs";
import { createModalFocus } from "../../ui/modalFocus.js";
import { dismissPopup } from "../../ui/popupMotion.js";
import { playSound } from "../../ui/uiSounds.js";

const FALLBACK_ART = "/assets/fightImage.webp";
let active = null;

export function closeModeInfoDialog() {
  active?.close();
}

export function openModeInfoDialog(mode) {
  if (!mode) return;
  active?.close({ instant: true });

  const details = Array.isArray(mode.details) && mode.details.length
    ? mode.details
    : [mode.description].filter(Boolean);
  const comingSoon = !mode.queueable;
  const titleId = `mode-info-title-${String(mode.id || "mode").replace(/[^a-z0-9-]/gi, "")}`;
  const art = mode.artAsset || mode.fallbackArtAsset || FALLBACK_ART;

  const backdrop = document.createElement("div");
  backdrop.className = "cs-confirm-backdrop mode-info-backdrop";
  backdrop.innerHTML = `
    <div class="cs-confirm mode-info-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="cs-confirm-title mode-info-head">
        <span id="${titleId}">${escapeHtml(mode.label || "Mode")}</span>
        <button type="button" class="mode-info-close bb-close pixel-menu-button" aria-label="Close">&times;</button>
      </div>
      <div class="mode-info-body">
        <div class="mode-info-art">
          <img src="${escapeHtml(art)}" alt="" draggable="false" />
          ${comingSoon ? '<span class="mode-info-ribbon">Coming soon</span>' : ""}
        </div>
        <div class="mode-info-copy">
          <h3 class="mode-info-heading">How to play</h3>
          ${details.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}
        </div>
      </div>
    </div>
  `;

  const dialog = backdrop.querySelector(".mode-info-dialog");
  const closeBtn = backdrop.querySelector(".mode-info-close");
  const img = backdrop.querySelector(".mode-info-art img");
  img.addEventListener("error", () => {
    const fallback = mode.fallbackArtAsset || FALLBACK_ART;
    if (!img.src.endsWith(fallback)) img.src = fallback;
  }, { once: true });

  let closed = false;
  const close = ({ instant = false } = {}) => {
    if (closed) return;
    closed = true;
    if (active?.close === close) active = null;
    const finish = () => {
      backdrop.remove();
      focus.deactivate();
    };
    if (instant) finish();
    else dismissPopup(backdrop, finish);
  };

  dialog.addEventListener("click", (event) => event.stopPropagation());
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  closeBtn.addEventListener("click", () => {
    playSound("cursor4", 0.24);
    close();
  });

  document.body.appendChild(backdrop);
  const focus = createModalFocus(dialog, {
    initialFocus: () => closeBtn,
    onEscape: () => close(),
  });
  focus.activate();
  active = { close };
  return close;
}
