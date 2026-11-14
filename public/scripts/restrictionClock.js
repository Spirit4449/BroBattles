export function formatRestrictionRemaining(remainingMs) {
  let seconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}


export const restrictionClock = `<svg class="ready-restriction-clock" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M10 1h12v2h5v4h3v5h1v10h-2v5h-5v3H10v-2H5v-4H2V10h2V6h3V3h3Z" fill="#09101c"/>
        <path d="M10 3h12v2h4v3h3v14h-3v4h-4v3H10v-3H6v-4H3V10h3V6h4Z" fill="currentColor"/>
        <path d="M10 3h12v2H10zM6 6h4v2H8v4H6zM3 12h2v8H3z" fill="#fff7df" opacity=".7"/>
        <path d="M27 12h2v10h-3v4h-4v3H10v-2h12v-3h2v-3h3Z" fill="#09101c" opacity=".35"/>
        <path d="M11 7h10v2h3v3h2v9h-3v3h-3v2h-9v-3H8v-3H6v-9h2V9h3Z" fill="#101b2b"/>
        <path d="M11 9h10v2h3v8h-2v3H10v-3H8v-7h3Z" fill="#25364a"/>
        <path d="M15 7h2v3h-2zm0 15h2v3h-2zM7 15h3v2H7zm15 0h3v2h-3z" fill="#fff0c5"/>
        <path d="M10 10h2v2h-2zm10 0h2v2h-2zm0 10h2v2h-2zm-10 0h2v2h-2z" fill="currentColor" opacity=".6"/>
        <path d="M15 15h6v3h-6z" fill="#09101c"/>
        <path d="M16 15h5v2h-5z" fill="#fff7df"/>
        <g class="ready-restriction-hand"><path d="M15 10h3v7h-3z" fill="#09101c"/><path d="M15 9h2v8h-2z" fill="#fff7df"/></g>
        <path d="M14 14h4v4h-4z" fill="currentColor"/><path d="M15 15h2v2h-2z" fill="#fff7df"/>
      </svg>`;
