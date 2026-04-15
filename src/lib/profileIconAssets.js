function normalizeProfileIconId(iconId) {
  const id = String(iconId || "")
    .trim()
    .toLowerCase();
  if (!id) return "";
  if (!/^[a-z0-9_-]{1,64}$/.test(id)) return "";
  return id;
}

export function buildProfileIconUrl(profileIconId, charClass = "ninja") {
  const iconId = normalizeProfileIconId(profileIconId);
  if (iconId) {
    return `/assets/profile-icons/${iconId}.webp`;
  }
  const fallbackClass = String(charClass || "ninja")
    .trim()
    .toLowerCase();
  return `/assets/${fallbackClass || "ninja"}/body.webp`;
}

export function buildProfileIconAlt(profileIconId, charClass = "ninja") {
  const iconId = normalizeProfileIconId(profileIconId);
  if (iconId) return iconId;
  return String(charClass || "ninja");
}
