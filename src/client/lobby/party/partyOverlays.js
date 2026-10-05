// Lobby party overlays: public party discovery and owner party settings.
import { escapeHtml, fetchLobbyJson, openOverlay, closeOverlay } from "../ui";
import { checkIfInParty, getPartyInteractionContext } from "./party.js";
import { sonner } from "../../ui/sonner.js";
import { showUiConfirm } from "../../ui/uiConfirm.js";
import { buildProfileIconAlt, buildProfileIconUrl } from "../../views/profileIconAssets.js";
import { resolveCharacterKey } from "../../../shared/characters/characterStats.js";
import {
  getMapLabel,
  getSelectionDisplayLabel,
  normalizeGameSelection,
} from "../../lib/gameSelectionCatalog.js";

let __partyDiscoveryState = {
  query: "",
  loading: false,
  lastResult: [],
};

let __partySettingsState = {
  isOwner: false,
  isPublic: false,
  publicName: "",
  visibilitySupported: true,
  allowMemberSelection: true,
  memberSelectionSupported: true,
};

export function getDiscoveryModeLabel(party) {
  const selection = normalizeGameSelection({
    modeId: party?.modeId,
    modeVariantId: party?.modeVariantId,
    mapId: party?.map,
  });
  return getSelectionDisplayLabel(selection);
}

function setPartyDiscoveryStatus(text, isError = false, count = null) {
  const status = document.getElementById("party-discovery-status");
  if (!status) return;
  status.replaceChildren();
  if (Number.isFinite(count) && count > 0) {
    const marker = document.createElement("span");
    marker.className = "party-discovery-count-marker";
    marker.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "party-discovery-count-label";
    label.textContent = `${count} public ${count === 1 ? "party" : "parties"} available`;
    status.append(marker, label);
  } else {
    status.textContent = text || "";
  }
  status.classList.toggle("is-error", isError);
  status.classList.toggle("has-count", Number.isFinite(count) && count > 0);
}

function renderPartyDiscoveryList(parties) {
  const container = document.getElementById("party-discovery-list");
  if (!container) return;
  container.innerHTML = "";

  if (!Array.isArray(parties) || parties.length === 0) {
    container.innerHTML =
      `<div class="party-discovery-empty">
        <div class="party-discovery-empty-icon" aria-hidden="true">
          <img src="/assets/ui/party-search-players.png" alt="" />
        </div>
        <div>
          <h3>No parties found</h3>
          <p>Try a different search or refresh to check for new parties.</p>
        </div>
      </div>`;
    return;
  }

  parties.forEach((party) => {
    const members = Array.isArray(party?.members) ? party.members : [];
    const capacity = Math.max(
      1,
      members.length,
      Number(party?.capacity) || members.length,
    );
    const card = document.createElement("article");
    card.className = "party-discovery-card";
    const partyTitle = String(party?.publicName || "").trim();
    const ownerName = String(party?.ownerName || "Unknown");
    card.innerHTML = `
      <div class="party-discovery-card-head">
        <div>
          <h3 class="party-discovery-title">${escapeHtml(
            partyTitle || `${ownerName}'s Party`,
          )}</h3>
          <div class="party-discovery-meta" title="${escapeHtml(ownerName)}">
            <img src="/assets/icons/crown.webp" alt="Owner" width="12" height="12" />
            <span>Hosted by ${escapeHtml(ownerName)}</span>
          </div>
        </div>
      </div>
      <button type="button" class="pixel-menu-button party-discovery-join" data-party-id="${Number(
        party?.partyId,
      )}">Join</button>
      <div class="party-discovery-info-row">
        <span class="party-discovery-detail"><span class="party-discovery-meta-label">Mode</span> ${escapeHtml(getDiscoveryModeLabel(party))}</span>
        <span class="party-discovery-detail"><span class="party-discovery-meta-label">Map</span> ${escapeHtml(getMapLabel(party?.map))}</span>
      </div>
      <div class="party-discovery-roster">
        <div class="party-discovery-meta-label">${members.length}/${capacity} players</div>
        <div class="party-discovery-members"></div>
      </div>
    `;

    const memberWrap = card.querySelector(".party-discovery-members");
    members.forEach((member) => {
      const name = String(member?.name || "Player");
      const charClass = resolveCharacterKey(member?.char_class);
      const profileIconId = String(member?.profile_icon_id || "") || null;
      const entry = document.createElement("div");
      entry.className = "party-discovery-member";
      entry.title = `${name} · ${charClass}`;
      entry.innerHTML = `
        <img src="${escapeHtml(buildProfileIconUrl(profileIconId, charClass))}" alt="${escapeHtml(
          buildProfileIconAlt(profileIconId, charClass),
        )}" />
        <div>
          <div class="party-discovery-member-name">${escapeHtml(name)}</div>
        </div>
      `;
      memberWrap?.appendChild(entry);
    });

    const joinBtn = card.querySelector(".party-discovery-join");
    joinBtn?.addEventListener("click", async () => {
      const targetPartyId = Number(joinBtn.dataset.partyId);
      if (!Number.isFinite(targetPartyId) || targetPartyId <= 0) return;
      const currentPartyId = Number(checkIfInParty());
      if (Number.isFinite(currentPartyId) && currentPartyId > 0) {
        const ok = await showUiConfirm({
          title: "Leave current party?",
          message:
            "Joining this party will move you out of your current party.",
          confirmLabel: "Join Party",
        });
        if (!ok) return;
      }
      window.location.href = `/party/${targetPartyId}`;
    });

    container.appendChild(card);
  });
}

async function loadPartyDiscovery(query = "") {
  if (__partyDiscoveryState.loading) return;
  __partyDiscoveryState.loading = true;
  setPartyDiscoveryStatus("Loading public parties...");
  try {
    const payload = await fetchLobbyJson("/party/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: String(query || "").trim() }),
    });
    if (payload?.visibilitySupported === false) {
      setPartyDiscoveryStatus(
        "Party discovery is unavailable until the latest DB migration is applied.",
        true,
      );
      renderPartyDiscoveryList([]);
      return;
    }
    const parties = Array.isArray(payload?.parties) ? payload.parties : [];
    __partyDiscoveryState.lastResult = parties;
    setPartyDiscoveryStatus("", false, parties.length);
    renderPartyDiscoveryList(parties);
  } catch (error) {
    setPartyDiscoveryStatus(
      error?.message || "Failed to load party list.",
      true,
    );
    renderPartyDiscoveryList([]);
  } finally {
    __partyDiscoveryState.loading = false;
  }
}

export async function openPartyDiscoveryOverlay() {
  const input = document.getElementById("party-discovery-input");
  const query = String(
    input?.value || __partyDiscoveryState.query || "",
  ).trim();
  __partyDiscoveryState.query = query;
  openOverlay("party-discovery-overlay");
  await loadPartyDiscovery(query);
}

function setPartySettingsStatus(text, isError = false) {
  const status = document.getElementById("party-settings-status");
  if (!status) return;
  status.textContent = text || "";
  status.classList.toggle("is-error", isError);
}

export function syncPartySettingsButtonVisibility(currentUserName) {
  const button = document.getElementById("party-settings-button");
  if (!button) return;
  const inParty = !!checkIfInParty();
  if (!inParty) {
    button.classList.add("hidden");
    return;
  }
  const context = getPartyInteractionContext();
  const isOwner =
    String(context?.ownerName || "") === String(currentUserName || "") && !!currentUserName;
  __partySettingsState.isOwner = isOwner;
  button.classList.toggle("hidden", !isOwner);
}

async function loadPartySettings() {
  const partyId = Number(checkIfInParty());
  if (!Number.isFinite(partyId) || partyId <= 0) return null;

  const payload = await fetchLobbyJson("/party/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partyId }),
  });

  __partySettingsState = {
    isOwner: !!payload?.isOwner,
    isPublic: !!payload?.isPublic,
    publicName: String(payload?.publicName || ""),
    visibilitySupported: payload?.visibilitySupported !== false,
    allowMemberSelection: payload?.allowMemberSelection !== false,
    memberSelectionSupported: payload?.memberSelectionSupported !== false,
  };

  const toggle = document.getElementById("party-public-toggle");
  const nameInput = document.getElementById("party-public-name");
  const saveBtn = document.getElementById("party-settings-save");
  const memberToggle = document.getElementById("party-member-selection-toggle");
  if (memberToggle) {
    memberToggle.checked = __partySettingsState.allowMemberSelection;
    memberToggle.disabled =
      !__partySettingsState.isOwner ||
      !__partySettingsState.memberSelectionSupported;
  }
  if (toggle) toggle.checked = __partySettingsState.isPublic;
  if (nameInput) nameInput.value = __partySettingsState.publicName;
  const canEdit =
    __partySettingsState.isOwner && __partySettingsState.visibilitySupported;
  if (toggle) toggle.disabled = !canEdit;
  syncPublicPartyNameVisibility();
  if (saveBtn) saveBtn.disabled = !canEdit;

  if (!__partySettingsState.visibilitySupported) {
    setPartySettingsStatus(
      "Party visibility requires the latest DB migration before this can be used.",
      true,
    );
  } else if (!__partySettingsState.memberSelectionSupported) {
    setPartySettingsStatus(
      "Map and mode permissions require the latest party migration.",
      true,
    );
  } else if (!__partySettingsState.isOwner) {
    setPartySettingsStatus(
      "Only the party owner can edit these settings.",
      true,
    );
  } else {
    setPartySettingsStatus("");
  }

  return payload;
}

export async function openPartySettingsOverlay() {
  if (!checkIfInParty()) return;
  openOverlay("party-settings-overlay");
  try {
    await loadPartySettings();
  } catch (error) {
    setPartySettingsStatus(
      error?.message || "Failed to load party settings.",
      true,
    );
  }
}

async function savePartySettings() {
  const partyId = Number(checkIfInParty());
  if (!Number.isFinite(partyId) || partyId <= 0) return;
  const toggle = document.getElementById("party-public-toggle");
  const nameInput = document.getElementById("party-public-name");
  const isPublic = !!toggle?.checked;
  const publicName = String(nameInput?.value || "").trim();

  if (isPublic && publicName.length < 3) {
    setPartySettingsStatus(
      "Public party names need at least 3 characters.",
      true,
    );
    return;
  }

  try {
    const payload = await fetchLobbyJson("/party/settings/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partyId,
        isPublic,
        publicName,
        ...(__partySettingsState.memberSelectionSupported
          ? {
              allowMemberSelection: !!document.getElementById(
                "party-member-selection-toggle",
              )?.checked,
            }
          : {}),
      }),
    });
    __partySettingsState.allowMemberSelection =
      payload?.settings?.allowMemberSelection !== false;
    __partySettingsState.isPublic = !!payload?.settings?.isPublic;
    __partySettingsState.publicName = String(
      payload?.settings?.publicName || "",
    );
    setPartySettingsStatus("Party settings updated.");
    sonner("Party settings updated", undefined, "success");
  } catch (error) {
    setPartySettingsStatus(error?.message || "Could not save settings.", true);
  }
}

function syncPublicPartyNameVisibility() {
  const toggle = document.getElementById("party-public-toggle");
  const isPublic = !!toggle?.checked;
  document
    .getElementById("party-public-name-group")
    ?.classList.toggle("hidden", !isPublic);
  const input = document.getElementById("party-public-name");
  if (input) input.disabled = !isPublic || !!toggle?.disabled;
}

export function wirePartyOverlayControls() {
  const discoveryClose = document.getElementById("party-discovery-close");
  discoveryClose?.addEventListener("click", () =>
    closeOverlay("party-discovery-overlay"),
  );
  document
    .querySelector("#party-discovery-overlay .trophy-overlay-backdrop")
    ?.addEventListener("click", () => closeOverlay("party-discovery-overlay"));

  const discoveryRefresh = document.getElementById("party-discovery-refresh");
  discoveryRefresh?.addEventListener("click", () => {
    const input = document.getElementById("party-discovery-input");
    __partyDiscoveryState.query = String(input?.value || "").trim();
    void loadPartyDiscovery(__partyDiscoveryState.query);
  });
  const discoveryInput = document.getElementById("party-discovery-input");
  discoveryInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    __partyDiscoveryState.query = String(discoveryInput.value || "").trim();
    void loadPartyDiscovery(__partyDiscoveryState.query);
  });

  const settingsClose = document.getElementById("party-settings-close");
  settingsClose?.addEventListener("click", () =>
    closeOverlay("party-settings-overlay"),
  );
  document
    .querySelector("#party-settings-overlay .trophy-overlay-backdrop")
    ?.addEventListener("click", () => closeOverlay("party-settings-overlay"));

  const settingsSave = document.getElementById("party-settings-save");
  settingsSave?.addEventListener("click", () => {
    void savePartySettings();
  });

  const partyPublicToggle = document.getElementById("party-public-toggle");
  partyPublicToggle?.addEventListener("change", syncPublicPartyNameVisibility);
}
