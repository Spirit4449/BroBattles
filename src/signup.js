import siteConfig from "./shared/siteConfig.json";
import "./site/shell.js";
import { getDisplayName } from "./lib/cookies.js";
import { wireFullscreenToggles } from "./lib/fullscreen.js";
import "./styles/accounts.css";
import "./styles/emailControls.css";
import { createCooldown, safeReturnPath, wireCodeInputs } from './lib/emailVerificationUI';

wireFullscreenToggles();
const form = document.getElementById('signupForm');
const panel = document.getElementById('verification-panel');
const emailInput = document.getElementById('email');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const error = document.getElementById('errorMessage');
const inputs = [...document.querySelectorAll('#code-inputs input')];
let challengeId = '';
const requestedNext = new URLSearchParams(location.search).get('next');
const safeNext = safeReturnPath(requestedNext, location.origin);
let busy = false, sentEmail = '', correctionUsed = false;
const submit = document.getElementById('signupBtn');
const resend = document.getElementById('resend-button');
const verify = document.getElementById('verify-button');
const edit = document.getElementById('edit-signup');
function refresh() {
  const seconds = cooldown.remaining();
  const correction = sentEmail && sentEmail !== emailInput.value.trim().toLowerCase() && !correctionUsed;
  submit.disabled = busy || (seconds > 0 && !correction);
  document.getElementById('buttonText').textContent = busy ? 'Please wait…' : seconds && !correction ? `Send code in ${seconds} sec` : 'Create Account';
  resend.disabled = busy || seconds > 0;
  resend.textContent = seconds ? `Resend in ${seconds} sec` : 'Resend code';
  verify.disabled = edit.disabled = busy;
  panel.setAttribute('aria-busy', String(busy));
  [emailInput, usernameInput, passwordInput].forEach(input => { input.readOnly = busy; });
}
const cooldown = createCooldown(refresh);

async function api(url, body) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Please try again.');
  return data;
}
function message(node, text) { node.textContent = text || ''; node.style.display = text ? 'block' : 'none'; }
function currentCode() { return inputs.map(input => input.value).join(''); }
function showVerification(data) { challengeId = data.challengeId; sentEmail = data.email; correctionUsed = !!data.correctionUsed; document.getElementById('verification-email').textContent = data.email; form.hidden = true; panel.hidden = false; document.querySelector('.guest-info').hidden = true; digits.clear(); inputs[0].focus(); }
function showSignup() { panel.hidden = true; form.hidden = false; message(document.getElementById('verification-message'), ''); emailInput.focus(); }
function setResend(seconds) { cooldown.set(seconds); }

document.getElementById('guestName').textContent = getDisplayName();
const guestSession = fetch('/status', { method: 'POST', credentials: 'same-origin' }).then(async response => {
  if (!response.ok) throw new Error('Unable to start your guest session. Please reload.');
  const data = await response.json();
  document.getElementById('guestName').textContent = data.userData?.name || getDisplayName();
});
guestSession.catch(err => message(error, err.message));

let availabilityTimer, availabilityRequest;
const availability = document.getElementById('username-status');
function usernameState(state, text) {
  availability.dataset.state = state;
  availability.textContent = ({checking:'…', available:'✓', taken:'×', invalid:'×', error:'?'})[state] || '';
  availability.setAttribute('aria-label', text);
  availability.title = text;
}
usernameInput.addEventListener('input', () => {
  clearTimeout(availabilityTimer); availabilityRequest?.abort();
  const name = usernameInput.value.trim();
  usernameInput.setCustomValidity('');
  if (!name) return usernameState('', '');
  if (!/^[a-zA-Z0-9_.-]{3,14}$/.test(name)) return usernameState('invalid', 'Use 3–14 letters, numbers, dots, dashes or underscores.');
  usernameState('checking', 'Checking availability');
  availabilityTimer = setTimeout(async () => {
    availabilityRequest = new AbortController();
    try {
      const response = await fetch(`/username-availability?username=${encodeURIComponent(name)}`, {credentials:'same-origin', signal:availabilityRequest.signal});
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (usernameInput.value.trim() !== name) return;
      usernameState(data.available ? 'available' : 'taken', data.available ? 'Username available' : 'Username already taken');
      usernameInput.setCustomValidity(data.available ? '' : 'That username is already taken.');
    } catch (err) { if (err.name !== 'AbortError' && usernameInput.value.trim() === name) usernameState('error', 'Availability unavailable; you can still try signup.'); }
  }, 300);
});
emailInput.addEventListener('input', refresh);

form.addEventListener('submit', async event => {
  event.preventDefault(); message(error, '');
  if (busy || submit.disabled) return;
  const username = usernameInput.value.trim(), password = passwordInput.value, email = emailInput.value.trim();
  if (!/^[a-zA-Z0-9_.-]{3,14}$/.test(username) || password.length < 6 || password.length > 32 || !emailInput.reportValidity()) return message(error, 'Enter a valid username, password, and email address.');
  busy = true; refresh();
  try { await guestSession; const data = await api('/signup', { username, password, email, accepted: document.getElementById('legal-accept').checked, marketingConsent: document.getElementById('marketing-consent').checked, termsVersion: siteConfig.termsVersion, privacyVersion: siteConfig.privacyVersion }); showVerification(data); setResend(data.resendAfter); }
  catch (err) { message(error, err.message); } finally { busy = false; refresh(); }
});
const digits = wireCodeInputs(document.getElementById('code-inputs'), () => verify.click());
document.getElementById('verify-button').addEventListener('click', async () => {
  if (busy) return;
  if (currentCode().length !== 6) return message(document.getElementById('verification-message'), 'Enter all six digits.');
  busy = true; refresh();
  try { await api('/signup/verify', { challengeId, code: currentCode() }); location.href = safeNext; }
  catch (err) { message(document.getElementById('verification-message'), err.message); inputs.forEach(input => { input.value = ''; }); inputs[0].focus(); }
  finally { busy = false; refresh(); }
});
document.getElementById('resend-button').addEventListener('click', async () => {
  if (busy || cooldown.remaining()) return;
  busy = true; refresh();
  try { const data = await api('/signup/resend', { challengeId }); showVerification(data); setResend(data.resendAfter); message(document.getElementById('verification-message'), 'A fresh code is on its way.'); }
  catch (err) { message(document.getElementById('verification-message'), err.message); }
  finally { busy = false; refresh(); }
});
document.getElementById('edit-signup').addEventListener('click', async () => {
  if (busy) return; busy = true; refresh();
  try { await api('/signup/cancel', {}); showSignup(); document.querySelector('.guest-info').hidden = false; }
  catch (err) { message(document.getElementById('verification-message'), err.message); }
  finally { busy = false; refresh(); }
});
busy = true; refresh();
guestSession.then(() => api('/signup/pending')).then(data => {
  if (data.email) { emailInput.value = data.email; usernameInput.value = data.username || ''; sentEmail = data.email; correctionUsed = !!data.correctionUsed; }
  if (data.pending) showVerification(data);
  setResend(data.resendAfter || 0);
}).catch(err => message(error, err.message)).finally(() => { busy = false; refresh(); });
