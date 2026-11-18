import { getSettings, subscribeSettings } from "../../../site/preferences";
import { keyLabel } from "../../../site/keyBindings.mjs";
import { worldToPage } from "../../scene/screenSpace";
import { resolvePurchaseSettings } from "../../../../shared/bankBustSettings.js";

export function createPurchasePrompt({
  promptUi,
  state,
  scene,
  formatCoins,
  currentLocalPlayer,
  getLocalTeam,
  DEFAULT_PURCHASE_FLOOR,
  getLayout,
  getModeObjectState,
}) {
  let interactKey = keyLabel(getSettings().keys.interact);
  const disposePrompt = subscribeSettings((settings) => {
    interactKey = keyLabel(settings.keys.interact);
  });

  function setPrompt(prompt = null) {
    const node = promptUi.prompt;
    if (!prompt?.action) {
      if (!state.promptSignature) return;
      node.classList.remove("open", "blocked");
      node.replaceChildren();
      state.promptSignature = "";
      return;
    }
    // Pinned over the slot it is talking about. Without an anchor it would
    // still be drawn, just off the top-left corner, so fall back to the old
    // bottom-centre position rather than losing the prompt entirely.
    const anchor =
      Number.isFinite(prompt.worldX) && Number.isFinite(prompt.worldY)
        ? worldToPage(scene, prompt.worldX, prompt.worldY)
        : null;
    if (anchor) {
      node.style.left = `${Math.round(anchor.x)}px`;
      node.style.top = `${Math.round(anchor.y)}px`;
    } else {
      node.style.left = "50%";
      node.style.top = `${Math.round((window.innerHeight || 0) - 120)}px`;
    }
    const signature = `${prompt.key || ""}|${prompt.action}|${prompt.cost ?? ""}|${prompt.blocked ? 1 : 0}`;
    node.classList.add("open");
    node.classList.toggle("blocked", !!prompt.blocked);
    if (state.promptSignature === signature) return;
    state.promptSignature = signature;
    const parts = [];
    if (prompt.key) {
      const key = document.createElement("span");
      key.className = "bb-key";
      key.textContent = prompt.key;
      parts.push(key);
    }
    const action = document.createElement("span");
    action.className = "bb-act";
    action.textContent = prompt.action;
    // Name over price, so the cap on the left reads as the key for both.
    const lines = document.createElement("span");
    lines.className = "bb-lines";
    lines.append(action);
    parts.push(lines);
    if (Number.isFinite(prompt.cost)) {
      const cost = document.createElement("span");
      cost.className = "bb-cost";
      const coin = document.createElement("span");
      coin.className = "bb-coin";
      cost.append(coin, document.createTextNode(formatCoins(prompt.cost)));
      lines.append(cost);
    }
    node.replaceChildren(...parts);
  }

  function computeInteractPrompt(modeState) {
    const localPlayer = currentLocalPlayer();
    if (!localPlayer || localPlayer.dead || !localPlayer.body) return null;
    const team = getLocalTeam();
    if (!team) return null;
    // Purchases are paid out of your own vault, and cannot take it below the
    // floor, so the prompt quotes both.
    const vaultCoins = Math.max(0, Number(modeState?.vaults?.[team]?.coins) || 0);
    const floorCoins = modeState?.purchaseFloorCoins ?? DEFAULT_PURCHASE_FLOOR;
    const canAfford = (cost) => vaultCoins > cost && vaultCoins - cost >= floorCoins;
    let best = null;
    for (const entry of Array.isArray(getLayout()?.objects) ? getLayout().objects : []) {
      if (entry?.type !== "claimableTurret" && entry?.type !== "wallSlot") continue;
      const dx = (Number(entry?.x) || 0) - localPlayer.x;
      const dy = (Number(entry?.y) || 0) - localPlayer.y;
      const distance = Math.hypot(dx, dy);
      // Match the server's own reach, so the prompt appears exactly where
      // the configured interaction key works.
      const runtime = getModeObjectState(modeState, entry.id);
      const settings = resolvePurchaseSettings(entry.type, entry, runtime?.state);
      const radius = entry.type === "claimableTurret" ? settings.claimRadius : settings.buildRadius;
      if (distance > radius) continue;
      if (!best || distance < best.distance) best = { entry, distance, settings, runtime };
    }
    if (!best) return null;
    // Hung a little above the slot, clear of a character standing on it.
    const worldX = Number(best.entry?.x) || 0;
    const worldY = (Number(best.entry?.y) || 0) - (Number(best.entry?.height) || 64) / 2 - 18;
    const buy = (action, cost, owned) => {
      if (owned) return { action, worldX, worldY };
      return {
        key: canAfford(cost) ? interactKey : null,
        action,
        cost,
        worldX,
        worldY,
        blocked: !canAfford(cost),
      };
    };
    if (best.entry.type === "claimableTurret") {
      return buy("Turret", best.settings.claimCost, best.runtime?.state?.claimedByTeam === team);
    }
    return buy("Wall", best.settings.cost, best.runtime?.state?.builtByTeam === team);
  }

  return { setPrompt, computeInteractPrompt, disposePrompt };
}

export function createPromptHost() {
  const host = document.createElement("div");
  host.id = "bank-bust-prompt-host";
  host.innerHTML = `

    <div id="bank-bust-interact-prompt"></div>
  `;
  document.body.appendChild(host);
  return { host, prompt: host.querySelector("#bank-bust-interact-prompt") };
}
