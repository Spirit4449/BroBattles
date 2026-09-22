import { sonner } from './sonner.js';
import '../styles/emailControls.css';
import '../styles/sonner.css';
import { wireBackdropDismiss } from '../site/dialogDismiss.mjs';
import { createCooldown, wireCodeInputs } from './emailVerificationUI';

export function wireEmailSettings(fetchJson, profile) {
  // Guest profiles can see the account panel while its member controls are
  // hidden. The email API intentionally rejects guest sessions with 403.
  if (profile?.guest !== false) return;
  const toggle = document.getElementById('email-toggle');
  if (!toggle || toggle.dataset.emailWired) return;
  toggle.dataset.emailWired = 'true';
  const status = document.getElementById('email-status');
  let currentEmail = '', activeDialog;
  const post = (url, body) => fetchJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const show = value => {
    currentEmail = value || '';
    if (status) status.textContent = currentEmail;
    toggle.textContent = currentEmail ? 'Change Email Address' : 'Add Email Address';
  };
  fetchJson('/profile/email').then(data => show(data.email)).catch(() => {});
  toggle.addEventListener('click', () => {
    if (activeDialog?.open) return;
    const dialog = document.createElement('dialog');
    activeDialog = dialog;
    dialog.className = 'email-dialog';
    dialog.setAttribute('aria-labelledby', 'email-dialog-title');
    dialog.innerHTML = `<div class="email-dialog-card">
      <button type="button" class="email-dialog-close" aria-label="Close email settings">×</button>
      <p class="email-dialog-eyebrow">ACCOUNT EMAIL</p>
      <h2 id="email-dialog-title"></h2>
      <form data-address-step class="email-step">
        <label for="replacement-email">Email address</label>
        <input id="replacement-email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com" spellcheck="false" autocapitalize="none" />
        <button class="profile-btn" type="submit" data-send>Send code</button>
        <button type="button" class="email-text-button" data-resume hidden>Back</button>
      </form>
      <section data-code-step class="email-step" hidden>
        <div class="verification-destination"><span data-destination></span><button type="button" class="email-edit pixel-menu-button" aria-label="Edit email address">Edit</button></div>
        <div class="email-code-inputs" role="group" aria-label="Six-digit verification code">${Array.from({length:6}, (_,i) => `<input type="text" inputmode="numeric" autocomplete="${i ? 'off' : 'one-time-code'}" maxlength="${i ? 1 : 6}" aria-label="Digit ${i+1}" />`).join('')}</div>
        <button type="button" class="profile-btn" data-verify>Verify email</button>
        <button type="button" class="email-text-button" data-resend>Resend code</button>
      </section>
      <p class="email-dialog-message" data-message role="status" aria-live="polite" hidden></p>
      <label class="email-marketing-setting"><input type="checkbox" data-marketing disabled /><span>Occasional news &amp; updates</span></label>
    </div>`;
    const addressStep = dialog.querySelector('[data-address-step]');
    const codeStep = dialog.querySelector('[data-code-step]');
    const email = dialog.querySelector('#replacement-email');
    const send = dialog.querySelector('[data-send]'), resend = dialog.querySelector('[data-resend]');
    const verify = dialog.querySelector('[data-verify]'), edit = dialog.querySelector('.email-edit');
    const resume = dialog.querySelector('[data-resume]');
    const marketing = dialog.querySelector('[data-marketing]');
    const title = dialog.querySelector('h2'), message = dialog.querySelector('[data-message]');
    let busy = true, sentEmail = '', correctionUsed = false, subscribed = false, preferenceLoaded = false;
    const tell = (text = '', isError = false) => { message.textContent = text; message.hidden = !text; message.classList.toggle('is-error', isError); };
    const canCorrect = () => sentEmail && email.value.trim().toLowerCase() !== sentEmail && !correctionUsed;
    const refresh = () => {
      const seconds = cooldown.remaining();
      send.disabled = busy || (seconds > 0 && !canCorrect());
      send.textContent = seconds && !canCorrect() ? `Send code in ${seconds} sec` : 'Send code';
      resend.disabled = busy || seconds > 0;
      resend.textContent = seconds ? `Resend in ${seconds} sec` : 'Resend code';
      verify.disabled = edit.disabled = busy;
      resume.hidden = !sentEmail;
      resume.disabled = busy;
      email.readOnly = busy;
      marketing.disabled = busy || !currentEmail || !preferenceLoaded;
      dialog.setAttribute('aria-busy', String(busy));
    };
    const cooldown = createCooldown(refresh);
    const digits = wireCodeInputs(dialog.querySelector('.email-code-inputs'), () => verify.click());
    const showAddress = () => { title.textContent = currentEmail ? 'Change email address' : 'Add email address'; addressStep.hidden = false; codeStep.hidden = true; tell(); email.focus(); refresh(); };
    const showCode = () => { title.textContent = 'Check your inbox'; addressStep.hidden = true; codeStep.hidden = false; dialog.querySelector('[data-destination]').textContent = sentEmail; digits.clear(); digits.focus(); };
    async function sendCode(target) {
      if (busy) return;
      busy = true; tell(); refresh();
      try {
        const result = await post('/profile/email/send-code', { email: target });
        if (!dialog.open) return;
        sentEmail = target.trim().toLowerCase();
        correctionUsed = !!result.correctionUsed;
        cooldown.set(result.resendAfter ?? 60);
        showCode();
      } catch (error) { tell(error.message, true); }
      finally { busy = false; refresh(); }
    }
    addressStep.addEventListener('submit', event => { event.preventDefault(); if (!send.disabled && email.reportValidity()) void sendCode(email.value); });
    email.addEventListener('input', refresh);
    resend.addEventListener('click', () => { if (!resend.disabled) void sendCode(sentEmail); });
    edit.addEventListener('click', showAddress);
    resume.addEventListener('click', () => { email.value = sentEmail; tell(); showCode(); });
    verify.addEventListener('click', async () => {
      if (busy) return;
      if (!/^\d{6}$/.test(digits.value())) { tell('Enter all six digits.', true); digits.focus(); return; }
      busy = true; tell(); refresh();
      try {
        const result = await post('/profile/email/verify', { code: digits.value() });
        show(result.email); dialog.close();
        sonner('Email address updated.', undefined, 'success');
      } catch (error) { tell(error.message, true); digits.clear(); digits.focus(); }
      finally { busy = false; refresh(); }
    });
    marketing.addEventListener('change', async () => {
      const next = marketing.checked;
      busy = true; tell(); refresh();
      try { await post('/profile/email/marketing', { subscribed: next }); subscribed = next; notify('Email preference saved.', undefined, 'success'); }
      catch (error) { marketing.checked = subscribed; notify('Could not save email preference', error.message, 'error'); }
      finally { busy = false; refresh(); }
    });
    // Keep notifications in the modal top layer, above its backdrop.
    const toastWrap = document.createElement('div');
    toastWrap.id = 'email-settings-toasts';
    toastWrap.className = 'sonner-wrap';
    dialog.append(toastWrap);
    const notify = (header, text, tone) => {
      if (dialog.open) sonner(header, text, 'OK', undefined, { tone, containerId: toastWrap.id });
      else sonner(header, text, 'OK', undefined, { tone });
    };
    const escape = event => {
      if (event.key !== 'Escape' || !dialog.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dialog.close();
    };
    window.addEventListener('keydown', escape, true);
    dialog.querySelector('.email-dialog-close').onclick = () => dialog.close();
    wireBackdropDismiss(dialog);
    dialog.addEventListener('close', () => { window.removeEventListener('keydown', escape, true); cooldown.dispose(); dialog.remove(); activeDialog = null; toggle.focus({preventScroll:true}); }, { once: true });
    document.body.append(dialog); dialog.showModal(); email.value = currentEmail; showAddress();
    Promise.allSettled([fetchJson('/profile/email'), fetchJson('/profile/email/marketing')]).then(([accountResult, preferenceResult]) => {
      if (!dialog.open) return;
      if (accountResult.status !== 'fulfilled') throw accountResult.reason;
      const data = accountResult.value;
      show(data.email);
      sentEmail = data.pendingEmail || '';
      correctionUsed = !!data.correctionUsed;
      preferenceLoaded = preferenceResult.status === 'fulfilled';
      subscribed = preferenceLoaded && !!preferenceResult.value.subscribed;
      if (!preferenceLoaded) marketing.title = 'Email preferences are temporarily unavailable.';
      marketing.checked = subscribed;
      cooldown.set(data.resendAfter || 0);
    }).catch(error => tell(error.message, true)).finally(() => { busy = false; refresh(); });
  });
}
