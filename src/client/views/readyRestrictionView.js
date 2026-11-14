// The shell owns the runtime clock, so this also survives lobby route changes.
import { formatRestrictionRemaining, restrictionClock } from '../../../public/scripts/restrictionClock.js';
export { formatRestrictionRemaining };

export function renderReadyRestrictions(document, { maintenanceUntil, suspendedUntil, now = Date.now() } = {}) {
  const host = document.querySelector('.ready-button-wrap');
  if (!host) return;
  let container = host.querySelector('.ready-restrictions');
  const restrictions = [
    ['maintenance', 'Maintenance', Date.parse(maintenanceUntil) || 0],
    ['suspension', 'Suspension', Number(suspendedUntil) || 0],
  ];
  if (!container && restrictions.every(([, , until]) => until <= now)) return;
  if (!container) {
    container = document.createElement('div');
    container.className = 'ready-restrictions';
    for (const [kind, label] of restrictions) {
      const badge = document.createElement('div');
      badge.className = `ready-restriction ready-restriction--${kind}`;
      badge.dataset.restriction = kind;
      badge.setAttribute('role', 'timer');
      badge.innerHTML = `${restrictionClock}<span class="ready-restriction-copy"><strong>${label}</strong><span class="ready-restriction-time"></span></span>`;
      container.appendChild(badge);
    }
    host.appendChild(container);
  }
  for (const [kind, label, until] of restrictions) {
    const badge = container.querySelector(`[data-restriction="${kind}"]`);
    badge.hidden = until <= now;
    if (badge.hidden) continue;
    const time = `${formatRestrictionRemaining(until - now)} left`;
    const text = badge.querySelector('.ready-restriction-time');
    if (text.textContent !== time) text.textContent = time;
    badge.setAttribute('aria-label', `${label}: ${time}`);
  }
  container.hidden = restrictions.every(([, , until]) => until <= now);
  let row = host.querySelector('.ready-status-row');
  const streak = host.querySelector('.win-streak-control');
  if (!container.hidden) {
    if (!row) {
      row = document.createElement('div');
      row.className = 'ready-status-row';
      host.appendChild(row);
    }
    row.hidden = false;
    if (streak && streak.parentElement !== row) row.prepend(streak);
    if (container.parentElement !== row) row.appendChild(container);
  } else if (row) {
    row.hidden = true;
    if (streak && streak.parentElement === row) host.prepend(streak);
  }
}
