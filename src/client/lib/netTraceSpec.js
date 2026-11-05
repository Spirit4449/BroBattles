// Opt-in production network tracing (see docs/development/networking.md).
// `?nettrace=<runId>&ntk=<token>[&ntag=<label>]` on any page stores the spec
// for this tab, so it survives the lobby -> game navigation. `?nettrace=off`
// clears it. The server ignores the spec unless the token matches.
const STORAGE_KEY = "bb:nettrace";
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function readNetTraceSpec(win = typeof window !== "undefined" ? window : null) {
  if (!win) return null;
  try {
    const query = new URLSearchParams(win.location?.search || "");
    const runId = query.get("nettrace");
    if (runId === "off") {
      win.sessionStorage?.removeItem(STORAGE_KEY);
      return null;
    }
    if (runId && ID.test(runId) && query.get("ntk")) {
      const tag = query.get("ntag");
      const spec = { runId, token: query.get("ntk"), tag: tag && ID.test(tag) ? tag : null };
      win.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(spec));
      return spec;
    }
    const stored = JSON.parse(win.sessionStorage?.getItem(STORAGE_KEY) || "null");
    return stored && ID.test(stored.runId) && stored.token ? stored : null;
  } catch (_) {
    return null;
  }
}
