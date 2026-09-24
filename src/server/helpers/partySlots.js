// Preserve saved seats; assign legacy/new members to the first free seat.
function normalizePartySlots(members, teamSize = 3) {
  const result = members.map(member => ({ ...member }));
  for (const team of ['team1', 'team2']) {
    const used = new Set();
    const pending = [];
    for (const member of result.filter(m => m.team === team)) {
      const index = member.slot_index;
      if (Number.isInteger(index) && index >= 0 && index < teamSize && !used.has(index)) used.add(index);
      else pending.push(member);
    }
    for (const member of pending) {
      let index = 0;
      while (used.has(index)) index++;
      member.slot_index = index;
      used.add(index);
    }
  }
  return result;
}

function movePartyMember(members, { name, team, index }, teamSize) {
  if (!['team1', 'team2'].includes(team) || !Number.isInteger(index) || index < 0 || index >= teamSize) {
    throw new Error('That party slot is not available.');
  }
  const next = normalizePartySlots(members, teamSize);
  const source = next.find(m => m.name === name);
  if (!source) throw new Error('That player is no longer in the party.');
  const target = next.find(m => m.team === team && m.slot_index === index);
  if (target) { target.team = source.team; target.slot_index = source.slot_index; }
  source.team = team;
  source.slot_index = index;
  return next;
}
// Keep valid seats and teams; relocate only seats that no longer fit.
function resizePartySlots(members, teamSize) {
  if (members.length > teamSize * 2) throw new Error('Too many players for this mode.');
  const result = members.map(member => ({ ...member }));
  const used = { team1: new Set(), team2: new Set() };
  const pending = [];
  for (const member of result) {
    const seats = used[member.team];
    const index = member.slot_index;
    if (seats && Number.isInteger(index) && index >= 0 && index < teamSize && !seats.has(index)) seats.add(index);
    else pending.push(member);
  }
  for (const member of pending) {
    const preferred = member.team === 'team2' ? 'team2' : 'team1';
    const team = used[preferred].size < teamSize ? preferred : preferred === 'team1' ? 'team2' : 'team1';
    let index = 0;
    while (used[team].has(index)) index++;
    member.team = team;
    member.slot_index = index;
    used[team].add(index);
  }
  return result;
}
module.exports = { normalizePartySlots, movePartyMember, resizePartySlots };
