// Context menu on a lobby party slot (profile, friend, kick, promote).
import { profileFetchJson } from "../ui";
import { getPartyInteractionContext } from "./party.js";
import { sonner } from "../../ui/sonner.js";

let partySlotMenu = null;

function ensurePartySlotMenu() {
  if (partySlotMenu) return partySlotMenu;
  const menu = document.createElement("div");
  menu.className = "profile-slot-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Player actions");
  menu.hidden = true;
  menu.innerHTML = `
    <div class="profile-slot-menu-pointer" aria-hidden="true"></div>
    <div class="profile-slot-menu-head">
      <span class="profile-slot-menu-eyebrow">Player actions</span>
      <strong id="party-slot-menu-name">Player</strong>
    </div>
    <div class="profile-slot-menu-actions">
      <button type="button" role="menuitem" class="profile-slot-menu-btn view pixel-menu-button" data-action="view">
        <span class="profile-slot-menu-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 2c-3.8 0-6.4 3.3-7 5 1 2.2 3.5 5 7 5s6-2.8 7-5c-.7-1.7-3.2-5-7-5Zm0 8.2A3.2 3.2 0 1 1 8 3.8a3.2 3.2 0 0 1 0 6.4Zm0-1.8A1.4 1.4 0 1 0 8 5.6a1.4 1.4 0 0 0 0 2.8Z"/></svg></span>
        <span>View Profile</span>
      </button>
      <button type="button" role="menuitem" class="profile-slot-menu-btn view pixel-menu-button" data-action="friend">
        <span class="profile-slot-menu-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M6 7.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM0 14c0-2.5 2.7-4.5 6-4.5s6 2 6 4.5v1H0v-1Zm13-9h1.5v2h2v1.5h-2v2H13v-2h-2V7h2V5Z"/></svg></span>
        <span class="profile-slot-menu-friend-label">Add Friend</span>
      </button>
      <button type="button" role="menuitem" class="profile-slot-menu-btn owner pixel-menu-button" data-action="owner">
        <span class="profile-slot-menu-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m2 5 3 2 3-5 3 5 3-2-1 7H3L2 5Zm1 8h10v2H3v-2Z"/></svg></span>
        <span>Make Owner</span>
      </button>
      <button type="button" role="menuitem" class="profile-slot-menu-btn kick pixel-menu-button" data-action="kick">
        <span class="profile-slot-menu-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.1 1.7 8 6.6l4.9-4.9 1.4 1.4L9.4 8l4.9 4.9-1.4 1.4L8 9.4l-4.9 4.9-1.4-1.4L6.6 8 1.7 3.1l1.4-1.4Z"/></svg></span>
        <span>Kick Player</span>
      </button>
    </div>
  `;
  document.body.appendChild(menu);
  document.addEventListener("click", (event) => {
    if (menu.hidden) return;
    if (menu.contains(event.target)) return;
    menu.hidden = true;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      menu.hidden = true;
    }
  }, true);
  menu.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const actions = Array.from(
      menu.querySelectorAll('.profile-slot-menu-btn:not([hidden])'),
    );
    const currentIndex = actions.indexOf(document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + step + actions.length) % actions.length;
    event.preventDefault();
    actions[nextIndex]?.focus();
  });
  partySlotMenu = menu;
  return menu;
}

async function handlePartyMemberAction(action, playerName, profilePopup) {
  const party = getPartyInteractionContext();
  const partyId = Number(party.partyId);
  if (!action || !playerName) return;
  if (action === "view") {
    await profilePopup?.open?.({ username: playerName });
    return;
  }
  if (!Number.isFinite(partyId) || partyId <= 0) return;
  const endpoint =
    action === "owner"
      ? "/party/make-owner"
      : action === "kick"
        ? "/party/kick"
        : "";
  if (!endpoint) return;
  try {
    await profileFetchJson(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partyId, targetName: playerName }),
    });
    sonner(
      null,
      action === "owner"
        ? `${playerName} is now the party owner.`
        : `${playerName} was kicked from the party.`,
      "success",
    );
  } catch (err) {
    sonner(
      action === "owner"
        ? "Could not transfer ownership"
        : "Could not kick player",
      err?.message || "Please try again.",
      "error",
    );
  }
}

export function openPartySlotMenu(slot, anchorEvent, { profilePopup, currentUserName: userName, friendsController }) {
  const menu = ensurePartySlotMenu();
  const playerName = String(slot?.dataset?.playerName || "").trim();
  if (!playerName) return;
  const currentUserName = String(userName || "");
  const party = getPartyInteractionContext();
  const isOwner = String(party.ownerName || "") === currentUserName;
  const isSelf = playerName === currentUserName;
  const ownerBtn = menu.querySelector('[data-action="owner"]');
  const kickBtn = menu.querySelector('[data-action="kick"]');
  const viewBtn = menu.querySelector('[data-action="view"]');
  const title = menu.querySelector("#party-slot-menu-name");
  if (title) {
    title.textContent = playerName;
    if (playerName === party.ownerName) {
      const crown = document.createElement("img");
      crown.src = "/assets/icons/crown.webp";
      crown.alt = "Party owner";
      crown.className = "profile-slot-menu-crown";
      title.appendChild(crown);
    }
  }
  if (viewBtn) {
    viewBtn.hidden = false;
    viewBtn.onclick = async () => {
      menu.hidden = true;
      await handlePartyMemberAction("view", playerName, profilePopup);
    };
  }
  const friendBtn = menu.querySelector('[data-action="friend"]');
  if (friendBtn) {
    const relation = friendsController.relationshipFor(playerName);
    const isGuestName = /^Guest[A-Za-z0-9]{6}$/.test(playerName);
    friendBtn.hidden = isSelf || isGuestName || relation === "unavailable" || relation === "friends";
    friendBtn.disabled = relation === "outgoing";
    const label = friendBtn.querySelector(".profile-slot-menu-friend-label");
    if (label) {
      label.textContent =
        relation === "outgoing" ? "Request Pending"
          : relation === "incoming" ? "Accept Friend"
            : "Add Friend";
    }
    friendBtn.onclick = async () => {
      menu.hidden = true;
      await friendsController.addFriend({ username: playerName });
    };
  }
  if (ownerBtn) {
    ownerBtn.hidden = !isOwner || isSelf;
    ownerBtn.onclick = async () => {
      menu.hidden = true;
      await handlePartyMemberAction("owner", playerName, profilePopup);
    };
  }
  if (kickBtn) {
    kickBtn.hidden = !isOwner || isSelf;
    kickBtn.onclick = async () => {
      menu.hidden = true;
      await handlePartyMemberAction("kick", playerName, profilePopup);
    };
  }
  const anchorRect = slot.getBoundingClientRect();
  const viewportGap = 12;
  const anchorGap = 14;
  menu.style.visibility = "hidden";
  menu.hidden = false;
  const menuRect = menu.getBoundingClientRect();
  const fitsRight = anchorRect.right + anchorGap + menuRect.width <= window.innerWidth - viewportGap;
  const left = fitsRight
    ? anchorRect.right + anchorGap
    : anchorRect.left - menuRect.width - anchorGap;
  const top = anchorRect.top + Math.min(anchorRect.height * 0.34, 54);
  menu.dataset.side = fitsRight ? "right" : "left";
  menu.style.left = `${Math.max(viewportGap, Math.min(left, window.innerWidth - menuRect.width - viewportGap))}px`;
  menu.style.top = `${Math.max(viewportGap, Math.min(top, window.innerHeight - menuRect.height - viewportGap))}px`;
  menu.style.visibility = "";
}
