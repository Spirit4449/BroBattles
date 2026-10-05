// A bundle gets a fresh scope each time it mounts. Only its lexical browser
// bindings are scoped; the real browser APIs (and the router) are never patched.
export function createPageScope(navigate) {
  let active = true;
  const cleanups = new Set();
  const timers = new Map();
  const requests = new Set();
  const bindings = new Map();
  const globals = new Map();
  const abortError = () => new DOMException('Screen was left', 'AbortError');
  const onDispose = fn => { cleanups.add(fn); return () => cleanups.delete(fn); };
  const schedule = (start, cancel, repeat = false, kind = 'timer') => (fn, ...args) => {
    if (!active) return 0;
    const id = start((...values) => {
      if (!repeat) timers.delete(`${kind}:${id}`);
      if (active) fn(...values);
    }, ...args);
    timers.set(`${kind}:${id}`, { id, cancel });
    return id;
  };
  const clear = id => { window.clearTimeout(id); timers.delete(`timer:${id}`); };
  const scopedFetch = async (input, options = {}) => {
    if (!active) throw abortError();
    const controller = new AbortController();
    const signal = options.signal || input?.signal;
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    requests.add(controller);
    try {
      const response = await fetch(input, { ...options, signal: controller.signal });
      if (!active) throw abortError();
      // Keep the controller until disposal: response bodies may still be streaming.
      return new Proxy(response, {
        get(target, key) {
          if (['json', 'text', 'blob', 'arrayBuffer', 'formData'].includes(key)) return async (...args) => {
            try {
              const value = await target[key](...args);
              if (!active) throw abortError();
              return value;
            } finally { requests.delete(controller); }
          };
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  };
  function listen(target, type, listener, options) {
    if (!active || !listener) return;
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    const records = bindings.get(target) || [];
    if (records.some(r => r.type === type && r.listener === listener && r.capture === capture)) return;
    const wrapped = event => {
      if (options?.once) unlisten(target, type, listener, options);
      if (!active) return;
      if (typeof listener === 'function') listener.call(target, event);
      else listener.handleEvent(event);
    };
    records.push({ type, listener, capture, wrapped });
    bindings.set(target, records);
    if (type === 'DOMContentLoaded' && document.readyState !== 'loading') {
      queueMicrotask(() => wrapped(new Event(type)));
    } else target.addEventListener(type, wrapped, options);
  }
  function unlisten(target, type, listener, options) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    const records = bindings.get(target) || [];
    const index = records.findIndex(r => r.type === type && r.listener === listener && r.capture === capture);
    if (index < 0) return;
    target.removeEventListener(type, records[index].wrapped, capture);
    records.splice(index, 1);
  }
  const locationFacade = new Proxy({}, {
    get(_, key) {
      if (key === 'assign' || key === 'replace') return url => { if (active) navigate(url, { replace: key === 'replace' }); };
      const value = window.location[key];
      return typeof value === 'function' ? value.bind(window.location) : value;
    },
    set(_, key, value) {
      if (key === 'href') { if (active) navigate(value); }
      else if (active) window.location[key] = value;
      return true;
    },
  });
  const scope = {
    id: String(Math.random()).slice(2),
    get active() { return active; },
    onDispose,
    location: locationFacade,
    setTimeout: schedule(window.setTimeout.bind(window), window.clearTimeout.bind(window)),
    setInterval: schedule(window.setInterval.bind(window), window.clearInterval.bind(window), true),
    requestAnimationFrame: schedule(window.requestAnimationFrame.bind(window), window.cancelAnimationFrame.bind(window), false, 'frame'),
    clearTimeout: clear, clearInterval: clear,
    cancelAnimationFrame: id => { window.cancelAnimationFrame(id); timers.delete(`frame:${id}`); },
    fetch: scopedFetch,
    Audio: function (...args) {
      const audio = new window.Audio(...args);
      onDispose(() => { audio.pause(); audio.removeAttribute('src'); audio.load(); });
      return audio;
    },
    async dispose() {
      if (!active) return;
      active = false;
      for (const [target, records] of bindings) {
        for (const r of records) target.removeEventListener(r.type, r.wrapped, r.capture);
      }
      bindings.clear();
      for (const { id, cancel } of timers.values()) cancel(id);
      timers.clear();
      for (const controller of requests) controller.abort();
      requests.clear();
      await Promise.allSettled([...cleanups].map(fn => Promise.resolve().then(fn)));
      cleanups.clear();
      for (const [key, record] of globals) {
        if (window[key] !== record.value) continue;
        if (record.descriptor) Object.defineProperty(window, key, record.descriptor);
        else delete window[key];
      }
      globals.clear();
    },
  };
  for (const name of ['ResizeObserver', 'MutationObserver', 'IntersectionObserver']) {
    scope[name] = window[name] && function (...args) {
      const observer = new window[name](...args);
      onDispose(() => observer.disconnect());
      return observer;
    };
  }
  const facades = new WeakMap();
  function facade(target) {
    if (facades.has(target)) return facades.get(target);
    const methods = new Map();
    const proxy = new Proxy({}, {
      get(_, key) {
        if (key === '__BB_PAGE_SCOPE__') return scope;
        if (key === 'addEventListener') return (...args) => listen(target, ...args);
        if (key === 'removeEventListener') return (...args) => unlisten(target, ...args);
        if (key === 'location') return locationFacade;
        if (key === 'dispatchEvent') return event => active ? target.dispatchEvent(event) : false;
        if (target === document && key === 'createElement') return (...args) => {
          const node = document.createElement(...args);
          if (node.tagName === 'SCRIPT') node.dataset.bbPageScope = scope.id;
          return node;
        };
        if (target === window && key === 'visualViewport') return window.visualViewport ? facade(window.visualViewport) : null;
        if (target === window && key === 'matchMedia') return query => facade(window.matchMedia(query));
        if (target === window && key in scope) return scope[key];
        const value = target[key];
        if (typeof value !== 'function' || /^[A-Z]/.test(String(key))) return value;
        const cached = methods.get(key);
        if (cached?.original === value) return cached.bound;
        const bound = value.bind(target);
        methods.set(key, { original: value, bound });
        return bound;
      },
      set(_, key, value) {
        if (!active) return true;
        if (key === 'location') navigate(value);
        else {
          if (target === window && String(key).startsWith('__')) {
            const record = globals.get(key) || { descriptor: Object.getOwnPropertyDescriptor(window, key) };
            record.value = value;
            globals.set(key, record);
          }
          target[key] = value;
        }
        return true;
      },
      has: (_, key) => key in target,
    });
    facades.set(target, proxy);
    return proxy;
  }
  scope.window = facade(window);
  scope.document = facade(document);
  return scope;
}
