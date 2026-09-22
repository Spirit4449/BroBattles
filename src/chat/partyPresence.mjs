const nameKey = (name) => String(name || '').trim().toLowerCase();
const onlineStatuses = new Set(['online', 'idle', 'ready', 'not ready', 'in battle', 'end screen', 'selecting character']);

export function countOnlineMembers(members = []) {
  const unique = new Map();
  for (const member of members) {
    const key = nameKey(member?.name);
    if (key && !member?.isBot) unique.set(key, member);
  }
  return [...unique.values()].filter(member => onlineStatuses.has(nameKey(member.status))).length;
}

// Consume event payloads directly: other listeners may not have updated lobby state yet.
export function createPartyPresenceTracker(initial) {
  let context = { partyId: Number(initial?.partyId) || 0, members: [] };
  function roster(payload) {
    if (!context.partyId || Number(payload?.partyId) !== context.partyId) return false;
    context = { ...payload, partyId: context.partyId, members: (payload.members || []).map(member => ({ ...member })) };
    return true;
  }
  if (initial) roster(initial);
  return {
    get: () => context,
    join(partyId) {
      const next = Number(partyId) || 0;
      if (context.partyId !== next) context = { partyId: next, members: [] };
    },
    roster,
    status(payload) {
      if (!context.partyId || Number(payload?.partyId) !== context.partyId || !nameKey(payload?.status)) return false;
      const member = context.members.find(item => nameKey(item.name) === nameKey(payload.name));
      if (!member) return false;
      member.status = payload.status;
      return true;
    },
  };
}
