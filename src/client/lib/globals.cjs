// Browser integration points shared by independent entry and lazy bundles.
// Diagnostics keep their public names for the browser network and rendering tools.
const BROWSER_GLOBALS = Object.freeze({
  navigation: "__BB_NAVIGATION__",
  pageScope: "__BB_PAGE_SCOPE__",
  matchSession: "__MATCH_SESSION__",
  forceMobileControls: "__BB_FORCE_MOBILE_CONTROLS",
  remotePlayers: "__BB_REMOTE_PLAYERS__",
  networkDiagnostics: "__BB_NETWORK_DIAGNOSTICS__",
  netTrace: "__BB_NET_TRACE__",
  netTraceSocket: "__BB_NET_TRACE_SOCKET__",
});

function getNavigation() {
  return typeof window === "undefined" ? undefined : window[BROWSER_GLOBALS.navigation];
}

function getPageScope() {
  return typeof window === "undefined" ? undefined : window[BROWSER_GLOBALS.pageScope];
}

function getMatchSession() {
  return typeof window === "undefined" ? undefined : window[BROWSER_GLOBALS.matchSession];
}

module.exports = { BROWSER_GLOBALS, getNavigation, getPageScope, getMatchSession };
