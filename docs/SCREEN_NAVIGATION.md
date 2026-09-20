# Lobby and battle navigation

`navigation.bundle.js` remains alive while `/`, `/party/:id`, and `/game/:id`
screens change. It fetches the server route (so existing authorization still
applies), loads its styles and scripts, updates history, and replaces the body
contents while retaining the actual document, html, and body nodes. Fullscreen
therefore retains its element. A shared AudioContext is unlocked by lobby input
and supplied to each Phaser instance.

The transition stays visible until `lobby:ready`, `lobby:join-request`, or
`game:ready`. Game readiness includes the existing asset/background gates.
Failures show a retry action; they never silently reload a supported route.
Links to other site pages retain ordinary navigation.

The entry bundles currently contain module-level state. They intentionally
execute fresh on every mount. `PageRuntimePlugin` wraps their browser bindings
lexically with `pageScope`, including lazy chunks; it does not monkey-patch
global browser APIs. Disposal cancels timers, browser listeners, observers,
requests, and HTML audio. Explicit hooks disconnect Socket.IO and await Phaser
destruction. The chunk registration array is reset between mounts. Script tags
carry a scope ID so a late download cannot execute against a newer screen.

When adding a feature with an external resource, register its cleanup with
`window.__BB_PAGE_SCOPE__?.onDispose(callback)`. Resources inside Phaser should
use scene shutdown/destroy events. Avoid `globalThis` for screen-owned browser
effects, since it deliberately bypasses lexical lifetime bindings. Async work
outside scoped fetch/timers should check the scope's `active` flag after awaits.

Background warming uses the deployed game template's versioned bundle URLs,
a generated shared-asset manifest, and the selected map/roster assets. It only
downloads bytes into the browser HTTP cache: no hidden game, texture uploads,
or audio decoding. It uses one low-priority request at a time, a 250 ms gap,
and a 24 MiB session budget. Save-Data and 2G skip warming; hidden tabs and
transitions pause it. Cache eviction remains under browser control.

Manual verification: enter/exit successive matches in fullscreen, change and
leave parties, use Back/Forward during loading, retry an unavailable asset,
and check sound after lobby interaction. Confirm only one game canvas/socket
remains after each transition and background warming pauses during gameplay.
