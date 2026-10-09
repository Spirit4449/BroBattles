export function lastSeenDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function friendPresenceLabel(friend, now = Date.now()) {
  if (friend?.status === "In Battle") return "In Battle";
  if (friend?.status === "End Screen") return "Finishing match";
  if (friend?.status === "online") return "Online";
  const date = lastSeenDate(friend?.lastSeenAt);
  if (!date) return "Last seen unknown";
  const elapsed = Math.max(0, now - date.getTime());
  if (elapsed < 60_000) return "Last seen just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `Last seen ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Last seen ${days}d ago`;
}

export function friendPresenceTitle(friend) {
  const date = lastSeenDate(friend?.lastSeenAt);
  return friend?.status === "offline" && date ? `Last seen ${date.toLocaleString()}` : "";
}
