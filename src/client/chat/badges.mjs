export function formatBadgeCount(count, cap = 99) {
  return count > cap ? `${cap}+` : String(count);
}

export function renderUnreadBadge(element, count) {
  const visible = count > 0;
  element.textContent = visible ? formatBadgeCount(count) : "";
  element.classList.toggle("hidden", !visible);
}
