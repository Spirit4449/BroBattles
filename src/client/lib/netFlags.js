// Network A/B switches (see docs/development/networking.md, "Production
// network tracing"): `?netProjectileLead=0`, `?netInputCadence=legacy`,
// `?netRenderDelay=legacy`, `?netRemoteLead=legacy`. Every `net<Name>=<value>`
// seen on any page is kept for this tab in sessionStorage, like the nettrace
// spec, so a flag on the first URL still applies on the game page after the
// lobby -> party -> game navigation. `?netflags=off` clears the stored ones
// (flags on that same URL then apply). Read once per page; costs nothing else.
const STORAGE_KEY = "bb:netflags";
const NAME = /^net[A-Z][A-Za-z0-9]{0,39}$/;
const VALUE = /^[A-Za-z0-9_.-]{1,40}$/;

export function readNetFlags(win = typeof window !== "undefined" ? window : null) {
  if (!win) return {};
  try {
    const query = new URLSearchParams(win.location?.search || "");
    const off = query.get("netflags") === "off";
    const store = win.sessionStorage;
    let flags = {};
    if (!off) {
      const stored = JSON.parse(store?.getItem(STORAGE_KEY) || "null");
      if (stored && typeof stored === "object") {
        for (const [k, v] of Object.entries(stored)) if (NAME.test(k) && VALUE.test(String(v))) flags[k] = String(v);
      }
    }
    let seen = false;
    for (const [k, v] of query) {
      if (NAME.test(k) && VALUE.test(v)) { flags[k] = v; seen = true; }
    }
    if (off && !seen) store?.removeItem(STORAGE_KEY);
    else if (seen) store?.setItem(STORAGE_KEY, JSON.stringify(flags));
    return flags;
  } catch (_) {
    return {};
  }
}

// The effective flags as a query string, for parsers that take one.
export function netFlagSearch(win) {
  return new URLSearchParams(readNetFlags(win)).toString();
}
