import "../styles/ui-system.css";
import { API_PATHS } from "../../shared/net/apiPaths.js";
import { USERNAME_PATTERN, PASSWORD_MIN, PASSWORD_MAX } from "../../shared/social/textRules.js";
import { VERIFICATION_CODE_PATTERN } from "../../shared/social/verificationCode.js";
import siteConfig from "../../shared/site/siteConfig.json";
import { initSiteShell } from "../site/shell.js";
import { getDisplayName } from "../lib/cookies.js";
import { getJson, postJson, requestJson } from "../lib/http.js";
import { wireFullscreenToggles } from "../ui/fullscreen.js";
import "../styles/accounts.css";
import "../styles/formFields.css";
import "../styles/emailControls.css";
import { codeInputMarkup, createCooldown, safeReturnPath, wireCodeInputs } from '../account/emailVerificationUI';
import "../styles/ui-components.css";

initSiteShell();

wireFullscreenToggles();
const form = document.getElementById('signupForm');
const panel = document.getElementById('verification-panel');
const title = document.getElementById('auth-title');
const subtitle = document.querySelector('.subtitle');
const emailInput = document.getElementById('email');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const error = document.getElementById('errorMessage');
const codeInputs = document.getElementById('code-inputs');
codeInputs.innerHTML = codeInputMarkup();
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

function api(url, body) {
  return requestJson(url, { method: body ? 'POST' : 'GET', body, fallbackMessage: 'Please try again.' });
}
function message(node, text) { node.textContent = text || ''; node.style.display = text ? 'block' : 'none'; }
function showVerification(data) { challengeId = data.challengeId; sentEmail = data.email; correctionUsed = !!data.correctionUsed; document.getElementById('verification-email').textContent = data.email; title.textContent = 'Verify your email'; subtitle.hidden = true; form.hidden = true; panel.hidden = false; document.querySelector('.guest-info').hidden = true; digits.clear(); digits.focus(); }
function showSignup() { panel.hidden = true; form.hidden = false; title.textContent = 'Create Account'; subtitle.hidden = false; message(document.getElementById('verification-message'), ''); emailInput.focus(); }
function setResend(seconds) { cooldown.set(seconds); }

document.getElementById('guestName').textContent = getDisplayName();
const guestSession = postJson(API_PATHS.STATUS, undefined, {
  fallbackMessage: 'Unable to start your guest session. Please reload.',
}).then(data => {
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
  if (!USERNAME_PATTERN.test(name)) return usernameState('invalid', 'Use 3–14 letters, numbers, dots, dashes or underscores.');
  usernameState('checking', 'Checking availability');
  availabilityTimer = setTimeout(async () => {
    availabilityRequest = new AbortController();
    try {
      const data = await getJson(`${API_PATHS.USERNAME_AVAILABILITY}?username=${encodeURIComponent(name)}`, { signal: availabilityRequest.signal });
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
  if (!USERNAME_PATTERN.test(username) || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX || !emailInput.reportValidity()) return message(error, 'Enter a valid username, password, and email address.');
  busy = true; refresh();
  try { await guestSession; const data = await api(API_PATHS.SIGNUP, { username, password, email, accepted: document.getElementById('legal-accept').checked, marketingConsent: document.getElementById('marketing-consent').checked, termsVersion: siteConfig.termsVersion, privacyVersion: siteConfig.privacyVersion }); showVerification(data); setResend(data.resendAfter); }
  catch (err) { message(error, err.message); } finally { busy = false; refresh(); }
});
const digits = wireCodeInputs(codeInputs, () => verify.click());
document.getElementById('verify-button').addEventListener('click', async () => {
  if (busy) return;
  if (!VERIFICATION_CODE_PATTERN.test(digits.value())) return message(document.getElementById('verification-message'), 'Enter the complete verification code.');
  busy = true; refresh();
  try { await api('/signup/verify', { challengeId, code: digits.value() }); location.href = safeNext; }
  catch (err) { message(document.getElementById('verification-message'), err.message); digits.clear(); digits.focus(); }
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
