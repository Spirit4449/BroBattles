const kinds = new Set(['join', 'leave', 'map', 'mode', 'battle']);
const normalize = value => String(value || '').trim().toLowerCase();
export function systemLogBody(message, currentUsername) {
  if (message.kind !== 'battle') return String(message.body || '');
  if (message.winnerTeam === 'draw' || message.winnerTeam === null) return 'Battle ended. Draw';
  const player = message.participants?.find(player => normalize(player.name) === normalize(currentUsername));
  if (!player?.team || !message.winnerTeam) return 'Battle ended';
  return normalize(player.team) === normalize(message.winnerTeam) ? 'Battle ended. You won' : 'Battle ended. You lost';
}
export function formatSystemLogTime(createdAt, now = new Date()) {
  const date = new Date(createdAt);
  if (!createdAt || Number.isNaN(date.getTime())) return '';
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return date.toLocaleString([], {
    ...(sameDay ? {} : {month:'short', day:'numeric', ...(date.getFullYear() !== now.getFullYear() ? {year:'numeric'} : {})}),
    hour:'numeric', minute:'2-digit',
  });
}
export function renderSystemLog(message, currentUsername) {
  const row = document.createElement('div');
  row.className = 'bb-chat-system-log';
  row.dataset.messageId = message.id;
  row.dataset.kind = kinds.has(message.kind) ? message.kind : 'mode';
  row.tabIndex = 0;
  const body = systemLogBody(message, currentUsername);
  const content = document.createElement('span');
  content.className = 'bb-chat-system-content';
  const icon = document.createElement('img');
  icon.className = 'bb-chat-system-icon';
  icon.alt = '';
  icon.width = 16;
  icon.height = 16;
  icon.src = `/assets/chat-system/${row.dataset.kind}.svg`;
  const text = document.createElement('span');
  text.textContent = body;
  const time = document.createElement('time');
  time.className = 'bb-chat-system-time';
  if (message.createdAt && !Number.isNaN(Date.parse(message.createdAt))) time.dateTime = message.createdAt;
  function refreshTimestamp() {
    const timestamp = formatSystemLogTime(message.createdAt);
    time.textContent = timestamp;
    row.setAttribute('aria-label', `${body}${timestamp ? `. ${timestamp}` : ''}`);
  }
  refreshTimestamp();
  row.addEventListener('mouseenter', refreshTimestamp);
  row.addEventListener('focus', refreshTimestamp);
  content.append(icon, text);
  row.append(content, time);
  return row;
}
