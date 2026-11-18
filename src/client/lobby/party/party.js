import { BROWSER_EVENTS } from "../../lib/browserEvents.js";
import { getUser } from "../session.mjs";
import { getNavigation } from "../../lib/globals.cjs";
import { API_PATHS } from "../../../shared/net/apiPaths.js";
import { postJson } from "../../lib/http.js";
import { getActivePartyId, getCurrentLobbyUserName, getCurrentPartyMember, getLobbyMemberKey, partyContext, replacePartyContext } from "./partyState.js";
import { MAINTENANCE_MESSAGE } from "../../../shared/site/maintenance";
import { warmBattleSelection } from '../preloadBattle';
import { createMatchmakingClient } from "../matchmaking/matchmakingClient.mjs";
import { createMatchmakingOverlay } from "../matchmaking/matchmakingOverlay.js";
import { setPartyButtonLabel } from "./partyButtonLabel.js";
import { sonner } from "../../ui/sonner.js";
import socket from "../../lib/socket";
import { wireFullscreenToggles } from "../../ui/fullscreen.js";
import { getTotalPlayersForSelection, normalizeGameSelection } from "../../lib/gameSelectionCatalog.js";
import { MATCH_ID_KEY } from "../../lib/storageKeys.js";
import "../../styles/levelBadge.css";
import { collectCurrentPartyMembers, createPartyRoster } from "./partyRoster.js";
import { createReadyController } from "./readyController.js";
import { consumeBattleLobbyReturnFlag, createPartySocket } from "./partySocket.js";
import { createSelectionPickers, getCurrentSelection } from "./selectionPickers.js";
import { syncInviteBadges } from "./partyInvites.js";

wireFullscreenToggles();
getNavigation()?.lobbyAudio?.enterLobby();

const pickers = createSelectionPickers({
  syncReadyAvailability: selection => ready.syncReadyAvailability(selection),
});
const roster = createPartyRoster({
  isQueued: () => matchmaking.isQueued(),
  isInBattle: () => ready.isInBattle(),
  syncSelectionPickers: pickers.syncSelectionPickers,
});
const ready = createReadyController({ getMatchmaking: () => matchmaking, renderPartyMembers: roster.renderPartyMembers });

const matchmaking = createMatchmakingClient({
  socket,
  view: createMatchmakingOverlay(),
  selection: {
    normalize: normalizeGameSelection,
    totalPlayers: getTotalPlayersForSelection,
    current: getCurrentSelection,
  },
  party: {
    activeId: getActivePartyId,
    players: collectCurrentPartyMembers,
    currentTeam: () => getCurrentPartyMember()?.team || null,
    setBotSlots: (botSlots) => { partyContext.botSlots = botSlots; },
  },
  memberKey: getLobbyMemberKey,
  selfKey: () => getLobbyMemberKey(getCurrentLobbyUserName()),
  onReadyReset: ready.resetSelfReadyState,
  warmBattle: warmBattleSelection,
  notify: sonner,
  maintenanceMessage: MAINTENANCE_MESSAGE,
  audio: () => getNavigation()?.lobbyAudio,
  isAdmin: () => !!getUser()?.isAdmin,
  navigate: (url) => { window.location.href = url; },
  prefetchMatch: (matchId) => getNavigation()?.prefetchRoute?.(`/game/${matchId}`),
  rememberMatch: (matchId) => sessionStorage.setItem(MATCH_ID_KEY, matchId),
  dispatchStart: () => window.dispatchEvent(new CustomEvent(BROWSER_EVENTS.MATCHMAKING_START)),
  suppressed: consumeBattleLobbyReturnFlag(),
});

const partySocket = createPartySocket({ matchmaking, pickers, ready, roster });

export { bindInviteBadgeClicks } from "./partyInvites.js";
export { ensurePartyPixelFrame } from "./partyRoster.js";
export { checkIfInParty, getPartyInteractionContext } from "./partyState.js";
export const { socketInit, showPartyJoinRequestScreen, hidePartyJoinRequestScreen } = partySocket;
export const { initializeModeDropdown, writeSelectionToDom: applyLobbySelection } = pickers;
export const { initReadyToggle } = ready;
export const { renderPartyMembers } = roster;

// Switching lobby routes preserves the screen and socket connection.
export function resetLobbyRoute(partyId) {
  partyDeparturePending = false;
  ready.resetReadyRequest();
  partySocket.resetRosterNotifications(partyId);
  roster.resetRosterRender();
  replacePartyContext(partyId);
  hidePartyJoinRequestScreen();
  syncInviteBadges();
  ready.setReadyButtonState(false);
}

export function createParty() {
  const button = document.getElementById('create-party');
  if (button?.disabled) return;
  if (button) { button.disabled = true; setPartyButtonLabel(button, 'Creating…'); }
  const selection = normalizeGameSelection(getCurrentSelection());
  postJson(API_PATHS.CREATE_PARTY, { selection }, { fallbackMessage: "Failed to create party" })
    .then((data) => {
      window.location.href = `/party/${data.partyId}`;
    })
    .catch((error) => {
      console.error("Error:", error);
      if (button) { button.disabled = false; setPartyButtonLabel(button, 'Create Party'); }
    });
}

let partyDeparturePending = false;

export async function leaveParty() {
  if (partyDeparturePending) return;
  partyDeparturePending = true;
  const leaveButton = document.getElementById("create-party");
  const previousLabel = leaveButton?.textContent;
  if (leaveButton) { leaveButton.disabled = true; setPartyButtonLabel(leaveButton, "Leaving…"); }

  try {
    await postJson(API_PATHS.LEAVE_PARTY, undefined, {
      headers: { "Content-Type": "application/json" },
      fallbackMessage: "Unable to leave the party",
    });
    window.location.href = `/`;
  } catch (error) {
    console.error("Error:", error);
    partyDeparturePending = false;
    if (leaveButton) { leaveButton.disabled = false; setPartyButtonLabel(leaveButton, previousLabel); }
    sonner(
      "Could not leave party",
      error?.message || "Please try again.",
      "error",
    );
  }
}
