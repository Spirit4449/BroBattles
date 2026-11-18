function reactionCounts(message) {
  return new Map((Array.isArray(message?.reactions) ? message.reactions : [])
    .map(item => [String(item?.reaction || ""), Number(item?.count) || 0]));
}

export function findChangedReaction(previousMessage, nextMessage) {
  const previous = reactionCounts(previousMessage);
  const next = reactionCounts(nextMessage);
  for (const key of new Set([...previous.keys(), ...next.keys()])) {
    if ((previous.get(key) || 0) !== (next.get(key) || 0)) return key;
  }
  return null;
}

export function summarizeDirectReactions(reactions, currentUserId) {
  const usersByReaction = new Map();
  let myReaction = null;
  for (const entry of Array.isArray(reactions) ? reactions : []) {
    if (!usersByReaction.has(entry.reaction)) usersByReaction.set(entry.reaction, []);
    usersByReaction.get(entry.reaction).push({ name: entry.name });
    if (entry.userId === currentUserId) myReaction = entry.reaction;
  }
  return {
    reactions: [...usersByReaction].map(([reaction, users]) => ({ reaction, count: users.length })),
    reactionUsers: Object.fromEntries(usersByReaction),
    myReaction,
  };
}
