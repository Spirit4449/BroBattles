import { createPlayerCardTile } from "../../src/lib/playerCardTile.js";
import { renderCharacterStatus } from "../../src/lobby/characterStatusView.js";
import { createModalFocus } from "../../src/lib/modalFocus.js";
import { getSharedSelectionPopupShell } from "../../src/lib/selectionPopupShell.js";
import { createViewersPopup } from "../../src/chat/viewersPopup.js";
import { showUiConfirm } from "../../src/lib/uiConfirm.js";

function check(condition, message) {
  if (!condition) throw new Error(message);
}
function key(value, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true });
  document.activeElement.dispatchEvent(event);
  return event;
}
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));

window.htmlSmoke = {
  async run() {
    const results = [];
    const malicious = '<img src=x onerror="window.injected=true"> & "quoted"';
    for (const lobby of [false, true]) {
      const card = createPlayerCardTile({ name: malicious, id: malicious, rarity: 'rare" onclick="oops', assetUrl: '/assets/x.webp" onerror="window.injected=true' }, { lobby });
      document.body.append(card);
      check(card.querySelectorAll("img").length === 1, "card name created an image");
      check(card.querySelector("strong").textContent === malicious, "card name was corrupted");
      check(card.querySelector("button").dataset.cardId === malicious, "card ID was corrupted");
      check(!card.querySelector("[onerror], [onclick]"), "card interpolation created a handler");
      check(card.querySelector("button").type === "button", "card button submits forms");
      card.remove();
    }
    check(createPlayerCardTile({}, { selected: true }).querySelector("button").disabled, "selected card is actionable");
    results.push("safe profile cards");

    const status = document.createElement("div");
    renderCharacterStatus(status, { isLocked: true, stats: { unlockPrice: malicious } });
    check(status.querySelectorAll("img").length === 1 && status.textContent.includes("0"), "invalid price injected markup");
    renderCharacterStatus(status, { isMaxed: true });
    check(status.classList.contains("maxed"), "maxed state missing");
    renderCharacterStatus(status, { price: 100 });
    check(!status.classList.contains("maxed") && status.classList.contains("upgradable"), "stale status class");
    renderCharacterStatus(status, { isLocked: true, stats: { unlockMethod: { type: "trophyRoad", min: 1500 } } });
    check(status.textContent.includes((1500).toLocaleString()) && !status.classList.contains("upgradable"), "trophy status incorrect");
    results.push("character status transitions");

    const trigger = document.getElementById("trigger");
    trigger.focus();
    const shell = getSharedSelectionPopupShell();
    const content = document.createElement("div");
    content.innerHTML = '<button disabled>Disabled</button><button hidden>Hidden</button><button id="last">Last</button>';
    shell.mount({ titleText: "Choose", contentNode: content, onClose: () => shell.hide() }).show();
    const last = content.querySelector("#last");
    check(document.activeElement === shell.closeButton, "picker did not take focus");
    check(shell.popup.getAttribute("aria-labelledby") === shell.title.id, "picker title not linked");
    check(shell.closeButton.getAttribute("aria-label"), "close button lacks a label");
    key("Tab", true);
    check(document.activeElement === last, "reverse Tab did not wrap past hidden controls");
    key("Tab");
    check(document.activeElement === shell.closeButton, "Tab did not wrap");
    document.getElementById("outside").focus();
    check(document.activeElement === shell.closeButton, "focus escaped picker");

    last.focus();
    const detail = document.createElement("div");
    detail.innerHTML = '<button>Close details</button>';
    document.body.append(detail);
    const nested = createModalFocus(detail, { onEscape: () => { detail.remove(); nested.deactivate(); } });
    nested.activate();
    key("Escape");
    check(!detail.isConnected && !shell.overlay.classList.contains("is-hidden"), "Escape closed underlying picker");
    check(document.activeElement === last, "nested close did not return focus");

    const confirmation = showUiConfirm({ title: "Confirm" });
    check(document.activeElement.closest('[role="dialog"]').classList.contains("cs-confirm"), "confirmation cannot receive focus above picker");
    key("Escape");
    check(await confirmation === false, "Escape did not cancel confirmation");
    check(document.activeElement === last, "confirmation did not return focus");

    const native = document.createElement("dialog");
    native.innerHTML = '<button>Native dialog</button>';
    document.body.append(native);
    native.showModal();
    check(document.activeElement === native.querySelector("button"), "picker stole native modal focus");
    native.close();
    native.remove();
    key("Escape");
    check(document.activeElement === trigger, "picker did not restore trigger");
    results.push("nested modal keyboard and focus behavior");

    shell.show();
    const replacement = document.createElement("div");
    replacement.innerHTML = '<button>New selection</button>';
    shell.mount({ contentNode: replacement }).show();
    check(shell.popup.contains(document.activeElement), "remount lost focus");
    shell.hide();
    results.push("picker remount");

    trigger.focus();
    const removedDialog = document.createElement("div");
    removedDialog.innerHTML = "<button>Temporary</button>";
    document.body.append(removedDialog);
    createModalFocus(removedDialog).activate();
    removedDialog.remove();
    await tick(0);
    document.getElementById("outside").focus();
    check(document.activeElement.id === "outside", "removed dialog kept its focus trap");
    check(!key("Tab").defaultPrevented, "removed dialog intercepted keyboard navigation");
    results.push("navigation cleanup");

    trigger.focus();
    let openedName;
    const viewers = createViewersPopup({ getCurrentUserName: () => "Me", onOpenProfile: name => { openedName = name; document.getElementById("outside").focus(); } });
    viewers.open({ viewers: [{ name: malicious, readAt: Date.now(), charClass: "ninja" }] }, trigger);
    const viewerCard = document.querySelector(".bb-chat-viewers-card");
    const viewerClose = viewerCard.querySelector("button");
    check(!viewerCard.querySelector("[onerror]"), "viewer name injected markup");
    key("Tab", true);
    check(document.activeElement !== viewerClose && viewerCard.contains(document.activeElement), "viewer reverse Tab failed");
    key("Tab");
    check(document.activeElement === viewerClose, "viewer forward Tab failed");
    viewerCard.querySelector(".bb-chat-viewer-name").click();
    check(openedName === malicious, "profile action lost username");
    await tick(150);
    check(document.activeElement.id === "outside", "closing viewer stole profile focus");
    viewers.open({ viewers: [] }, trigger);
    key("Escape");
    await tick(150);
    check(!viewers.isOpen() && document.activeElement === trigger, "viewer Escape/focus restore failed");
    viewers.destroy();
    document.getElementById("outside").focus();
    check(document.activeElement.id === "outside", "destroy left a focus trap");
    results.push("viewer keyboard, profile handoff, and cleanup");
    check(!window.injected, "HTML injection executed");
    return results;
  },
};
