import reasons from '../../../shared/social/profileReports.json';
import { createPixelSelect } from '../../ui/pixelSelect.js';
import { wireBackdropDismiss } from '../../site/dialogDismiss.mjs';
import { profileFetchJson } from '../ui';
import '../../styles/profileReport.css';

export function syncProfileReportButton(profile, viewingSelf, source) {
  const head = document.querySelector('#profile-overlay .profile-head-title-row');
  if (!head) return;
  let button = document.getElementById('profile-report-btn');
  if (!button) {
    button = document.createElement('button');
    button.id = 'profile-report-btn';
    button.type = 'button';
    button.className = 'bb-friends-btn profile-friend-btn profile-report-btn';
    button.title = 'Report player';
    button.setAttribute('aria-label', 'Report player');
    const icon = document.createElement('img');
    icon.className = 'profile-report-icon';
    icon.src = '/assets/ui/report-flag-pixel.png';
    icon.alt = '';
    icon.width = 18;
    icon.height = 18;
    button.append(icon);
    head.append(button);
  }
  button.hidden = viewingSelf || source === 'leaderboard' || !profile?.userId;
  button.onclick = () => openProfileReport(profile, button);
}

function openProfileReport(profile, trigger) {
  if (document.getElementById('profile-report-dialog')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'profile-report-dialog';
  dialog.className = 'profile-report-dialog bb-popup';
  dialog.setAttribute('aria-labelledby', 'profile-report-title');
  dialog.innerHTML = `
    <header class="bb-popup-header">
      <h2 id="profile-report-title" class="bb-popup-title">Report Player</h2>
      <button class="bb-close pixel-menu-button" type="button" data-close aria-label="Close report"><span aria-hidden="true">×</span></button>
    </header>
    <form class="profile-report-form">
      <p class="profile-report-target"></p>
      <div class="profile-report-field"><span id="profile-report-reason-label">Reason</span><div data-reason></div></div>
      <div class="profile-report-field">
        <label for="profile-report-message">What happened?</label>
        <textarea id="profile-report-message" name="message" rows="5" minlength="5" maxlength="3500" required placeholder="Tell us why you are reporting this player…"></textarea>
      </div>
      <p class="profile-report-error" role="alert" hidden></p>
      <div class="profile-report-actions">
        <button type="button" class="bb-button" data-close>Cancel</button>
        <button type="submit" class="bb-button profile-report-submit">Send Report</button>
      </div>
    </form>`;
  dialog.querySelector('.profile-report-target').textContent = `Reporting ${profile.username}`;
  const form = dialog.querySelector('form');
  const message = dialog.querySelector('textarea');
  const error = dialog.querySelector('[role="alert"]');
  const submit = dialog.querySelector('[type="submit"]');
  const newKey = () => crypto.randomUUID();
  let submissionKey = newKey();
  let saving = false;
  const reason = createPixelSelect({ options: reasons, value: reasons[0].value, label: 'Report reason', onChange: () => { submissionKey = newKey(); } });
  dialog.querySelector('[data-reason]').append(reason.element);
  form.addEventListener('input', () => { submissionKey = newKey(); });
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    reason.close({ focus: false });
    window.removeEventListener('keydown', escape, true);
    dialog.remove();
    trigger.focus({ preventScroll: true });
  };
  const close = () => { dialog.close(); cleanup(); };
  const escape = event => {
    if (event.key !== 'Escape' || !dialog.open) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (reason.element.classList.contains('is-open')) reason.close();
    else close();
  };
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', close));
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', cleanup, { once: true });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  window.addEventListener('keydown', escape, true);
  wireBackdropDismiss(dialog);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    const text = message.value.trim();
    if (text.length < 5 || text.length > 3500) {
      error.textContent = 'Please describe what happened in 5–3500 characters.';
      error.hidden = false;
      return;
    }
    saving = true;
    submit.disabled = true;
    message.disabled = true;
    reason.setDisabled(true);
    error.hidden = true;
    dialog.setAttribute('aria-busy', 'true');
    try {
      await profileFetchJson('/api/support/reports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: Number(profile.userId), reason: reason.value, message: text, submissionKey }),
      });
      if (!dialog.isConnected) return;
      const confirmation = document.createElement('p');
      confirmation.className = 'profile-report-success';
      confirmation.setAttribute('role', 'status');
      confirmation.tabIndex = -1;
      confirmation.textContent = 'Report sent. The Bro Battles team can now review the reason and details you shared. If we confirm a violation of the game’s rules, we’ll take appropriate action. Thank you for helping keep the arena safe and fair for everyone.';
      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'bb-button';
      done.textContent = 'Done';
      done.onclick = close;
      form.replaceChildren(confirmation, done);
      confirmation.focus();
    } catch (failure) {
      error.textContent = failure.message || 'Unable to send your report. Please try again.';
      error.hidden = false;
      submit.disabled = false;
      message.disabled = false;
      reason.setDisabled(false);
    } finally {
      saving = false;
      dialog.removeAttribute('aria-busy');
    }
  });
  document.body.append(dialog);
  dialog.showModal();
}
