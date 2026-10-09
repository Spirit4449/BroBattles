import streakRewards from '../../shared/winStreakRewards.cjs';
const { WIN_STREAK_TIERS, winStreakMultipliers } = streakRewards;

export function winStreakBenefitsMarkup(streak) {
  const multipliers = winStreakMultipliers(streak);
  return `<strong>Win streak benefits</strong><ul>${WIN_STREAK_TIERS.map(tier => {
    const unlocked = streak >= tier.streak;
    const active = unlocked && multipliers[tier.currency] === tier.multiplier;
    const icon = tier.currency === 'trophies' ? 'trophy-2x' : tier.currency === 'coins' ? 'coins-plus' : 'gems-plus';
    return `<li class="${active ? 'is-active' : ''}"><img src="/assets/icons/win-streak/${icon}.webp" width="36" height="36" alt=""/><span><small>${tier.streak}+ wins</small><b>${tier.label}</b></span>${active ? '<em>Active</em>' : ''}</li>`;
  }).join('')}</ul>`;
}

export function wireWinStreakBenefits(badge, panel) {
  if (!badge || !panel || badge.dataset.benefitsWired) return;
  badge.dataset.benefitsWired = 'true';
  let open = false;
  badge.closeStreakBenefits = () => setOpen(false);
  const setOpen = value => {
    open = value;
    // Keep the surface mounted so both directions use the shared popup transition.
    if (open && panel.hidden) {
      panel.hidden = false;
      void panel.offsetWidth;
    }
    panel.classList.toggle('is-open', open);
    panel.inert = !open;
    panel.setAttribute('aria-hidden', String(!open));
    badge.setAttribute('aria-expanded', String(open));
  };
  setOpen(false);
  badge.addEventListener('click', () => setOpen(!open));
  badge.parentElement.addEventListener('focusout', event => {
    if (!badge.parentElement.contains(event.relatedTarget)) setOpen(false);
  });
  const ownerDocument = badge.ownerDocument;
  ownerDocument.addEventListener('click', event => {
    if (!badge.parentElement.contains(event.target)) setOpen(false);
  });
  ownerDocument.addEventListener('keydown', event => {
    if (event.key === 'Escape' && open) {
      setOpen(false);
      badge.focus();
    }
  });
}

export function renderReadyWinStreak(badge, value) {
  if (!badge) return;
  const streak = Math.max(0, Math.floor(Number(value) || 0));
  badge.hidden = streak < 2;
  if (badge.hidden) badge.closeStreakBenefits?.();
  badge.textContent = String(streak);
  const label = `${streak} win streak`;
  badge.setAttribute('aria-label', label);
  badge.removeAttribute?.('title');
  const panel = badge.ownerDocument?.getElementById('win-streak-benefits');
  if (panel) panel.innerHTML = winStreakBenefitsMarkup(streak);
}

export function gameOverWinStreakMarkup(reward) {
  const before = reward?.winStreakBefore;
  const after = reward?.winStreakAfter;
  if (!Number.isSafeInteger(before) || before < 0 ||
      !Number.isSafeInteger(after) || after < 0) return '';
  const increased = after >= 2 && after === before + 1;
  const lost = before >= 2 && after === 0;
  if (!increased && !lost) return '';
  const title = increased ? (before === 0 ? 'Win streak started!' : 'Win streak increased!') : 'Win streak lost';
  return `<section class="bb-game-over-streak ${increased ? 'is-increased' : 'is-lost'}" role="status" aria-label="${title} ${before} to ${after}">
    <span class="bb-streak-sparks" aria-hidden="true">${Array.from({ length: 8 }, (_, i) => `<i style="--spark:${i}"></i>`).join('')}</span>
    <img class="bb-game-over-streak-icon" src="/assets/icons/win-streak.webp" width="42" height="42" alt="" aria-hidden="true" />
    <div><strong>${lost ? 'Streak lost' : 'Win streak'}</strong><b class="bb-game-over-streak-count" data-streak-count data-streak-after="${after}">${before}</b></div>
  </section>`;
}

export async function animateGameOverWinStreak(badge, {
  reducedMotion = false,
  onCountChanged = () => {},
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const counter = badge?.querySelector('[data-streak-count]');
  if (!counter) return;
  const after = counter.dataset.streakAfter;
  if (reducedMotion) { counter.textContent = after; onCountChanged(); return; }
  await wait(650);
  if (!badge.isConnected) return;
  counter.classList.add('is-changing');
  await wait(140);
  if (!badge.isConnected) return;
  counter.textContent = after;
  onCountChanged();
  counter.classList.remove('is-changing');
  counter.classList.add('is-counted');
}
