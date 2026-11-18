import { getUser } from "../session.mjs";
import { nameKey } from "../../../shared/social/textRules.js";

export function createEmptyPartyContext(partyId, overrides = {}) {
  return {
    partyId: partyId || null,
    ownerName: null,
    hideEnemyBros: false,
    allowMemberSelection: true,
    isPublic: false,
    publicName: "",
    capacity: null,
    members: [],
    botSlots: [],
    ...overrides,
  };
}

export let partyContext = createEmptyPartyContext();

export function replacePartyContext(partyId, overrides) {
  partyContext = createEmptyPartyContext(partyId, overrides);
}

/** Return the party route segment as a string, or false outside a party route. */
export function checkIfInParty() {
  return /^\/party\/([^/]+)\/?$/i.exec(window.location.pathname)?.[1] || false;
}

/** Resolve the route ID without consulting retained lobby state. */
export function getRoutePartyId() {
  const id = Number(checkIfInParty());
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Prefer the current party context, then the route. Return a positive finite number or null. */
export function getActivePartyId() {
  const contextPartyId = Number(partyContext.partyId || 0);
  if (Number.isFinite(contextPartyId) && contextPartyId > 0) {
    return contextPartyId;
  }
  return getRoutePartyId();
}

export function getLobbyMemberKey(value) {
  const name = typeof value === "string" ? value : value?.name;
  return nameKey(name);
}

export function getCurrentLobbyUserName() {
  return String(
    document.getElementById("username-text")?.textContent ||
      getUser()?.name ||
      "",
  ).trim();
}

export function getCurrentPartyMember() {
  const selfKey = getLobbyMemberKey(getCurrentLobbyUserName());
  return (partyContext.members || []).find((member) => getLobbyMemberKey(member) === selfKey);
}

export function getPartyInteractionContext() {
  return {
    partyId: partyContext.partyId || checkIfInParty() || null,
    ownerName: partyContext.ownerName || null,
    allowMemberSelection: partyContext.allowMemberSelection !== false,
    isPublic: !!partyContext.isPublic,
    publicName: String(partyContext.publicName || "").trim(),
    capacity:
      partyContext.capacity && typeof partyContext.capacity === "object"
        ? { ...partyContext.capacity }
        : null,
    members: Array.isArray(partyContext.members)
      ? partyContext.members.slice()
      : [],
  };
}
