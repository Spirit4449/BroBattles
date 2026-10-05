// In-memory party invites sent between friends. A single server process owns
// the database (runtimeOwnershipService), so process memory is authoritative.
const INVITE_TTL_MS = 5 * 60 * 1000;

// Spam protection per inviter -> friend. The first few invites are free, then
// cooldowns escalate. Each quiet stretch of LEVEL_DECAY_MS steps back one level.
const FREE_INVITES = 3;
const COOLDOWN_BY_LEVEL_MS = [0, 60 * 1000, 5 * 60 * 1000];
const LEVEL_DECAY_MS = 5 * 60 * 1000;

const invites = new Map(); // inviteeId -> Map<partyId, { inviterId, expiresAt }>
const limits = new Map(); // "inviter:invitee" -> { level, count, lastAt, blockedUntil }

function prune(inviteeId, now = Date.now()) {
  const byParty = invites.get(inviteeId);
  if (!byParty) return null;
  for (const [partyId, invite] of byParty) if (invite.expiresAt <= now) byParty.delete(partyId);
  if (!byParty.size) { invites.delete(inviteeId); return null; }
  return byParty;
}

function limitState(inviterId, inviteeId, now) {
  const key = `${Number(inviterId)}:${Number(inviteeId)}`;
  const entry = limits.get(key) || { level: 0, count: 0, lastAt: 0, blockedUntil: 0 };
  // Quiet time counts from when the last cooldown ended.
  const quietSince = Math.max(entry.lastAt, entry.blockedUntil);
  const steps = quietSince ? Math.floor((now - quietSince) / LEVEL_DECAY_MS) : 0;
  if (steps > 0) {
    entry.level = Math.max(0, entry.level - steps);
    if (entry.level === 0) entry.count = 0;
    entry.lastAt = now - ((now - quietSince) % LEVEL_DECAY_MS);
    entry.blockedUntil = 0;
  }
  return { key, entry };
}

// Milliseconds until this friend can be invited again (0 when allowed).
function getInviteCooldownMs(inviterId, inviteeId, now = Date.now()) {
  const { entry } = limitState(inviterId, inviteeId, now);
  return Math.max(0, entry.blockedUntil - now);
}

// Records an invite and returns the cooldown it starts (0 when none).
function addPartyInvite(inviteeId, partyId, inviterId, now = Date.now()) {
  const { key, entry } = limitState(inviterId, inviteeId, now);
  entry.count += 1;
  entry.lastAt = now;
  if (entry.level === 0 && entry.count >= FREE_INVITES) entry.level = 1;
  else if (entry.level > 0) entry.level = Math.min(COOLDOWN_BY_LEVEL_MS.length - 1, entry.level + 1);
  const cooldownMs = COOLDOWN_BY_LEVEL_MS[entry.level];
  entry.blockedUntil = cooldownMs ? now + cooldownMs : 0;
  limits.set(key, entry);
  if (limits.size > 5000) {
    for (const [k, e] of limits) if (now - Math.max(e.lastAt, e.blockedUntil) > LEVEL_DECAY_MS * COOLDOWN_BY_LEVEL_MS.length) limits.delete(k);
  }

  const id = Number(inviteeId);
  if (!invites.has(id)) invites.set(id, new Map());
  invites.get(id).set(Number(partyId), { inviterId: Number(inviterId), expiresAt: now + INVITE_TTL_MS });
  return cooldownMs;
}

function hasPartyInvite(inviteeId, partyId) {
  return !!prune(Number(inviteeId))?.has(Number(partyId));
}

function consumePartyInvite(inviteeId, partyId) {
  const byParty = prune(Number(inviteeId));
  if (!byParty?.delete(Number(partyId))) return false;
  if (!byParty.size) invites.delete(Number(inviteeId));
  return true;
}

module.exports = { addPartyInvite, hasPartyInvite, consumePartyInvite, getInviteCooldownMs, INVITE_TTL_MS };
