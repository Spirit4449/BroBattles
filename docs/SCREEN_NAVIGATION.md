# Lobby and battle navigation

`navigation.bundle.js` owns `/`, `/party/:id`, and `/game/:id` within one
browser document. Supported transitions never reload the page. Server route
requests still enforce existing redirects and missing-party/match handling.

Party-to-party and solo-to-party transitions retain the lobby DOM, scripts,
styles, page scope, and Socket.IO connection. The lobby route handler refreshes
authoritative party data (or solo status), resets route-specific roster and
ready state, and updates the controls. Server party endpoints move the existing
socket between rooms. An AbortSignal and route checks prevent older responses
from painting a newer lobby. Leaving a party does not wait for an exit animation.

Entering or leaving a game retires the outgoing page scope and mounts the
new screen within the same html/body nodes. Shared styles are reused, with the
destination cascade order preserved. Only new same-origin styles block mounting;
remote font styles cannot delay every transition. Font preloads are copied and
Phaser startup explicitly waits for both canvas HUD fonts to decode. The route
loading bar stays above the game template until `game:ready`, keeping its position
stable while the game reports progress. Errors expose retry.

The entry bundles contain module-level state and execute fresh when changing
screen type. PageRuntimePlugin scopes JavaScript only, including lazy chunks;
CSS must never receive the JavaScript wrapper. Disposal cancels timers, browser
listeners, observers, requests, and HTML audio. Hooks disconnect the outgoing
screen socket and await Phaser destruction. Party-only changes skip all of this.
The chunk registration array resets between screen mounts, and script tags carry
a scope ID so late downloads cannot execute against a newer screen. Native method
bindings are cached per facade instead of allocated on every property access.

Register additional external cleanup with
`window.__BB_PAGE_SCOPE__?.onDispose(callback)`. Phaser resources should use scene
shutdown/destroy events. Avoid `globalThis` for screen-owned browser effects.
Async work outside scoped fetch/timers must check the scope after awaits.

After lobby readiness, battle warming waits 1.2 seconds and an idle callback.
It discovers deployed bundle URLs from the static game template (including
production hashes), then prioritizes code/styles, the selected mode chunk, map,
and roster character/skin assets before a bounded set of shared battle assets.
Selection updates remove obsolete queued assets. It never executes the warmed
screen's code or creates a Phaser instance. All discovery and asset requests
share one concurrent download and a 24 MiB session budget. Hidden tabs, data
saver, and 2G connections pause warming; navigation cancels it. Failed downloads
retry up to three times, and pauses do not consume retries.

The results screen calls `warmLobby()` to download the static lobby template and
its bundles/styles. It never pre-joins a party. On actual return,
`prepareLobbyReturn(fallbackPartyId)` obtains fresh `/status`, resolves the current
party (including an authoritative no-party result), and navigates. The router
binds that response to the destination route and page-scope ID. Lobby bootstrap
calls `consumeLobbyReturnStatus()` once, avoiding a second status request. A
failed lookup uses the match party as fallback and lets normal bootstrap retry;
bans redirect immediately. Cancellation, errors, redirects, and newer routes
discard unused data. `/partydata` remains fresh and retains membership/presence
side effects.

The status service runs independent customization, party, and live-match reads
concurrently after authentication/ban checks. Ownership synchronization retains
its existing transaction/lock ordering and optional-field fallbacks. Membership
lookup failures still fail status instead of inventing a no-party result.
Successful `/partydata` requests release the joining transaction before pooled
work, update online presence, then read the detailed roster once. That ordered
snapshot supplies ownership to both the response and roster broadcast; card and
skin enrichment, socket room movement, and new-join queue cancellation remain.

Shop/profile initialization, trophy availability, and lobby hints wait for
`lobby:ready`, a painted frame, and idle time (with a timer fallback). They do not
hold the roster behind optional requests. Menu interactions initialize their
controller synchronously on demand, once per mount; profile/shop deep links still
open after readiness. Leaving the screen cancels pending setup. Party settings
are fetched fresh when opened, not as an extra request during lobby bootstrap.

During a foreground screen change, script preload hints start as soon as HTML
arrives, alongside stylesheet loading and outgoing cleanup. Execution remains
ordered and starts only after cleanup and styles complete. Hashed production
JS/CSS receive one-year immutable caching; HTML, manifests, unversioned assets,
and development files continue revalidating. No service worker or hidden running
lobby is used.

Validation: navigation tests cover repeated party routes without remounting,
superseded requests, and cancellation. Preloader tests exercise scheduling,
selection priority, cancellation, retries, visibility/data-saver restrictions,
and budget exhaustion. Return tests cover single-use status, party/solo routes,
bans, failures, and scope isolation. Build tests check entry and lazy CSS in
both development and production. Font tests exercise delayed and failed fonts.
Status/party-load tests check concurrent queries, error handling, one fresh roster
read, ownership reuse, presence ordering, and unchanged join/room side effects.
Deferred-setup tests cover readiness/paint ordering, early interaction, retries,
timer fallback, and cancellation during each scheduling stage.
Manually check successive bot matches, party join/leave, Back/Forward, fullscreen,
retry, and sound; confirm one game canvas/socket remains after a screen change.
User Timing marks `bb:route:<sequence>:start`, `document`, `cleanup`, `styles`,
`scripts`, and `ready` identify route phases in a browser performance recording.
These marks describe real completion events; the visible loading bar remains
an estimate. Compare cold and warm runs and inspect `/status` and `/partydata`
in the network panel when checking a deployment.
