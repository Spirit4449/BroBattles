import { checkIfInParty } from "./partyState.js";
import { sonner } from "../../ui/sonner.js";

export function syncInviteBadges() {
  const inParty = !!checkIfInParty();
  document.querySelectorAll("#lobby-area .status.invite").forEach((badge) => {
    badge.style.display = inParty ? "" : "none";
    badge.style.cursor = inParty ? "pointer" : "default";
  });
}

export function bindInviteBadgeClicks(lobby) {
  if (!lobby || lobby.dataset.inviteClicksBound === "1") return;
  lobby.dataset.inviteClicksBound = "1";
  lobby.addEventListener("click", async event => {
    const badge = event.target?.closest?.(".status.invite");
    if (!badge || !checkIfInParty() || !navigator.clipboard) return;
    const inviteLink = window.location.href;
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch (error) {
      console.warn("Failed to copy party invite:", error);
      return;
    }
    if (!badge.classList.contains("invite") || window.location.href !== inviteLink) return;
    if (badge.dataset.inviteFeedback === "inline") {
      badge.textContent = "Copied!";
      window.setTimeout(() => {
        if (badge.classList.contains("invite") && badge.textContent === "Copied!") badge.textContent = "Invite";
      }, 1000);
    } else {
      sonner(null, "Party invite link copied. Share it with your friends.", undefined, undefined, { duration: 2000 });
    }
  });
}
