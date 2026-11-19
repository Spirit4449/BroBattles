import { API_PATHS } from "../../shared/net/apiPaths.js";
import { USERNAME_PATTERN, USERNAME_MIN, USERNAME_MAX } from "../../shared/social/textRules.js";
import { openModalDialog } from '../ui/nativeDialog.js';
import { dismissPopup } from '../ui/popupMotion.js';
import '../styles/accountDialog.css';
import '../styles/formFields.css';
import '../styles/nameChangeDialog.css';

// Both profile surfaces use this dialog, including the in-game lobby profile.
export function wireNameChangeDialog(button, { getProfile, fetchJson, onChanged }) {
  let activeDialog = null;
  let saving = false;
  button?.addEventListener('click', () => {
    const profile = getProfile();
    if (!profile || profile.guest !== false || activeDialog || saving) return;
    const dialog = document.createElement('dialog');
    activeDialog = dialog;
    dialog.id = 'name-change-dialog';
    dialog.className = 'account-dialog bb-popup';
    dialog.setAttribute('aria-labelledby', 'name-change-title');
    dialog.setAttribute('aria-describedby', 'name-change-policy');
    dialog.innerHTML = `
      <header class="bb-popup-header">
        <h2 id="name-change-title" class="bb-popup-title">Change Name</h2>
        <button class="bb-close pixel-menu-button" type="button" data-close aria-label="Close name change"><span aria-hidden="true">×</span></button>
      </header>
      <form class="account-dialog-form">
        <p id="name-change-policy" class="account-dialog-hint">You can change your name <strong>once per month</strong>.</p>
        <div class="name-change-field">
          <label class="form-label" for="new-username">New name</label>
          <div class="username-input-wrap">
            <input id="new-username" class="form-input" name="username" type="text" minlength="${USERNAME_MIN}" maxlength="${USERNAME_MAX}" required autocomplete="off" spellcheck="false" autocapitalize="none" aria-describedby="name-change-validation-reason" />
            <span class="username-status" aria-hidden="true"></span>
          </div>
          <p id="name-change-validation-reason" class="account-dialog-error" role="status" hidden></p>
        </div>
        <p class="name-change-availability" aria-live="polite" hidden></p>
        <p class="account-dialog-error" role="alert" hidden></p>
        <div class="account-dialog-actions">
          <button type="button" class="bb-button" data-close>Cancel</button>
          <button type="submit" class="bb-button">
            <span>Change Name</span>
            <span class="name-change-price"><img src="/assets/icons/gem.webp" alt="" /><span data-cost></span><span class="bb-visually-hidden"> gems</span></span>
          </button>
        </div>
      </form>`;
    const form = dialog.querySelector('form');
    const input = dialog.querySelector('input');
    const submit = dialog.querySelector('[type="submit"]');
    const message = dialog.querySelector('[role="alert"]');
    const availability = dialog.querySelector('.name-change-availability');
    const cost = profile.nameChangeCost ?? 50;
    dialog.querySelectorAll('[data-cost]').forEach(label => { label.textContent = String(cost); });
    input.value = profile.username || '';
    const validation = dialog.querySelector('.username-status');
    const validationReason = dialog.querySelector('#name-change-validation-reason');
    let validationState;
    let validationTimer, validationRequest;
    let validationVersion = 0;
    const render = () => {
      const next = profile.nextNameChangeAt ? new Date(profile.nextNameChangeAt) : null;
      const coolingDown = next && next.getTime() > Date.now();
      const gems = Number(profile.gems) || 0;
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
      validation.title = text;
      validationReason.textContent = state === 'invalid' || state === 'taken' || state === 'error' ? text : '';
      validationReason.hidden = !validationReason.textContent;
      input.setAttribute('aria-invalid', String(state === 'invalid' || state === 'taken'));
      render();
    };
    const validate = () => {
      clearTimeout(validationTimer);
      validationRequest?.abort();
      const version = ++validationVersion;
      message.hidden = true;
      const name = input.value.trim();
      if (!name) return setValidation('', 'Enter a new name');
      if (!USERNAME_PATTERN.test(name)) {
        return setValidation('invalid', `Use ${USERNAME_MIN}–${USERNAME_MAX} letters, numbers, dots, dashes or underscores.`);
      }
      if (name === profile.username) return setValidation('', '');
      setValidation('checking', 'Checking availability');
      validationTimer = setTimeout(async () => {
        validationRequest = new AbortController();
        try {
          const data = await fetchJson(`${API_PATHS.USERNAME_AVAILABILITY}?username=${encodeURIComponent(name)}`, { signal: validationRequest.signal });
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
    setValidation('', '');
    let closing = false;
    const close = () => {
      if (closing || !dialog.open) return;
      closing = true;
      dismissPopup(dialog, () => dialog.close());
    };
    dialog.querySelectorAll('[data-close]').forEach(control => control.addEventListener('click', close));
    const cleanup = () => {
      clearTimeout(validationTimer);
      validationRequest?.abort();
      validationVersion += 1;
      dialog.remove();
      if (activeDialog === dialog) activeDialog = null;
    };
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submit.disabled || closing) return;
      const username = input.value.trim();
      if (!username) return;
      saving = true;
      message.hidden = true;
      render();
      try {
        const data = await fetchJson(API_PATHS.PROFILE_CHANGE_USERNAME, {
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
    document.body.append(dialog);
    openModalDialog(dialog, { escape: true, dismiss: close, onClose: cleanup, trigger: button });
    input.focus();
  });
}
