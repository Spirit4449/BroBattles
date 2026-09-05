const { getAllCharacters } = require("../../lib/characterStats");

const partySlots = new Map();
const VALID_CHARACTERS = new Set(getAllCharacters());

function normalizeBotSlot(slot) {
  const team = slot?.team === "team2" ? "team2" : slot?.team === "team1" ? "team1" : null;
  const index = Number(slot?.index);
  const character = String(slot?.character || "shuffle").trim().toLowerCase();
  if (!team || !Number.isInteger(index) || index < 0 || index > 2) return null;
  if (character !== "shuffle" && !VALID_CHARACTERS.has(character)) return null;
  return { team, index, character };
}

function getPartyBotSlots(partyId) {
  return (partySlots.get(Number(partyId)) || []).map((slot) => ({ ...slot }));
}

function setPartyBotSlot(partyId, input) {
  const id = Number(partyId);
  const team = input?.team === "team2" ? "team2" : input?.team === "team1" ? "team1" : null;
  const index = Number(input?.index);
  if (!id || !team || !Number.isInteger(index)) throw new Error("Invalid bot slot.");
  const current = getPartyBotSlots(id).filter(
    (slot) => !(slot.team === team && slot.index === index),
  );
  if (input?.character != null && input.character !== "random") {
    const normalized = normalizeBotSlot(input);
    if (!normalized) throw new Error("Invalid bot selection.");
    current.push(normalized);
  }
  current.sort((a, b) => a.team.localeCompare(b.team) || a.index - b.index);
  if (current.length) partySlots.set(id, current);
  else partySlots.delete(id);
  return getPartyBotSlots(id);
}

function prunePartyBotSlots(partyId, { teamSize = 3, members = [] } = {}) {
  const counts = { team1: 0, team2: 0 };
  for (const member of members || []) {
    if (member?.team === "team1" || member?.team === "team2") counts[member.team]++;
  }
  const valid = getPartyBotSlots(partyId).filter(
    (slot) => slot.index < teamSize && slot.index >= counts[slot.team],
  );
  if (valid.length) partySlots.set(Number(partyId), valid);
  else partySlots.delete(Number(partyId));
  return getPartyBotSlots(partyId);
}

function clearPartyBotSlots(partyId) {
  partySlots.delete(Number(partyId));
}

module.exports = {
  normalizeBotSlot,
  getPartyBotSlots,
  setPartyBotSlot,
  prunePartyBotSlots,
  clearPartyBotSlots,
};
