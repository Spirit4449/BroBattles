# Browser lifecycle, rendering, and audio

## Lobby and battle navigation

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

## Rendering and loading

The game uses `Phaser.AUTO`: WebGL when supported, Canvas otherwise. Characters,
map objects, particles, animations, and effects use ordinary Phaser APIs in both
renderers. Keep renderer-specific resolution handling in
`src/client/game/scene/renderResolution.js`; do not add renderer branches to gameplay.

Quality changes affect the main drawing buffer, not the logical world, cameras,
physics or input coordinates:

| Setting | Total pixels relative to Medium | Width/height multiplier |
| --- | --- | --- |
| Low | 0.25× (unchanged) | 0.5× |
| Medium | 1× | 1× |
| High | 2× | √2× |
| Super High | 4× | 2× |

Pixel dimensions are rounded. WebGL dimensions are capped to hardware limits.
The Phaser 3.70 WebGL adapter scales viewport/scissor calls for the screen and
leaves offscreen render targets at their own sizes. The Canvas adapter scales
context transforms. Neither adds per-sprite renderer selection. Changes to other
settings do not resize the renderer. Revalidate this adapter when upgrading Phaser.

The logical game size follows the window (`src/client/game/scene/gameViewport.js`).
The arena fills the screen by trimming the view: tall windows first gain sky
above the arena, then lose up to 30% of the sides; very wide windows lose some
top and bottom. Beyond those limits the canvas letterboxes. `ambientBezels.js`
then fills the spare space by mirroring the frame's edge strip outward, darkening
it with distance and blurring it. It samples about 20 times a second, after
Phaser renders. The arena edge is feathered into the bezel with a CSS mask. The
logical size changes only once a resize settles; the canvas stretches until
then, and cameras keep their centre. Map backdrops render inside Phaser (see
Scenery in [Maps](maps.md)), not behind the canvas.

`deferSceneAudio` captures existing `load.audio` declarations during preload,
including character and mode sounds, and starts them after scene creation with
two parallel downloads. Visual assets and their atlas/map data remain blocking;
audio downloads and decoding do not block scene creation or visual loading
progress. Missing one-shots are skipped, never replayed late. Local movement
loops initialize when their decoded audio enters the cache. Shutdown cancels
pending startup and restores patched methods; Phaser owns active loader cleanup.

### Verification

`node --test tests/renderResolution.test.js tests/highResolutionCanvas.test.mjs tests/deferredAudio.test.mjs`

`node scripts/dev/test-rendering.cjs` requires Playwright with Chromium and WebKit
installed. `NODE_PATH` can point to an existing Playwright package directory;
`CHROME_EXECUTABLE` optionally selects an installed Chrome. The harness needs no
database or game server. It checks actual rendered pixels, transparency, clipping,
generated textures, WebGL render textures, quality changes, camera mapping,
resize, automatic Canvas fallback, slow/failed audio, and teardown in both engines.
The preserved drawing buffer is enabled only in the harness for pixel inspection.

## Player sound distance

Player-created effects use `src/client/game/audio/playerAudio.js`. Pass the acting player's sprite (or an impact point when the owner is unavailable) and the effect's local volume to `playPlayerSound`. Use `playerSoundVolume` for sound instances that need their own playback lifecycle. Dash, duck, attack, special, hit, death, and power-up tick cues use this path.

The local player hears their own sounds at the requested volume. The watched fighter becomes that listener in spectator mode, so their sounds also play at full volume. Other fighters start at 90% of the same effect's volume when close. Their volume falls smoothly with distance from the listener and fades to silence 360 px beyond the visible camera area. This keeps distant combat on large maps, including Bank Bust, quiet. Sustained sounds should recalculate volume during playback when the fighter or spectator target moves.

Opponent movement uses `src/client/game/audio/remoteMovementAudio.js`: terrain-specific footsteps and landings, jump and wall-jump cues, and wall-slide and falling-air loops. Event sequence IDs prevent repeated snapshots from replaying cues; older senders use movement transitions. Footsteps follow movement speed. Loops recalculate distance after each rendered frame and stop on landing, death, disconnect, respawn, presentation reset, or scene shutdown. Invisible fighters remain audible. The spawn intro suppresses movement audio.

## Lobby and match audio

`public/assets/music/lobby-aligned.mp3` is the supplied 決戦の鐘 lobby render. `matchmaking-aligned.mp3` is the supplied lower-pitched 決戦の鐘 (0.76x) render. They stream through two persistent HTML audio elements owned by navigation; party changes preserve playback. Both play continuously, with the inactive version silent, keeping memory use bounded without decoding both full songs into Web Audio buffers.

`src/client/navigation/lobbyAudio.mjs` uses the original version in the lobby and the relaxed version during ready, searching, found, and loading. It waits for the next quarter-note boundary and crossfades over approximately one beat. Cancellation switches back using the same rule. Both versions use the same base level, multiplied by the user's music setting. New matchmaking participants play `/assets/player-join.wav`; your own arrival, the initial roster, reordering, and repeated updates are silent. Match found and loading do not play a sound effect. Party join notifications also use the player-join cue. There is no runtime speed change, pitch shift, or low-pass filtering. If the relaxed stream is unavailable, the original continues until it can switch; media errors fall back to the available stream.

The relaxed track continues at its existing level over the loading screen. Successful map music playback fades both lobby streams out, then pauses them. Map music fades in at 30% of its configured level during the intro/countdown and rises to its configured level at FIGHT. Joining a live match fades straight to the configured level. FIGHT also ends any remaining lobby audio if map playback was unavailable.

Music and SFX retain independent user settings across separately bundled pages. Hidden tabs pause lobby audio; returning resumes its existing position. State changes and duplicate matchmaking messages do not restart tracks or replay confirmation cues.

Lobby and matchmaking music use a base gain of 0.264, multiplied by the user's music setting.

Both exports use a 109.703 BPM pulse grid. Offline Rubber Band R3 time maps anchor 448 detected lobby pulses and 396 relaxed pulses, preserving each source's pitch. Initial silence is about 0.075 seconds for the lobby and 0.435 seconds for matchmaking. The original needs only small timing corrections; the relaxed version is approximately 4.4% faster than its source to match the grid. Fixed gains match their loudness at approximately -17.5/-17.6 LUFS, with decoded true peaks below -1.6 dBFS. No synthesized layers, echoes, or reverb are added.

The separate renders have different arrangements and lengths: they cannot be aligned as identical instrument stems. Full source content is retained, followed by enough silence for loops of 113 and 100 four-beat bars. `lobbyMusicTiming.mjs` records those lengths and the common beat interval. Every two seconds, and before a switch, the controller corrects bar-phase drift on the silent standby only, allowing the decoder to seek before the crossfade. Audible streams are never seeked during a reversed fade. All media playback rates remain 1. Lobby return explicitly resumes the shared audio context because Phaser suspends it when the battle is destroyed.

Each switch prepares the incoming stream at most once. A `seeked` event completes that preparation instead of repeatedly seeking against an advancing reference. Periodic standby synchronization skips a prepared switch. Returning from battle clears stale playback readiness and waits for the resumed stream's `playing` event or resolved play promise before fading it in; a rejected start can be retried on the next gesture or state change.

Export measurements in earlier work logs were local observations. The shipped tracks and `src/client/navigation/lobbyMusicTiming.mjs` are the retained runtime references.

Relevant checks: `node --test tests/lobbyAudio.test.mjs tests/musicEnvelope.test.js tests/matchStartAudio.test.js tests/navigation.test.js tests/navigationTransitions.test.js tests/rewardAudio.test.js`.

The battle countdown plays its beeps and the final `/assets/game-sounds/start.mp3` FIGHT cue. Both cues are preloaded when the countdown starts.

## Map terrain and footsteps

Set each map document's `metadata.terrain` through Map Studio/API (built-in defaults live in `src/shared/maps/<id>.json`):

- `grass`: Lushy Peaks, Mangrove Meadow, Serenity. Four natural foot-on-grass steps and the soft “smush” landing.
- `hard`: Iron Junction / Bank Bust. The original three industrial footstep samples and a concrete-impact landing.

This is a map-wide material, not automatic texture detection. Missing or unknown materials safely fall back to `hard`.

To add another material, add a named entry to `src/shared/physics/terrainAudio.json` with a label, `volumeScale`, `landing`, and a nonempty `steps` array. Sound entries need a unique `key` and `files` paths relative to `public/assets`. Add the files, then set the map's `terrain` to the new name. Preloading and selection use this registry automatically; no character-specific edits are needed. Keep asset licenses beside the files.

`footstepVolumeScale` is the master multiplier. Grass uses four individual foot contacts extracted from a real walking recording and normalized to −22 LUFS with a −4 dB true-peak ceiling. Its landing volume is independently reduced through `landing.volumeScale`. The untouched CC0 preview remains alongside the game-ready files. Speed-dependent pitch/volume and nonrepeating variants are retained.

The initial player spawn is marked for a silent landing. The marker is consumed on the first grounded frame (or cleared on a deliberate jump or a real fall). Later gameplay landings retain their normal audio. This only suppresses the landing sound, not spawn visuals.

Tests: `node --test tests/movementAudio.test.js`.


## UI cues and source records

`src/client/ui/uiSounds.js` owns delegated click/hover sounds, lazy loading and manual cue suppression. [UI sound usage and credits](../../public/assets/ui-sound/README.md), [reward sound sources](../../public/assets/ui-sound/rewards/README.md), and [movement sound provenance](../../public/assets/movement/README.md) stay beside their assets.
