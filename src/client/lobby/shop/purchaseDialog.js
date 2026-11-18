import { escapeHtml } from "../../../shared/site/html.cjs";
import { mountUiConfirm } from "../../ui/uiConfirm.js";
import { dismissPopup } from "../../ui/popupMotion.js";
import { safeCssToken, currencyIcon, grantLabel, grantArtMarkup } from "./shopMarkup.js";

// Keep the backdrop visible until a purchase hands off to the reward reveal.
export function purchaseDialog(title, content, confirm = "", { headerClose = false, onPack, holdOnConfirm = false } = {}) {
  return new Promise(resolve => {
    const body = document.createElement("template");
    body.innerHTML = content;
    const header = document.createElement(headerClose ? "header" : "h2");
    header.textContent = title;
    let actions;
    if (headerClose) {
      header.classList.add("purchase-dialog-header");
      const heading = document.createElement("h2");
      heading.textContent = title;
      header.innerHTML = '<button type="button" class="bb-close pixel-menu-button" data-dismiss aria-label="Close">×</button>';
      header.prepend(heading);
    } else {
      actions = document.createElement("div");
      actions.innerHTML = `<button type="button" class="cs-btn cancel pixel-menu-button" data-dismiss>${confirm ? "Cancel" : "Close"}</button>
        ${confirm ? `<button type="button" class="cs-btn confirm pixel-menu-button" data-confirm>${confirm}</button>` : ""}`;
    }
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      modal.deactivate();
      backdrop.remove();
      resolve(value);
    };
    const handOff = () => {
      if (settled) return;
      settled = true;
      modal.deactivate();
      backdrop.classList.add("is-handing-off");
      let released = false;
      resolve({
        release({ instant = false } = {}) {
          if (released) return;
          released = true;
          if (instant) backdrop.remove();
          else dismissPopup(backdrop, () => backdrop.remove());
        },
      });
    };
    const modal = mountUiConfirm({
      title, headerNode: header, bodyNode: body.content, actionsNode: actions,
      variant: "cs-purchase-confirm purchase-review",
      onDismiss: () => finish(null),
    });
    const { backdrop } = modal;
    let reviewingPack = false;
    backdrop.addEventListener("click", async event => {
      if (settled) return;
      const button = event.target.closest("button");
      if (button?.hasAttribute("data-dismiss")) finish(null);
      else if (button?.hasAttribute("data-confirm")) (holdOnConfirm ? handOff() : finish(true));
      else if (button?.dataset.pack && !reviewingPack) {
        reviewingPack = true;
        try {
          const missing = await onPack(button);
          if (missing <= 0) finish(null);
          else backdrop.querySelector("[data-shortfall]").textContent = missing.toLocaleString();
        } finally {
          reviewingPack = false;
        }
      }
    });
  });
}

export function purchaseReviewMarkup(item) {
  const grants = item.grants || [];
  const rewards = grants.map(grant => {
    const tint = grant.kind === "currency"
      ? `reward-tint-${safeCssToken(grant.currency)}`
      : `shop-rarity-${safeCssToken(grant.rarity || item.rarity || "common")}`;
    // Titles render their own nameplate, so they skip the caption.
    const caption = grant.kind === "title" ? "" : `<strong>${grant.kind === "currency" ? currencyIcon(grant.currency) : ""} ${escapeHtml(grantLabel(grant, { signed: true }))}</strong>`;
    return `<li class="purchase-grant ${tint} purchase-grant-${safeCssToken(grant.kind)}"><div class="purchase-stage">${grantArtMarkup(grant)}</div>${caption}</li>`;
  }).join("");
  return `${grants.length > 1 ? `<h3>${escapeHtml(item.name)}</h3>` : ""}<ul class="purchase-grants">${rewards}</ul>`;
}
