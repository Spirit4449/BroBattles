import { SOCKET_EVENTS } from "../../../shared/net/socketEvents.js";
import { checkIfInParty, getActivePartyId, getCurrentLobbyUserName, getCurrentPartyMember, getLobbyMemberKey, partyContext, replacePartyContext } from "./partyState.js";
import { SLOT_SELECTOR, slotField } from "./slotDom.js";
import { warmBattleSelection } from '../preloadBattle';
import { revealLobby } from "../lobbyReveal.js";
import { playPartyMoveEffect } from "./partyMoveEffect.js";
import { createPartySlotDrag } from "./partySlotDrag.js";
import { sonner } from "../../ui/sonner.js";
import socket from "../../lib/socket";
import { bodyDisplayUrl, buildCharacterSkinBodyUrl } from "../../views/skinAssets.js";
import { DEFAULT_CHARACTER, resolveCharacterKey, parseCharacterLevels, getCharacterDisplayName } from "../../../shared/characters/characterStats.js";
import { setSlotLevelBadge } from "../../views/levelBadgeView.js";
import {
  applyLobbyStatusVisualState,
  clearLobbySpawnAnimation,
  ensureLobbySelectingRing,
  getLobbySpawnTimeRemaining,
  normalizeStatusLabel,
  playLobbySpawnAnimation,
  prefersReducedLobbyMotion,
  statusToClass,
  triggerLobbyCharacterSplash,
} from "./slotEffects.js";
import { getBotSlotTarget } from "./botSlotPicker.js";
import { getPlayersPerTeamForSelection, normalizeGameSelection } from "../../lib/gameSelectionCatalog.js";
import { getCurrentSelection } from "./selectionPickers.js";
import { updatePlatformsForMode } from "./partyPlatforms.js";
import { syncInviteBadges } from "./partyInvites.js";

function getMemberLevel(member) {
  if (!member) return null;
  if (Number.isFinite(Number(member.level))) {
    return Math.max(1, Number(member.level));
  }
  const charClass = resolveCharacterKey(member.char_class);
  const levels = parseCharacterLevels(member.char_levels);
  return Math.max(1, Number(levels?.[charClass]) || 1);
}

export function ensurePartyPixelFrame(slot) {
  if (slot.querySelector(':scope > .party-pixel-frame')) return;
  const frame = document.createElement('span');
  frame.className = 'party-pixel-frame';
  frame.setAttribute('aria-hidden', 'true');
  slot.append(frame);
}

export function collectCurrentPartyMembers() {
  const contextMembers = Array.isArray(partyContext.members)
    ? partyContext.members
    : [];
  const players = contextMembers.map((member) => ({
    name: member?.name || "Player",
    char_class: member?.char_class || DEFAULT_CHARACTER,
    selected_skin_id: member?.selected_skin_id ?? member?.selected_skin_id_by_char?.[resolveCharacterKey(member?.char_class)] ?? null,
    selected_skin_asset_url: member?.selected_skin_asset_url || "",
    team: member?.team || null,
  }));

  // Solo mode may not have party context, so retain the DOM fallback there.
  if (!players.length) {
    const slots = document.querySelectorAll(SLOT_SELECTOR);
    for (const slot of slots) {
      if (slot.dataset.botCharacter) continue;
      const uname = slotField(slot, "username")?.textContent || "";
      if (uname.trim().toLowerCase().startsWith("random")) continue;
      const name = uname.replace(" (You)", "");
      const cls =
        slot.dataset.character && slot.dataset.character !== "Random"
          ? slot.dataset.character
          : DEFAULT_CHARACTER;
      players.push({
        name, char_class: cls,
        selected_skin_asset_url: slotField(slot, "sprite")?.getAttribute("src") || "",
      });
    }
  }

  const botPreviews = (partyContext.botSlots || []).map((slot) => {
    const character = String(slot?.character || "shuffle").toLowerCase();
    const isShuffle = character === "shuffle";
    return {
      name: isShuffle
        ? "Bot"
        : `Bot · ${getCharacterDisplayName(character)}`,
      char_class: character,
      selected_skin_asset_url: isShuffle
        ? "/assets/shuffle/shuffle1.svg"
        : buildCharacterSkinBodyUrl(character, ""),
      team: slot?.team || null,
      isConfiguredBot: true,
      botSlotKey: `bot:${slot?.team || "team"}:${Number(slot?.index) || 0}`,
    };
  });

  const yourTeam = getCurrentPartyMember()?.team || null;
  if (partyContext.hideEnemyBros && yourTeam) {
    for (const player of players) {
      if (player.team && player.team !== yourTeam) {
        player.char_class = "Hidden";
        player.selected_skin_asset_url = "/assets/ui/hidden-bro.png";
      }
    }
  }
  return [...players, ...botPreviews].sort((a, b) => {
    if (!yourTeam) return 0;
    return Number(b?.team === yourTeam) - Number(a?.team === yourTeam);
  });
}

export function createPartyRoster({ isQueued, isInBattle, syncSelectionPickers }) {
  let renderSequence = 0;

  let rosterCommitTimer = null;

  const moveAnimations = new WeakMap();

  function getRenderedLobbyMemberSlots() {
    const rendered = new Map();
    document.querySelectorAll(SLOT_SELECTOR).forEach((slot) => {
      const key = getLobbyMemberKey(slot.dataset.playerName);
      if (key) rendered.set(key, slot);
    });
    return rendered;
  }

  let partySlotDrag = null;

  function ensurePartySlotDrag() {
    if (partySlotDrag) return partySlotDrag;
    partySlotDrag = createPartySlotDrag({
      canMove: () => !!getActivePartyId() && partyContext.ownerName === getCurrentLobbyUserName() && !isQueued() && !isInBattle() && !partyContext.members.some(m => String(m.status).toLowerCase() === 'ready'),
      move: (name, slot) => new Promise((resolve, reject) => {
        socket.timeout(5000).emit(SOCKET_EVENTS.PARTY_SLOT_MOVE, { partyId: getActivePartyId(), name, ...getBotSlotTarget(slot) }, (error, result) => {
          if (error || !result?.ok) reject(new Error(result?.error || 'Connection interrupted. Please try again.'));
          else resolve();
        });
      }),
      render: renderPartyMembers,
      onError: message => sonner('Could not move player', message, 'error'),
    });
    return partySlotDrag;
  }

  function commitPartyRosterLayout({
    members,
    currentUserName,
    layoutSlots,
    spawnMemberKeys,
  }) {
    const previousSlots = getRenderedLobbyMemberSlots();
    const previousPositions = new Map([...previousSlots].map(([key, slot]) => [key, slot.getBoundingClientRect()]));
    const movedSlots = [];
    updatePlatformsForMode(layoutSlots);

    const team1Members = members.filter((member) => member.team === "team1");
    const team2Members = members.filter((member) => member.team === "team2");
    const currentUser = members.find(
      (member) => getLobbyMemberKey(member) === getLobbyMemberKey(currentUserName),
    );
    const currentUserTeam = currentUser ? currentUser.team : "team1";
    const yourTeamMembers = team1Members;
    const opponentTeamMembers = team2Members;
    const desiredSlots = new Map();

    yourTeamMembers.forEach((member, index) => {
      desiredSlots.set(`your-slot-${(member.slot_index ?? index) + 1}`, {
        member,
        isYourTeam: currentUserTeam === "team1",
      });
    });
    opponentTeamMembers.forEach((member, index) => {
      desiredSlots.set(`op-slot-${(member.slot_index ?? index) + 1}`, {
        member,
        isYourTeam: currentUserTeam === "team2",
      });
    });

    document.querySelectorAll(SLOT_SELECTOR).forEach((slot) => {
      const target = getBotSlotTarget(slot);
      slot.dataset.slotLabel = `Team ${target?.team === 'team1' ? 1 : 2}, slot ${(target?.index || 0) + 1}`;
      const desired = desiredSlots.get(slot.id);
      const previousKey = getLobbyMemberKey(slot.dataset.playerName);

      if (!desired) {
        if (previousKey || !slot.classList.contains("empty") || !slotField(slot, "sprite")?.getAttribute("src")) {
          resetSlotToRandom(slot);
        }
        return;
      }

      const desiredKey = getLobbyMemberKey(desired.member);
      // Screen coordinates include platform float, drag and active move animations.
      // Only a change of seat should start a roster movement animation.
      const changedSeat = previousSlots.has(desiredKey) && previousSlots.get(desiredKey) !== slot;
      const shouldSpawn =
        spawnMemberKeys.has(desiredKey);

      if (slot.classList.contains("lobby-spawn-exit")) {
        clearLobbySpawnAnimation(slot);
      }
      if (previousKey && previousKey !== desiredKey) {
        resetSlotToRandom(slot);
      }

      applyMemberToSlot(desired.member, slot.id, desired.isYourTeam);
      const localOrigin = partySlotDrag?.takeOrigin(desiredKey);
      if (shouldSpawn) playLobbySpawnAnimation(slot, "enter");
      else if ((changedSeat || localOrigin) && !prefersReducedLobbyMotion()) {
        movedSlots.push({ slot, before: localOrigin || previousPositions.get(desiredKey), localOrigin });
      }
    });

    for (const bot of partyContext.botSlots || []) {
      const isYourTeam = bot.team === currentUserTeam;
      const slotId = `${bot.team === "team1" ? "your" : "op"}-slot-${Number(bot.index) + 1}`;
      const slot = document.getElementById(slotId);
      if (slot && !slot.dataset.playerName) applyBotToSlot(bot, slot, isYourTeam);
    }
    syncInviteBadges();
    // Measure destinations after all occupants and badges have been updated.
    for (const { slot, before, localOrigin } of movedSlots) {
      moveAnimations.get(slot)?.cancel();
      const after = slot.getBoundingClientRect();
      if (before && (Math.abs(before.x - after.x) > 1 || Math.abs(before.y - after.y) > 1)) {
        if (!localOrigin) playPartyMoveEffect(before, after);
        moveAnimations.set(slot, slot.animate([
          { translate: `${before.x - after.x}px ${before.y - after.y}px` },
          { translate: '0px 0px' },
        ], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }));
      }
    }
  }

  function renderPartyMembers(data) {
    if (ensurePartySlotDrag().defer(data)) return;
    const members = Array.isArray(data.members) ? data.members : [];
    warmBattleSelection(normalizeGameSelection(data?.selection || getCurrentSelection()), members);
    const capacity =
      data?.capacity && typeof data.capacity === "object" ? data.capacity : null;
    replacePartyContext(
      data?.partyId || partyContext.partyId || checkIfInParty(),
      {
        ownerName: data?.ownerName || partyContext.ownerName || null,
        allowMemberSelection:
          data?.allowMemberSelection ?? partyContext.allowMemberSelection,
        hideEnemyBros: data?.hideEnemyBros ?? partyContext.hideEnemyBros,
        isPublic: data?.isPublic ?? partyContext.isPublic,
        publicName: String(data?.publicName ?? partyContext.publicName).trim(),
        capacity,
        members,
        botSlots: Array.isArray(data?.botSlots)
          ? data.botSlots
          : partyContext.botSlots || [],
      },
    );

    syncSelectionPickers();
    const currentUserName = getCurrentLobbyUserName();
    const currentSelection = normalizeGameSelection(
      data?.selection || getCurrentSelection(),
    );
    const requestedSlots = Math.max(
      1,
      getPlayersPerTeamForSelection(currentSelection),
      Number(data?.mode) || 0,
    );
    const team1Members = members.filter((member) => member.team === "team1");
    const team2Members = members.filter((member) => member.team === "team2");
    const layoutSlots = Math.max(
      1,
      requestedSlots,
      team1Members.length,
      team2Members.length,
    );
    const renderedSlots = getRenderedLobbyMemberSlots();
    const nextMemberKeys = new Set(members.map(getLobbyMemberKey).filter(Boolean));
    const spawnMemberKeys = new Set(
      [...nextMemberKeys].filter((key) => !renderedSlots.has(key)),
    );
    const exitingSlots = [...renderedSlots.entries()]
      .filter(([key]) => !nextMemberKeys.has(key))
      .map(([, slot]) => slot);
    const sequence = ++renderSequence;

    if (rosterCommitTimer) {
      window.clearTimeout(rosterCommitTimer);
      rosterCommitTimer = null;
    }

    const commit = () => {
      if (sequence !== renderSequence) return;
      rosterCommitTimer = null;
      commitPartyRosterLayout({
        members,
        currentUserName,
        layoutSlots,
        spawnMemberKeys,
      });
      ensurePartySlotDrag().sync();
      void revealLobby();
    };

    if (!data.immediate && exitingSlots.length && !prefersReducedLobbyMotion()) {
      let exitDuration = 0;
      exitingSlots.forEach((slot) => {
        if (slot.classList.contains("lobby-spawn-exit")) {
          exitDuration = Math.max(
            exitDuration,
            getLobbySpawnTimeRemaining(slot),
          );
          return;
        }
        exitDuration = Math.max(
          exitDuration,
          playLobbySpawnAnimation(slot, "exit"),
        );
      });
      rosterCommitTimer = window.setTimeout(commit, exitDuration);
      return;
    }

    commit();
  }

  function applyMemberToSlot(member, slotId, isYourTeam = null) {
    const slot = document.getElementById(slotId);
    if (!slot) {
      console.warn("[party] applyMemberToSlot: slot not found", {
        slotId,
        member,
      });
      return;
    }

    const usernameEl = slotField(slot, "username");
    const spriteEl = slotField(slot, "sprite");
    const statusEl = slotField(slot, "status");

    if (!member) {
      // Reset to Random state if empty
      resetSlotToRandom(slot);
      return;
    }

    ensurePartyPixelFrame(slot);

    // Fill with member info
    const previousPlayerKey = getLobbyMemberKey(slot.dataset.playerName);
    const previousCharacter = String(slot.dataset.character || "").trim();
    const currentUserName = getCurrentLobbyUserName();
    const isCurrentUser = member.name === currentUserName;
    const hiddenBro = partyContext.hideEnemyBros && isYourTeam === false && !isCurrentUser;
    slot.classList.toggle("hidden-bro", hiddenBro);
    const displayName = member.name;
    // Mark slot ownership for delegated handlers
    slot.dataset.isCurrentUser = isCurrentUser ? "true" : "false";
    slot.dataset.playerName = member.name || "";
    slot.dataset.playerTeam = member.team || "";
    slot.dataset.isOwner =
      member.name === partyContext.ownerName ? "true" : "false";

    if (usernameEl) {
      usernameEl.textContent = displayName;
      // Set username styling based on team
      if (isYourTeam) {
        usernameEl.className = "username";
      } else {
        usernameEl.className = "username op-player";
      }
    }

    if (spriteEl) {
      const cls = hiddenBro ? "Hidden Bro" : member.char_class || DEFAULT_CHARACTER;
      const skinAsset = hiddenBro ? "/assets/ui/hidden-bro.png" : bodyDisplayUrl(
        String(member.selected_skin_asset_url || "").trim() ||
        buildCharacterSkinBodyUrl(cls, member.selected_skin_id ?? member.selected_skin_id_by_char?.[resolveCharacterKey(cls)]));
      if (spriteEl.getAttribute("src") !== skinAsset) spriteEl.src = skinAsset;
      spriteEl.alt = hiddenBro ? cls : getCharacterDisplayName(cls);
      spriteEl.classList.remove("random", "bot-shuffle-icon");
      if (
        !hiddenBro &&
        previousPlayerKey === getLobbyMemberKey(member) &&
        previousCharacter &&
        previousCharacter !== "Random" &&
        previousCharacter !== cls
      ) {
        triggerLobbyCharacterSplash(slot);
      }
    }

    if (statusEl) {
      ensureLobbySelectingRing(slot);
      const previousStatus = statusEl.textContent || "";
      const st = normalizeStatusLabel(member.status || "online");
      statusEl.textContent = st;
      statusEl.className = `status ${statusToClass(st)}`;
      if (checkIfInParty()) statusEl.style.display = "";
      if (previousPlayerKey === getLobbyMemberKey(member)) {
        applyLobbyStatusVisualState(slot, previousStatus, st);
      } else {
        slot.classList.toggle(
          "is-selecting-character",
          statusToClass(st) === "selecting-character",
        );
      }
      // Remove any previous event listeners
      statusEl.style.pointerEvents = "";
      statusEl.style.cursor = "";
    }

    // Toggle switch-character visibility for current user only
    let switchEl = slot.querySelector(".switch-character");
    if (isCurrentUser) {
      if (!switchEl) {
        switchEl = document.createElement("div");
        switchEl.className = "switch-character";
        const img = document.createElement("img");
        img.src = "/assets/switch.svg";
        img.alt = "";
        img.height = 18;
        switchEl.appendChild(img);
        // Prefer it as first child
        slot.insertBefore(switchEl, slot.firstChild);
      }
      switchEl.style.display = "";
    } else if (switchEl) {
      switchEl.style.display = "none";
    }

    // Set slot style class for outline/visuals and border colors
    if (isYourTeam === null) {
      // Auto-detect based on current user
      isYourTeam = isCurrentUser;
    }

    slot.classList.remove("empty", "player-display", "op-display");
    slot.classList.add(isYourTeam ? "player-display" : "op-display");
    slot.dataset.character = hiddenBro ? "Hidden" : member.char_class || DEFAULT_CHARACTER;
    setSlotLevelBadge(slot, hiddenBro ? null : getMemberLevel(member));

    // Set interaction properties
    slot.style.pointerEvents = "auto";
    // Only current user’s slot should look clickable
    slot.style.cursor = isCurrentUser ? "pointer" : "default";
  }

  function applyBotToSlot(bot, slot, isYourTeam) {
    ensurePartyPixelFrame(slot);
    const character = String(bot?.character || "shuffle").toLowerCase();
    const isShuffle = character === "shuffle";
    const usernameEl = slotField(slot, "username");
    const spriteEl = slotField(slot, "sprite");
    const statusEl = slotField(slot, "status");
    if (!usernameEl || !spriteEl || !statusEl) return;

    usernameEl.textContent = isShuffle
      ? "Bot"
      : `Bot · ${getCharacterDisplayName(character)}`;
    usernameEl.className = `username${isYourTeam ? "" : " op-player"}`;
    spriteEl.src = isShuffle
      ? "/assets/shuffle/shuffle1.svg"
      : bodyDisplayUrl(buildCharacterSkinBodyUrl(character, ""));
    spriteEl.alt = isShuffle ? "Shuffle bot" : `${getCharacterDisplayName(character)} bot`;
    spriteEl.classList.remove("random");
    spriteEl.classList.toggle("bot-shuffle-icon", isShuffle);
    statusEl.textContent =
      partyContext.ownerName === getCurrentLobbyUserName() ? "Change Bot" : "Bot";
    statusEl.className = "status bot-status";
    statusEl.style.display = "";
    statusEl.style.pointerEvents = "none";
    slot.classList.remove("empty", "player-display", "op-display");
    slot.classList.add("bot-display", isYourTeam ? "player-display" : "op-display");
    slot.dataset.botCharacter = character;
    slot.dataset.character = isShuffle ? "Random" : character;
    slot.dataset.playerName = "";
    slot.dataset.isCurrentUser = "false";
    slot.style.cursor =
      partyContext.ownerName === getCurrentLobbyUserName() ? "pointer" : "default";
  }

  function resetSlotToRandom(slot) {
    if (!slot) return;
    moveAnimations.get(slot)?.cancel();
    moveAnimations.delete(slot);
    const username = slotField(slot, "username");
    const sprite = slotField(slot, "sprite");
    const statusEl = slotField(slot, "status");

    if (!username || !sprite || !statusEl) return;

    clearLobbySpawnAnimation(slot);

    username.textContent = "Random";
    sprite.src = "/assets/icons/random.webp";
    sprite.alt = "Random";
    sprite.classList.add("random");
    sprite.classList.remove("bot-shuffle-icon");
    statusEl.className = "status invite";
    statusEl.textContent = "Invite";
    statusEl.style.display = checkIfInParty() ? "" : "none";
    statusEl.style.cursor = "pointer";
    statusEl.style.pointerEvents = "auto";
    slot.classList.remove(
      "player-display",
      "op-display",
      "character-splash",
      "lobby-spawn-enter",
      "lobby-spawn-exit",
      "lobby-ready-burst",
      "lobby-unready-burst",
      "is-selecting-character",
      "bot-display",
    );
    slot.classList.add("empty");
    slot.classList.remove("hidden-bro");
    slot.dataset.character = "Random";
    slot.dataset.isCurrentUser = "false";
    slot.dataset.playerName = "";
    slot.dataset.playerTeam = "";
    slot.dataset.isOwner = "false";
    delete slot.dataset.botCharacter;
    setSlotLevelBadge(slot, null);
    // Hide switch-character if present
    const switchEl = slot.querySelector(".switch-character");
    if (switchEl) switchEl.style.display = "none";
    // Preserve slot.id so future updates can target this slot reliably

    statusEl.dataset.inviteFeedback = "inline";
    statusEl.dataset.sound = "cursor4";
    statusEl.dataset.volume = "0.3";
  }

  function resetRosterRender() {
    ++renderSequence;
    window.clearTimeout(rosterCommitTimer);
    rosterCommitTimer = null;
    document.querySelectorAll(SLOT_SELECTOR).forEach(clearLobbySpawnAnimation);
  }

  return { renderPartyMembers, resetRosterRender };
}
