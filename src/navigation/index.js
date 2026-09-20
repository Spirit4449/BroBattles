import { createPageScope } from './pageScope';
import { createBattlePreloader } from './preload';

const bindings = 'window,document,location,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame,cancelAnimationFrame,fetch,Audio,ResizeObserver,MutationObserver,IntersectionObserver';
const supported = url => url.origin === location.origin && /^(\/$|\/party\/[^/]+\/?$|\/game\/[^/]+\/?$)/.test(url.pathname);
let currentScope;
let sequence = 0;
let transition;
let readinessTimer;
let audioContext;
let pendingFetch;
let cleanupPromise = Promise.resolve();
let mounted = true;
const preloader = createBattlePreloader();

function scope() {
  if (!currentScope || !currentScope.active) currentScope = createPageScope(navigate);
  return currentScope;
}
function getAudioContext() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (Context && (!audioContext || audioContext.state === 'closed')) audioContext = new Context();
  return audioContext;
}
function unlockAudio() { getAudioContext()?.resume().catch(() => {}); }
document.addEventListener('pointerdown', unlockAudio, { passive: true });
document.addEventListener('keydown', unlockAudio);

function showTransition(message) {
  if (!transition) {
    transition = document.createElement('div');
    transition.id = 'bb-route-transition';
    transition.setAttribute('role', 'status');
    transition.setAttribute('aria-live', 'polite');
    transition.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-content:center;text-align:center;background:#111b2b url(/assets/loadingscreen.webp) center/cover;color:white;font:700 20px system-ui;isolation:isolate';
    const panel = document.createElement('div');
    panel.style.cssText = 'padding:24px 32px;border-radius:16px;background:rgba(10,18,32,.9);max-width:80vw';
    const label = document.createElement('p');
    label.id = 'bb-route-message';
    const retry = document.createElement('button');
    retry.textContent = 'Try again';
    retry.hidden = true;
    retry.onclick = () => navigate(transition.dataset.destination || location.href, { replace: true });
    panel.append(label, retry);
    transition.append(panel);
    document.body.append(transition);
  }
  transition.querySelector('p').textContent = message;
  transition.querySelector('button').hidden = true;
  transition.hidden = false;
  transition.style.display = 'grid';
}
function ready() {
  if (!mounted) return;
  clearTimeout(readinessTimer);
  transition?.remove();
  transition = null;
  if (!location.pathname.startsWith('/game/')) preloader.start();
}
function fail(error) {
  console.error('[navigation]', error);
  showTransition('Unable to finish loading. Please try again.');
  transition.querySelector('button').hidden = false;
}
document.addEventListener('lobby:ready', ready);
document.addEventListener('game:ready', ready);
// A join request is also an interactive, finished lobby screen.
document.addEventListener('lobby:join-request', ready);

function runInline(fn) {
  const owner = scope();
  fn(...bindings.split(',').map(key => owner[key]));
}
async function executeScript(source, owner) {
  if (!owner.active) return;
  if (source.src && (/\/socket\.io\/socket\.io\.js/.test(source.src) || /\/bundles\/navigation[.]/.test(source.src))) return;
  if (source.src && /phaser-arcade-physics/.test(source.src) && window.Phaser) return;
  const script = document.createElement('script');
  if (source.src) {
    script.src = source.src;
    script.dataset.bbPageScope = owner.id;
    script.async = false;
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Unable to load ${source.src}`));
      document.body.append(script);
    });
  } else {
    // Inline templates use the same lexical lifetime as their entry bundle.
    script.textContent = source.textContent;
    document.body.append(script);
  }
  script.remove();
}
async function navigate(target, { replace = false, pop = false } = {}) {
  const url = new URL(target, location.href);
  if (!supported(url)) {
    if (replace) location.replace(url.href); else location.assign(url.href);
    return;
  }
  const ticket = ++sequence;
  mounted = false;
  preloader.stop();
  pendingFetch?.abort();
  const controller = new AbortController();
  pendingFetch = controller;
  showTransition(url.pathname.startsWith('/game/') ? 'Preparing your battle…' : 'Preparing your lobby…');
  transition.dataset.destination = url.href;
  clearTimeout(readinessTimer);
  readinessTimer = setTimeout(() => { if (ticket === sequence) fail(new Error('Screen readiness timed out')); }, 45000);
  try {
    const response = await fetch(url.href, { credentials: 'same-origin', signal: controller.signal });
    const finalUrl = new URL(response.url);
    if (!supported(finalUrl)) { location.assign(finalUrl.href); return; }
    if (!response.ok) throw new Error(`Page request failed (${response.status})`);
    const html = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (ticket !== sequence) return;
    const outgoing = currentScope;
    cleanupPromise = cleanupPromise.then(() => outgoing?.dispose());
    await cleanupPromise;
    if (ticket !== sequence) return;
    // Keep the actual html/body nodes: the fullscreen element stays attached.
    if (!pop) history[replace ? 'replaceState' : 'pushState']({}, '', finalUrl.href);
    else if (finalUrl.href !== location.href) history.replaceState({}, '', finalUrl.href);
    document.title = html.title;
    for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
    for (const attribute of [...html.body.attributes]) document.body.setAttribute(attribute.name, attribute.value);
    const scripts = [...html.querySelectorAll('script')];
    scripts.forEach(script => script.remove());
    const oldStyles = [...document.head.querySelectorAll('link[rel="stylesheet"], style:not([data-navigation])')];
    const styleLoads = [];
    const newStyles = [];
    for (const node of html.head.querySelectorAll('link[rel="stylesheet"], style')) {
      const copy = node.cloneNode(true);
      newStyles.push(copy);
      if (copy.tagName === 'LINK') styleLoads.push(new Promise((resolve, reject) => {
        copy.onload = resolve;
        copy.onerror = () => reject(new Error(`Unable to load ${copy.href}`));
      }));
      document.head.append(copy);
    }
    await Promise.all(styleLoads);
    if (ticket !== sequence) { newStyles.forEach(node => node.remove()); return; }
    oldStyles.forEach(node => node.remove());
    document.body.replaceChildren(...html.body.childNodes, transition);
    currentScope = createPageScope(navigate);
    mounted = true;
    // Each entry is deliberately a fresh runtime. Discard old lazy-chunk
    // registrations so they cannot retain a retired page's module closures.
    window.webpackChunkBroBattles = [];
    window.__BOOT_GAME__ = undefined;
    window.updateLoading = undefined;
    window.markMatchBackgroundReady = undefined;
    for (const script of scripts) {
      if (ticket !== sequence) return;
      await executeScript(script, currentScope);
    }
    if (!html.body.dataset.bbScreen && ticket === sequence) ready();
  } catch (error) {
    if (ticket === sequence && error.name !== 'AbortError') fail(error);
  }
}
document.addEventListener('click', event => {
  const link = event.target.closest?.('a[href]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || link.download || (link.target && link.target !== '_self')) return;
  const url = new URL(link.href);
  if (!supported(url) || (url.pathname === location.pathname && url.search === location.search && url.hash)) return;
  event.preventDefault();
  void navigate(url.href);
});
window.addEventListener('popstate', () => { if (supported(new URL(location.href))) void navigate(location.href, { pop: true }); });
function scriptScope() {
  const id = document.currentScript?.dataset.bbPageScope;
  if (id && (id !== currentScope?.id || !currentScope.active)) return null;
  return scope();
}
function progress(percent, message) {
  if (transition && mounted) transition.querySelector('p').textContent = `${message || 'Preparing your battle…'} ${Math.round(percent)}%`;
}
window.__BB_NAVIGATION__ = { scope, scriptScope, runInline, navigate, getAudioContext, preload: preloader.enqueue, fail, progress };
