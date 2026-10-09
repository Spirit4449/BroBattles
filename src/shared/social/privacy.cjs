// Account privacy settings. Stored in user_privacy_settings; a missing row
// means every default below. The server enforces them in friendService.
const PRIVACY_FIELDS = Object.freeze([
  {
    key: 'friendRequests', column: 'friend_requests', label: 'Friend requests from',
    description: 'Who can add you. Recent players battled you 2+ times in 14 days.',
    options: [{ value: 'everyone', label: 'Everyone' }, { value: 'recent', label: 'Recent players' }, { value: 'none', label: 'No one' }],
  },
  {
    key: 'messages', column: 'messages', label: 'Messages from',
    description: 'Who can send you direct messages.',
    options: [{ value: 'friends', label: 'Friends' }, { value: 'none', label: 'No one' }],
  },
  {
    key: 'partyInvites', column: 'party_invites', label: 'Party invites from',
    description: 'Who can invite you to their party.',
    options: [{ value: 'friends', label: 'Friends' }, { value: 'none', label: 'No one' }],
  },
  {
    key: 'lastSeen', column: 'last_seen', label: 'Last seen visible to',
    description: 'Who sees when you were last online.',
    options: [{ value: 'friends', label: 'Friends' }, { value: 'none', label: 'No one' }],
  },
  {
    key: 'readReceipts', column: 'read_receipts', label: 'Read receipts', boolean: true,
    description: "Show friends when you've read their messages. Off hides theirs too.",
  },
  {
    key: 'showInSuggestions', column: 'show_in_suggestions', label: 'Show me in suggestions', boolean: true,
    description: 'Appear in the friend suggestions of players you battle.',
  },
].map(Object.freeze));

const DEFAULT_PRIVACY = Object.freeze({
  friendRequests: 'everyone',
  messages: 'friends',
  partyInvites: 'friends',
  lastSeen: 'friends',
  readReceipts: true,
  showInSuggestions: true,
});

function normalizeField(field, value) {
  if (field.boolean) {
    if (typeof value === 'boolean') return value;
    if (value === 0 || value === 1) return value === 1;
    return undefined;
  }
  return field.options.some((option) => option.value === value) ? value : undefined;
}

// Keeps only known keys with valid values; use for partial updates.
function sanitizePrivacyUpdate(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const field of PRIVACY_FIELDS) {
    const value = normalizeField(field, raw[field.key]);
    if (value !== undefined) out[field.key] = value;
  }
  return out;
}

function normalizePrivacy(raw) {
  return { ...DEFAULT_PRIVACY, ...sanitizePrivacyUpdate(raw) };
}

// Reads `<prefix>friend_requests`, ... from a joined row; NULLs fall back to defaults.
function privacyFromRow(row, prefix = '') {
  const raw = {};
  for (const field of PRIVACY_FIELDS) {
    const value = row?.[`${prefix}${field.column}`];
    if (value !== null && value !== undefined) raw[field.key] = field.boolean ? Number(value) === 1 : String(value);
  }
  return normalizePrivacy(raw);
}

module.exports = { PRIVACY_FIELDS, DEFAULT_PRIVACY, normalizePrivacy, sanitizePrivacyUpdate, privacyFromRow };
