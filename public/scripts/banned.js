import { formatRestrictionRemaining, restrictionClock } from './restrictionClock.js';

export function initBanPage({ document, window, fetch, now = Date.now }) {
  const el = id => document.getElementById(id);
  function cookie(name) {
    const value = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
    try { return value ? decodeURIComponent(value.slice(name.length + 1)) : ''; }
    catch (_) { return ''; }
  }
  el('banReason').textContent = cookie('bb_ban_reason') || 'Abuse policy violation.';
  const rawExpiry = Number(cookie('bb_ban_expires_at'));
  const expiry = Number.isFinite(rawExpiry) && rawExpiry > 0 ? rawExpiry : 0;
  let checking = false;
  let expired = false;
  async function checkRestriction() {
    if (checking) return;
    checking = true;
    try {
      const response = await fetch('/status', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
      const status = await response.json();
      if (response.ok && status && !status.error && !status.banned) window.location.replace('/');
    } catch (_) {
      // Keep the page and retry when the network is available again.
    } finally { checking = false; }
  }
  function tick() {
    const remaining = Math.max(0, expiry - now());
    const text = remaining ? `${formatRestrictionRemaining(remaining)} left` : 'Checking access…';
    if (el('banRemaining').textContent !== text) el('banRemaining').textContent = text;
    if (!remaining && !expired) {
      expired = true;
      document.body.classList.add('restriction-elapsed');
      checkRestriction();
    }
  }
  if (expiry) {
    document.title = 'Account Suspended · Bro Battles';
    el('banTitle').textContent = 'Account Suspended';
    el('banCountdown').hidden = false;
    el('banClock').innerHTML = restrictionClock;
    el('banCountdown').title = `Ends ${new Date(expiry).toLocaleString()}`;
    tick();
    window.setInterval(tick, 1000);
  }
  window.setInterval(checkRestriction, 15000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (expiry) tick();
      checkRestriction();
    }
  });
}

if (typeof document !== 'undefined') {
  initBanPage({ document, window, fetch: window.fetch.bind(window) });
}
