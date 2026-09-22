// Recent system activity is separate from user messages/read receipts. Keep it
// across lobby/game navigation, bounded for the lifetime of this server process.
const journals = new WeakMap();
function journal(io) {
  let parties = journals.get(io);
  if (!parties) { parties = new Map(); journals.set(io, parties); }
  return parties;
}
function partyLog(io, partyId) {
  const parties = journal(io);
  const id = Number(partyId);
  let entry = parties.get(id);
  if (!entry) {
    entry = { events: [], members: null, seq: 0 };
    parties.set(id, entry);
    if (parties.size > 1000) parties.delete(parties.keys().next().value);
  }
  return entry;
}
function appendPartyChatLog(io, partyId, { kind, body, key, winnerTeam, participants } = {}) {
  if (!io || !Number(partyId) || !body) return;
  const entry = partyLog(io, partyId);
  if (key && entry.events.some(event => event.key === key)) return;
  const event = { id: `system:${Number(partyId)}:${Date.now()}:${++entry.seq}`, kind, body: String(body), ...(kind === "battle" ? { winnerTeam, participants } : {}), createdAt: new Date().toISOString(), key };
  entry.events.push(event);
  if (entry.events.length > 100) entry.events.shift();
  io.to(`party:${Number(partyId)}`).emit('party-chat:system', { partyId: Number(partyId), event });
  return event;
}
function recordPartyRoster(io, partyId, members) {
  if (!io || !Number(partyId)) return;
  const entry = partyLog(io, partyId);
  const next = new Map((members || []).filter(m => m?.name).map(m => [m.name.trim().toLowerCase(), m.name]));
  if (entry.members) {
    for (const [key, name] of next) if (!entry.members.has(key)) appendPartyChatLog(io, partyId, {kind:'join', body:`${name} joined the party`});
    for (const [key, name] of entry.members) if (!next.has(key)) appendPartyChatLog(io, partyId, {kind:'leave', body:`${name} left the party`});
  }
  entry.members = next;
}
function getPartyChatLogs(io, partyId) {
  return io ? [...(journal(io).get(Number(partyId))?.events || [])] : [];
}
module.exports = { appendPartyChatLog, recordPartyRoster, getPartyChatLogs };
