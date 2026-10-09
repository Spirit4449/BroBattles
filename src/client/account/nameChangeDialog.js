import { wireBackdropDismiss } from '../site/dialogDismiss.mjs';
import { dismissPopup } from '../ui/popupMotion.js';
import '../styles/nameChangeDialog.css';

// Both profile surfaces use this dialog, including the in-game lobby profile.
export function wireNameChangeDialog(button, { getProfile, fetchJson, beforeOpen, onChanged }) {
  let activeDialog = null;
  let saving = false;
  button?.addEventListener('click', () => {
    const profile = getProfile();
    if (!profile || profile.guest !== false || activeDialog || saving) return;
    beforeOpen?.();
    const dialog = document.createElement('dialog');
    activeDialog = dialog;
    dialog.id = 'name-change-dialog';
    dialog.className = 'name-change-dialog bb-popup';
    dialog.setAttribute('aria-labelledby', 'name-change-title');
    dialog.setAttribute('aria-describedby', 'name-change-policy');
    dialog.innerHTML = `
      <header class="bb-popup-header">
        <h2 id="name-change-title" class="bb-popup-title">Change Name</h2>
        <button class="bb-close pixel-menu-button" type="button" data-close aria-label="Close name change"><span aria-hidden="true">×</span></button>
      </header>
      <form class="name-change-form">
        <div id="name-change-policy" class="name-change-policy">
          <p>You can change your name <strong>once per month</strong>.</p>
        </div>
        <p id="name-change-validation-reason" class="name-change-validation-reason" role="status" aria-live="polite"></p>
        <div class="name-change-field">
        <label for="new-username">New name</label>
        <div class="name-change-input-wrap">
        <input id="new-username" name="username" type="text" minlength="3" maxlength="14" required autocomplete="off" aria-describedby="name-change-policy name-change-availability name-change-validation-reason" />
        <span id="name-change-validation" class="name-change-validation" aria-hidden="true"></span>
        </div>
        </div>
        <p class="name-change-availability" id="name-change-availability" aria-live="polite"></p>
        <p class="name-change-message" role="alert" hidden></p>
        <div class="name-change-actions">
          <button type="button" class="bb-button name-change-cancel" data-close>Cancel</button>
          <button type="submit" class="bb-button name-change-submit"><span>Change Name</span><span class="name-change-price"><img src="/assets/icons/gem.webp" alt="" /><span data-cost>50 gems</span></span></button>
        </div>
      </form>`;
    const form = dialog.querySelector('form');
    const input = dialog.querySelector('input');
    const submit = dialog.querySelector('[type="submit"]');
    const message = dialog.querySelector('.name-change-message');
    const availability = dialog.querySelector('.name-change-availability');
    const cost = profile.nameChangeCost ?? 50;
    dialog.querySelectorAll('[data-cost]').forEach(label => { label.textContent = `${cost} gems`; });
    input.value = profile.username || '';
    const validation = dialog.querySelector('.name-change-validation');
    const validationReason = dialog.querySelector('.name-change-validation-reason');
    let validationState = 'available';
    let validationTimer, validationRequest;
    let validationVersion = 0;
    const render = () => {
      const next = profile.nextNameChangeAt ? new Date(profile.nextNameChangeAt) : null;
      const coolingDown = next && next.getTime() > Date.now();
      const gems = Number(profile.gems) || 0;
      availability.setAttribute('data-state', coolingDown ? 'cooldown' : gems < cost ? 'insufficient' : 'ready');
      availability.textContent = coolingDown
        ? `Available again ${next.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} at ${next.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`
        : gems < cost ? `You need ${cost} gems to change your name.` : '';
      availability.hidden = !availability.textContent;
      submit.disabled = saving || !!coolingDown || gems < cost || validationState !== 'available';
      input.disabled = saving;
      dialog.setAttribute('aria-busy', String(saving));
    };
    const setValidation = (state, text) => {
      validationState = state;
      validation.setAttribute('data-state', state);
      validation.textContent = ({ available: '✓', invalid: '×', taken: '×', checking: '…', error: '?' })[state] || '';
      validation.setAttribute('aria-label', text);
      validation.title = text;
      validationReason.textContent = state === 'invalid' || state === 'taken' || state === 'error' ? text : '';
      input.setAttribute('aria-invalid', String(state === 'invalid' || state === 'taken'));
      render();
    };
    const validate = () => {
      clearTimeout(validationTimer);
      validationRequest?.abort();
      const version = ++validationVersion;
      const name = input.value.trim();
      if (!name) return setValidation('', 'Enter a new name');
      if (!/^[a-zA-Z0-9_.-]{3,14}$/.test(name)) {
        return setValidation('invalid', 'Use 3–14 letters, numbers, dots, dashes or underscores.');
      }
      if (name === profile.username) return setValidation('available', 'Your current name');
      setValidation('checking', 'Checking availability');
      validationTimer = setTimeout(async () => {
        validationRequest = new AbortController();
        try {
          const data = await fetchJson(`/username-availability?username=${encodeURIComponent(name)}`, { signal: validationRequest.signal });
          if (version !== validationVersion || !dialog.open) return;
          setValidation(data.available ? 'available' : 'taken', data.available ? 'Username available' : 'Username already taken');
        } catch (error) {
          if (error.name !== 'AbortError' && version === validationVersion && dialog.open) {
            setValidation('error', 'Could not check availability. Edit your name to retry.');
          }
        }
      }, 300);
    };
    input.addEventListener('input', validate);
    setValidation('available', 'Your current name');
    let closing = false;
    const close = () => {
      if (closing || !dialog.open) return;
      closing = true;
      dismissPopup(dialog, () => dialog.close());
    };
    dialog.querySelectorAll('[data-close]').forEach(control => control.addEventListener('click', close));
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    // Intercept before the lobby's document-level capture listener closes the parent.
    const escape = event => {
      if (event.key !== 'Escape' || !dialog.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', escape, true);
    dialog.addEventListener('keydown', event => event.stopPropagation());
    wireBackdropDismiss(dialog);
    let unregisterScope;
    dialog.addEventListener('close', () => {
      unregisterScope?.();
      clearTimeout(validationTimer);
      validationRequest?.abort();
      validationVersion += 1;
      window.removeEventListener('keydown', escape, true);
      dialog.remove();
      if (activeDialog === dialog) activeDialog = null;
      if (button?.isConnected) button.focus({ preventScroll: true });
    }, { once: true });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submit.disabled || saving) return;
      const username = input.value.trim();
      if (!username) return;
      saving = true;
      message.hidden = true;
      render();
      try {
        const data = await fetchJson('/profile/change-username', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
        });
        profile.username = data.username || username;
        profile.gems = data.gems;
        profile.nextNameChangeAt = data.nextNameChangeAt;
        onChanged?.(data, profile);
        close();
      } catch (error) {
        if (error.nextNameChangeAt) profile.nextNameChangeAt = error.nextNameChangeAt;
        message.textContent = error.message || 'Unable to update your name.';
        message.hidden = false;
      } finally {
        saving = false;
        render();
      }
    });
    render();
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    unregisterScope = window.__BB_PAGE_SCOPE__?.onDispose(() => dialog.close());
  });
}
