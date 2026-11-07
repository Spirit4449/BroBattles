const { parseHTML } = require('linkedom');
const { EventEmitter } = require('node:events');
const { createClientModuleGraph } = require('./clientModule');

function createBrowserFixture(html = '', { url = 'https://game.test/', imports = {}, globals = {} } = {}) {
  const { window: domWindow, document } = parseHTML(/<html[ >]/i.test(html) ? html : `<!doctype html><html><head></head><body>${html}</body></html>`);
  // LinkeDOM's defaultView forwards assignments to Node's global object.
  // Keep browser state/timers on an ordinary per-fixture window instead.
  const window = { document };
  for (const key of ['Event', 'CustomEvent', 'Element', 'HTMLElement', 'HTMLSelectElement']) window[key] = domWindow[key];
  for (const key of ['addEventListener', 'removeEventListener', 'dispatchEvent']) window[key] = domWindow[key].bind(domWindow);
  window.window = window;
  Object.defineProperty(document, 'defaultView', { value: window });
  const querySelector = document.querySelector.bind(document);
  document.querySelector = selector => querySelector(selector.replaceAll(':modal', '[data-fixture-modal]'));
  window.HTMLElement.prototype.showModal = function () { this.setAttribute('open', ''); this.setAttribute('data-fixture-modal', ''); };
  window.HTMLElement.prototype.close = function () { this.removeAttribute('open'); this.removeAttribute('data-fixture-modal'); };
  const timers = new Map();
  let timerId = 0, now = 0;
  const later = (callback, delay = 0) => { timers.set(++timerId, { callback, delay, at: now + delay }); return timerId; };
  const cancel = id => timers.delete(id);
  const storage = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
  };
  const localStorage = storage(), sessionStorage = storage();
  Object.assign(window, {
    location: new URL(url), localStorage, sessionStorage,
    setTimeout: later, clearTimeout: cancel, setInterval: later, clearInterval: cancel,
    requestAnimationFrame: fn => later(fn, 16), cancelAnimationFrame: cancel,
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: element => new Proxy({ getPropertyValue: key => element.style.getPropertyValue(key), display: element.style.display || 'block' }, { get: (value, key) => value[key] ?? element.style[key] ?? '' }),
    getSelection: () => ({ toString: () => '' }),
  });
  // LinkeDOM provides structure/events; geometry and browser scheduling remain
  // explicit test boundaries rather than inferred layout or live timers.
  Object.defineProperty(window.HTMLSelectElement.prototype, 'options', { configurable: true, get() { return [...this.querySelectorAll('option')]; } });
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() { return this.querySelector('option[selected]')?.value ?? this.querySelector('option')?.value ?? ''; },
    set(value) { for (const option of this.querySelectorAll('option')) option.toggleAttribute('selected', option.value === String(value)); },
  });
  window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; };
  window.HTMLElement.prototype.getClientRects = function () { return [this.getBoundingClientRect()]; };
  window.HTMLElement.prototype.animate = function () { return { finished: Promise.resolve(), cancel() {}, finish() {} }; };
  window.HTMLElement.prototype.scrollTo = function () {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  const socket = new EventEmitter();
  socket.connected = true;
  const requests = [], sent = [], acknowledgements = [];
  socket.timeout = () => ({ emit(event, payload, acknowledge) { sent.push({ event, payload }); acknowledgements.push(acknowledge); } });
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ success: true, messages: [], systemLogs: [], members: [], ownedSkinIds: [] }) };
  };
  class Observer { observe() {} unobserve() {} disconnect() {} }
  const boundImports = { ...imports };
  const history = Object.fromEntries(['pushState', 'replaceState'].map(method => [method, (_, __, url) => { window.location.href = new URL(url, window.location).href; }]));
  window.history = history;
  const graph = createClientModuleGraph({
    imports: boundImports,
    globals: {
      window, document, location: window.location, localStorage, sessionStorage, history, navigator: { cookieEnabled: true },
      Element: window.Element, HTMLElement: window.HTMLElement, Event: window.Event, CustomEvent: window.CustomEvent,
      setTimeout: later, clearTimeout: cancel, setInterval: later, clearInterval: cancel,
      requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: cancel,
      getComputedStyle: window.getComputedStyle, ResizeObserver: Observer, IntersectionObserver: Observer, MutationObserver: Observer,
      Image: class { constructor() { this.complete = true; } },
      Audio: class { addEventListener() {} removeEventListener() {} load() {} play() { return Promise.resolve(); } pause() {} },
      CSS: { escape: value => value }, performance: { now: () => 1000 }, queueMicrotask,
      fetch, ...globals,
    },
  });
  return { window, document, localStorage, sessionStorage, socket, requests, sent, acknowledgements, timers,
    imports: boundImports, load: graph.load,
    async settle() { await new Promise(resolve => setImmediate(resolve)); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id); now = timer.at;
        await timer.callback();
      }
      now = end;
    },
    async runTimers(delay) {
      for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); await timer.callback(); }
    },
    event(target, type, properties = {}) {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, properties);
      target.dispatchEvent(event);
      return event;
    },
  };
}

module.exports = { createBrowserFixture };
