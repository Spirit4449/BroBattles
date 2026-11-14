# Browser lifecycle, rendering, and audio

## Death drop visuals

Coins and gems fan out from a defeated player with their server supplied launch
velocities. The client stops each drop on its first platform contact, then keeps
its pickup position fixed. Square glints mark the launch, landing, and collection;
collection lifts and fades the sprite. The server still controls the pickup delay
and award.

## Battle HUD layout

The battle intro keeps a responsive center gap between the player cards for the
countdown. Its FIGHT cue uses blue lettering with an orange outline to echo the
wordmark, with a compact entrance zoom so the text stays readable over the arena.
These presentation styles live in `public/styles/game.css`.

`public/game.html` groups the team rosters, match clock, Bank Bust vault panels,
and mode notices in `#battle-top-hud`. The shared grid in
`src/client/styles/battlePixelHud.css` owns their placement: vaults flank the
rosters and clock on wide screens, shrink below 1200px, and stay beside the
clock above the rosters below 600px. Coin changes update the bar and delta
without shaking the vault panels. Notices flow after those rows
so wrapping player cards cannot collide with them. Keep mode visibility on the
existing HUD group nodes; they use `display: contents` while visible.
Bank Bust's world coin bar and value sit above each vault's artwork.

## Lobby character showcase

Changing skins in Animations or Fight restarts the current demonstration in place
with the selected skin, without a canvas fade or portrait carousel. Body retains
a 360 ms expanding column of soft light, a broad pixel dissolve, and four
staggered block-edged square/diamond accents and brief pixel-star sparkles. The light has no moving head or scan line. Shapes remain translucent; a short
original synthesized sweep/shimmer plays on skin selection through the UI sound
system, respecting SFX volume and restarting rather than stacking on rapid clicks. One canvas stays pinned to the portrait’s
layout box, with no scattered particles or layout shift. New skin choices interrupt the effect immediately rather than queuing. Browsing skins cancels the automatic switch
to Animations, including when the stage is still loading.

The expanded character panel previews all characters by default (reduced motion
keeps the portrait). `lobby/profile/showcaseMotion.js` fits opaque idle
width and height inside a common reference size, independent of atlas padding or
selected skin. Character kits may override `visual.height`, `visual.maxWidth` and
`visual.bodyTop` (a fraction excluding an overhead prop). Thorg reads taller than
the default fighter; Draven is measured below his tall staff plume.
Both fighters use that same scale reference and the same HUD width; animation
poses and supers do not resize the camera. Jumping uses the game's launch speed,
gravity and stronger falling gravity, with room reserved for the full arc.
Animation demonstrations use normal game speed and animation rate, grass
footsteps, landing audio and shared dust.

Fight participants use the panel's level for health and damage. Gloop spars with
Ninja; higher-damage characters normally face Thorg. Ozzy faces one opponent with a green teammate standing behind him as a
bystander, so Arcane Surge visibly grants a real powerup to an ally. `showcaseRoster` returns
participant IDs, teams and positions; simulation and presentation have no two-player
assumption. Fights start with empty super bars. Charge is earned through hits and carried
between practice rounds, allowing kits such as Gloop to charge across multiple
Ninja opponents. Ammo consumption, reloads, returning-projectile refunds, damage
and effects are real match outcomes. Defeated fighters stay down until the active
fighters on one side are eliminated, followed by a new round; bystanders do not
keep a defeated side fighting. Buff presentation is allowed to finish before reset.
There is no hidden healing, alternating attack turn, walk-home reset or shortened
ability duration.

`showcaseDirector.js` chooses ordinary commands independently for each participant.
It uses shared aiming/ammo/profile logic and comfortable distance bands with
hysteresis and acceleration. The featured fighter uses short bursts with pauses in addition to the real
attack cooldown. Sparring partners answer more slowly, withhold supers, and ease
off when their target is hurt; they use the same health/damage stats. Bystanders
stand still, do not attack, and stay behind the featured fighter's movement bounds.
Supers require earned charge and have a director pacing interval. Effect modifiers
affect movement. The local ammo bar reuses `scene/ammoBarRenderer.js`, including
its pixel frame, red segments and gradual refill, with super below it as in matches.
The preview physics world uses the combat arena bounds, and simulation contact boxes follow the fitted stage bodies. Thorg’s starting pair is shifted left to reserve room for repeated knockback.

`showcaseFight.js` renders events from `shared/combat/previewSession.js`, which hosts
the same attack, damage, ability and effect modules as GameRoom. Ninja's return
contacts, Sparrow's burn ticks, Gloop's slows/pull and Ozzy's team grants therefore
need no separate showcase implementation. Animation demonstrations use this host
too. Projectile network adapters are instantiated with an isolated local clock;
health feedback, character event handlers, powerup visuals and sounds reuse match
presentation. Sparrow's isolated renderer accepts compact arrow framing without
changing its collision or damage.

Optional `game/characters/<key>/showcase.js` files contain art framing only. New
characters inherit combat support from their normal runtime registration, with no
showcase allowlist or attack script. Content validation checks basic/special runtime
coverage. `tests/profileCharacters.test.js` covers mechanic contracts, roster levels,
ammo, stable spacing, teardown and identical preview/GameRoom outcomes for all
registered characters. Renderer tests cover compact embedded arrows and cleanup.
See [Add a character](contributing.md#add-a-character) for the extension contract.

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

Speculative card animation downloads share this queue and its 24 MiB session budget. They
run after queued gameplay assets, one at a time, with the equipped local card
ahead of other cards. Lobby status and successful equip changes warm that card;
match-found rosters include equipped card IDs and warm all participants' cards.
Battle confirms the local selection before requesting roster media. Completed
videos live in an 8 MiB navigation-owned LRU blob cache and survive lobby/game
transitions. Equipped/roster cards and active media subscriptions prevent eviction;
paused decoders retain their subscription until disposed. Media elements receive
only completed blob URLs, never remote video URLs that could independently
compete with Phaser downloads. Catalog content hashes version the fetch URLs;
the server grants immutable caching only when the version matches the file.

Apple browsers use HEVC-with-alpha MOV variants with no B frames. Most cards
use full-quality alpha and a one-second keyframe interval; Crown of the Arena
uses the approved smaller export with alpha quality 0.6, a 192-frame keyframe
interval, and a 360 kbit/s target. The importer despills green
and zeros fully transparent RGB before encoding to prevent edge contamination.
Profile and reward presentation boxes fit the catalog card viewport; their
effect canvases can overflow. Scrollable shop previews contain the full effect
canvas in a taller artwork box so sparks cannot clip against the header or rarity
caption. Posters and playing videos use identical geometry. Other browsers use VP9 WebM.
Before visible playback, the renderer probes a transparent corner of the first
downloaded card once per codec. The result is cached for the browser user agent
in localStorage; inconclusive probes are not persisted and can retry twice.
A decoder that drops
transparency leaves the poster in place. The HUD uses the bundled catalog and
starts preparing actual roster video elements during visual loading, one card
per idle turn. During the flythrough it pauses unfinished preparation and holds
optional downloads, including downloads released by deferred audio. At countdown
the same prepared elements are mounted and pending work resumes through idle
callbacks. Preparation respects gameplay holds and speculative network limits;
it never delays the server countdown. Duplicate cards share a video decoder and
copy presented frames to canvases sized for display; browsers without video frame
callbacks use independent videos. The shadow is a separate static poster layer.
Visible automatic cards, deliberate previews, and reward reveals bypass
transfer-time estimates and the speculative session budget. Offscreen preparation
continues to use speculation limits.
Profile hero cards loop when visible and restart from time zero each time a
profile is opened, including when the same card/video element is reused.
Selection cards start on their first hover/focus and keep looping after the
pointer/focus leaves (while visible).
Bundles and shop offers containing cards have an info button opening a native preview
dialog (`showRewardPreview`) listing everything the offer grants: player cards
animate, other rewards show their artwork with a name and type caption.
The preview uses the canonical `bb-popup` header, square frame tokens,
`bb-close` control, and shared popup dismissal motion from `ui-system.css`.
Each preview card shows its rarity beneath the art. Closing a preview immediately
disposes its media and unregisters its page-disposal callback, including a close
before visibility observers have seen the dialog. Disconnected observers also
unregister from the page scope, and register again when reused.
The same renderer is used by purchase/Trophy Road unlock reveals.

Cards display an independent static image underneath the video. A decoded-frame
callback starts a short video fade-in; the still remains until the fade finishes.
Stopping, waiting, or decoding failure restores the still before hiding the
video. Both layers share the same geometry. Visible selection tiles prepare
optional animation before hover or keyboard focus, without playing it. Loaded
previews pause and retain their source/decoder between plays; removal, page
disposal, or decoding failure releases the source. Owners call
`disposePlayerCardMediaWithin` before replacing profile grids/hero cards, dismissing
rewards, or retiring battle overlays; there is no page-wide removal observer.
Offscreen tiles and hidden
tabs stop playback and unsubscribe pending requests. Reduced motion keeps posters. Data saver and 2G block optional
downloads; 3G permits equipped and roster cards when their estimated transfer
fits five seconds. Other cards need an estimated transfer within 2.5 seconds.
Estimates use declared animation bytes, connection downlink when available, and
observed queue throughput. Browsers without network estimates try a bounded
low-priority request with the same time limits. Failures keep posters without
holding up gameplay or repeatedly retrying the same request.

`node scripts/dev/test-generated-html.cjs` checks actual card playback, poster
alignment, decoded green-spill pixels on Shuriken/Amethyst/Anvil/Ozzy (including
later orb and particle effects), hover/visibility behavior,
preview effect bounds and cleanup, and reward reveals. Use `--preview-layout`
or `--reward-layout` for focused desktop/mobile layout checks. Playwright is
required; `NODE_PATH` and `CHROME_EXECUTABLE` can select existing installations.
Use `--battle-media` to check six animated cards sharing one decoder and teardown.

Visible playback allows up to 20 seconds per request, with at most three attempts
for transient network/server failures, while still respecting gameplay priority,
the bounded blob cache, data saver and 2G restrictions. Missing or oversized
files do not retry. This also works after background warming has exhausted its
session budget, including on localhost. Visible cards follow selected gameplay
assets but precede the speculative shared-asset manifest; actual Phaser and
flythrough loading holds still block them. Cancelled media requests cannot install
a stale source; hide/show during preparation resumes the current request.

Route loading suspends warming. Phaser holds optional card downloads through
visual loading and the deferred audio queue, releasing on audio completion or
scene teardown. A cached animation can still play during those holds. New
gameplay warming preempts an in-flight card download. The game-ready event starts
the optional queue without awaiting it or adding cards to game-loader progress.

The results screen calls `warmLobby()` to download the static lobby template and
its bundles/styles. It never pre-joins a party. On actual return,
`prepareLobbyReturn(fallbackPartyId)` obtains fresh `/status`, resolves the current
party (including an authoritative no-party result), and navigates. The router
binds that response to the destination route and page-scope ID. Lobby bootstrap
calls `consumeLobbyReturnStatus()` once, avoiding a second status request. A
failed lookup uses the match party as fallback and lets normal bootstrap retry;
bans redirect immediately. Cancellation, errors, redirects, and newer routes
discard unused data. `/partydata` remains fresh and retains membership/presence
side effects. While `/status` is pending, the router also requests the match
party's page; navigation uses it only when `/status` confirms that party.

Battle entry overlaps its requests. `match:gameReady` prefetches the game page
and `/gamedata` during the success hold, and any `/game/:id` navigation
requests `/gamedata` alongside the page. A direct load or refresh of
`/game/:id` starts `/gamedata` when the navigation bundle runs in the document
head, in parallel with Phaser and the game bundle. The game bundle takes that response
once through `consumeGameData(matchId)`, falling back to its own request.
The terms dialog appears only when `/gamedata` reports `TERMS_REQUIRED`, and
Phaser starts without waiting for the socket to connect. Route requests start
before the transition artwork decodes. Only the first artwork attempt holds
the outgoing screen. Navigation lets an in-flight warming asset finish into
the HTTP cache instead of aborting it. The 45-second readiness timeout restarts
whenever the loading bar advances, so only a stalled screen fails.

The status service runs independent customization, party, and live-match reads
concurrently after authentication/ban checks. Ownership synchronization retains
its existing transaction/lock ordering and optional-field fallbacks. Membership
lookup failures still fail status instead of inventing a no-party result.
Successful `/partydata` requests release the joining transaction before pooled
work, update online presence, then read the detailed roster once. That ordered
snapshot supplies ownership to both the response and roster broadcast; card and
skin enrichment, socket room movement, and new-join queue cancellation remain.
The HTTP response and mode-change event reuse the enriched socket roster so
party creation/joining cannot replace equipped skins with base portraits. Solo
matchmaking previews retain the displayed lobby portrait, and queue roster
change detection includes equipped skin IDs and portrait URLs.

Shop/profile initialization, trophy availability, and lobby hints wait for
`lobby:ready`, a painted frame, and idle time (with a timer fallback). They do not
hold the roster behind optional requests. Menu interactions initialize their
controller synchronously on demand, once per mount; profile/shop deep links still
open after readiness. Leaving the screen cancels pending setup. Party settings
are fetched fresh when opened, not as an extra request during lobby bootstrap.

Other players' profile headers place the friend action beside the title, wrapping
on narrow screens. Pixel icons and blue (add), gold (pending), or green
(accept/friends) treatments distinguish relationship states; pending and friends
remain fully legible when disabled.

During a foreground screen change, script preload hints start as soon as HTML
arrives, alongside stylesheet loading and outgoing cleanup. Execution remains
ordered and starts only after cleanup and styles complete. Hashed production
JS/CSS and content-versioned card videos receive one-year immutable caching.
The production build also writes Brotli and gzip copies of each hashed bundle,
which `middleware/precompressed.js` serves instead of compressing on every
request. Other `/assets/` files are cached for ten minutes, so assets warmed in
the lobby are used without a revalidation round trip (replaced art can show for
up to ten minutes after a deploy). HTML, manifests, map revisions, unversioned
card videos and development files continue revalidating. The build removes
hashed bundles that are outside the newest five versions and over a day old.
No service worker or hidden running lobby is used.

Character portraits are inlined into the lobby, game and profile bundles from
small `portrait.webp` copies of each `body.webp`. After changing body art run
`node scripts/art/build-portraits.cjs`; `npm run validate:content` reports
missing or stale portraits. Roster slots, bot pickers, matchmaking and HUD
avatars also display these copies through `bodyDisplayUrl()` in
`views/skinAssets.js`; `body.webp` remains the source art. Pages load Lato from `/styles/lato.css` rather than
Google Fonts. Lobby backgrounds are separate from the larger `gameBg` scenery
layers and are kept at roughly 2.7K wide.

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

Respawns use `src/client/game/scene/respawnEffect.js` for local and remote
fighters (including snapshot recovery): a cyan arrival beam, two expanding
foot rings, and rising pixel sparks clear within a second. The effect stays at
the arrival position without changing the fighter's alpha, physics, or input.
Scene shutdown and sprite destruction cancel its tweens and remove its objects.
Initial match arrivals retain the separate spawn burst; the existing respawn
shield still indicates protection after the arrival cue ends. Fupicat's CC0
Teleport cue (`game-sounds/respawn.mp3`) plays with the arrival effect through
player-distance audio at half gain; unavailable audio never delays the visuals.
Source and license are recorded in `game-sounds/respawn-credits.txt`.

Knockback from every source starts a short pale streak and afterimage trail in
`src/client/game/scene/knockbackTrail.js`. Local impulses start it immediately;
server-owned `knockbackSeq` snapshots trigger it for remote fighters and bots.
It follows actual rendered movement, skips invisible fighters and teleport
jumps, and cleans up on sprite destruction or scene shutdown.

Indeterminate loading uses the shared `.bb-battle-loader` in
`public/styles/ui-system.css`: steel pixel blades clash around a gold spark. Only their
inset guard gems use the logo’s ice/cobalt-blue and gold/orange palettes. The transparent two-cell sprite sheet lives at
`public/assets/ui/loading-swords.webp`; its source prompt is recorded beside it.
Shop/checkout, lobby recovery, Trophy Road, leaderboard, account forms, and help
search share the same emblem. Set `--bb-loader-size` for compact inline contexts;
keep it decorative with `aria-hidden="true"` beside the loading label. Reduced
motion displays still crossed blades. Battle/route progress bars retain their
determinate percentage display.

The pre-battle player cards use the equipped cosmetic frame with a shared inset
for the player name, trophies, larger fighter portrait, level badge, and labeled
combat stats. Blue/coral accents distinguish teams. Cards and fighter portraits
remain still after their entrance unless the equipped frame has an
`animationUrl`; those transparent videos loop, with still posters for
reduced-motion users. Fighter portraits remain still.
`gameHudController.js` fits both teams to the available space and staggers each
team's reveal; `public/styles/game.css` owns the pixel grid
and entrance styling. Reduced-motion preferences disable overlay animations and
transitions. Battle frames use a single uniform scale to fit their measured visible
bounds inside the shared card box, preserving the original artwork's aspect
ratio. All cards receive a 10% uniform reduction, except Shuriken Strike at 5%.
Frames remain centered, and posters and videos share the same geometry.
Arena canvas positioning targets `canvas[data-game-renderer]` only; mirrored card
canvases keep their own poster's bounds and stacking order. The battle media
browser check loads the actual game stylesheet to verify duplicate animated cards.
Art importers refresh these measurements when replacing an asset. When adjusting
the layout, preview every cosmetic frame in solo and full-team matches at desktop
and phone sizes (`node scripts/dev/test-generated-html.cjs --battle-layout`).

Arcade physics steps once per rendered frame (`src/client/game/scene/displayRatePhysics.js`).
Before each scene update the world's step is resized to the frame's smoothed delta, and frames
longer than 1/60 s split into equal steps no longer than that. Arcade's default fixed 60 Hz step
moved the local fighter on alternate frames of a 120 Hz display while the camera eased every frame,
so the fighter shook against the view (Chrome and Edge run at the display's rate; Safari usually
caps at 60 Hz). The local name, health, ammo and super bars and status icons are placed in
`postupdate`, after Arcade writes the step back to the sprite, so they never trail it by a frame.
Shorter steps alone would make Arcade's semi-implicit integration drift with the refresh rate
(jumps peaked ~3 px higher at 120 Hz), so the local body adds `(v_after - v_before) * (1/60 s - step) / 2`
to each step (`integrateLikeReferenceStep`): any step length traces the 60 Hz path, and a 60 Hz step
is unchanged. Rules applied per frame (fast-fall gravity switching on past the apex, the jump
launch ramp) still take effect at frame instants, which can differ from 60 Hz by about a pixel
over a long fall at rates that are not multiples of 60.

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

`node --test tests/renderResolution.test.js tests/renderResolution.test.mjs tests/deferredAudio.test.mjs`

`node scripts/dev/test-rendering.cjs` requires Playwright with Chromium and WebKit
installed. `NODE_PATH` can point to an existing Playwright package directory;
`CHROME_EXECUTABLE` optionally selects an installed Chrome. The harness needs no
database or game server. It checks actual rendered pixels, transparency, clipping,
generated textures, WebGL render textures, quality changes, camera mapping,
resize, automatic Canvas fallback, slow/failed audio, and teardown in both engines.
The preserved drawing buffer is enabled only in the harness for pixel inspection.

## Character animation

Every fighter, local or remote, is animated through
`src/client/game/characters/shared/animationState.js`. Character code never
calls `sprite.anims.play` for its own pose.

- **Actions.** Throws and specials go through `playSpriteAnimation` with
  `logical: "throw"` or `"special"`. That starts the sprite's one action, which
  lasts as long as its animation, or `holdMs` when a cast outlasts its art
  (Draven's Inferno). The action is stored on one clock (`performance.now`).
- **No accidental restarts.** Asking for the action already showing continues
  it. The local key press, the server's `player:special` echo and any later
  event therefore show a single pose. Pass the attack's `id` so a new attack
  starts over while a repeated packet for the same attack does not, or
  `restart: true` when every call is a fresh swing (Thorg's sweep).
- **Movement waits.** `playCharacterAnimation`, the per-frame movement pose
  for local input and remote snapshots, leaves an active action alone. Only
  dashing and dying end it. Death, respawn and interrupts call
  `playSpriteAnimation` with a non-action animation, or `clearAction`.
- **Remote actions.** Wrap a remote action handler in `presentRemoteAction`.
  The snapshot loop reads `remoteAnimationLockUntil(sprite)` and does not
  take the sprite back until the action ends.
- **Following a pose.** Effects tied to a pose read `actionElapsedMs(sprite)`
  so they join at the pose's current frame (the ozzy's super cast).
- **Gameplay locks are separate.** `_specialCastLockUntil` (from
  `presentation.specialAnimationLockMs`) only blocks dashing. It never changes
  which animation shows.

Straight-down dash poses stay ducked through the subsequent fall until landing or
another movement/action interrupts them. Stomp impacts use distance from dash
activation to landing, with two to five cloud bursts for progressively higher drops;
the server includes that distance for remote impacts.

## Gameplay camera

Mouse aiming adds a fixed screen-pixel look-ahead with time-based easing after
camera follow and bounds processing. Its reach and response are independent of
map zoom, player height, movement speed and follow dead zones, including at map
edges. Release eases back to neutral; input release and spectator/shutdown cleanup
clear the offset. The camera matrix carries the shift so pointer-to-world mapping
stays aligned with the rendered view.

The gameplay camera follows each movement axis more tightly as speed rises,
so fast falls and dashes stay in view. Ordinary movement retains gentle follow;
the follow blend accounts for frame time. Landings carry the view slightly downward
and smoothly settle, with a capped offset based on impact speed. Reduced motion
disables this landing effect. Tuning lives in `cameraDynamics.js`.

## Mobile battle controls

`src/client/game/scene/mobileControls.js` owns touch input; `src/client/styles/mobileControls.css` owns its look. It turns on for touch devices (`isTouchGameDevice`), or when `window.__BB_FORCE_MOBILE_CONTROLS = true` is set for desktop testing. The overlay is plain DOM above the canvas, and `localPlayer.js` reads it each frame through `isMovingLeft/Right`, `isJumpHeld`, `isDuckHeld`, `isAimingUp/Down` and the one-shot `consumeJumpFreshPress`/`consumeDashFreshPress`.

- The left half is a floating movement stick. Pulling it straight down ducks, and up/down steers a dash.
- The right-thumb cluster is ordered by use. Attack is largest and nearest the corner, then jump, then super and dash, then a small duck button. Tapping attack or super auto-aims at the nearest opponent; dragging aims manually. Super fills from the bottom as it charges; dash shows its cooldown as a lifting shutter, so the keyboard dash bar is hidden. When either is available its face turns solid, slowly fades brighter, and a highlight runs around its outline.
- The look follows the battle HUD: a stepped pixel-circle ink outline around a lightly tinted see-through face, with solid colour-coded 12×12 pixel-art icons. `--bbm-px` (one art pixel) scales with the controls.
- Positions scale with the shorter viewport side and respect safe-area insets. The overlay hides while the local player is dead so the spectate controls stay reachable.
- `body.bb-touch-game` hides the in-game chat, the settings button and the keyboard reference on touch devices.

## Hit feedback

Every attack that damages a fighter plays the same reaction, from `src/client/game/characters/shared/hitFeedback.js` (`playHitFeedback`): a white flash over the fighter's current frame, the shared damage burst (`spawnDamageImpact`), the duck-guard bubble when they were ducking, and an animation hold sized by the attack's delivery (`hitstopForDelivery`). The flash is a copy drawn over the sprite, so team, power-up and invisibility tints are untouched.

Each viewer sees it once, as early as they know of the hit. The attacker plays it at its predicted contact (`notePredictedHit` in `shotPrediction.js`), and the health update that follows skips it (`takePredictedHit(name, "feedback")`). Everyone else plays it on the `health-update`, whose combat updates carry the attack's `delivery`. Burn ticks and other non-blow damage flash and burst without a hold; poison plays none. The local victim also gets the screen pulse and camera shake.

Attack-specific presentation stays in each character's folder and plays alongside: each character's `hit` sound, fireball bursts, explosions. Do not add a per-character hit flash; route new attacks through `notePredictedHit` instead.

## Player sound distance

Player-created effects use `src/client/game/audio/playerAudio.js`. Pass the acting player's sprite (or an impact point when the owner is unavailable) and the effect's local volume to `playPlayerSound`. Use `playerSoundVolume` for sound instances that need their own playback lifecycle. Dash, duck, attack, special, hit, death, and power-up tick cues use this path.

The local player hears their own sounds at the requested volume. The watched fighter becomes that listener in spectator mode, so their sounds also play at full volume. Other fighters start at 90% of the same effect's volume when close. Their volume falls smoothly with distance from the listener and fades to silence 360 px beyond the visible camera area. This keeps distant combat on large maps, including Bank Bust, quiet. Sustained sounds should recalculate volume during playback when the fighter or spectator target moves.

Movement clouds (landing, jump, run, turn skid, wall slide, wall kick) come from a small simulation in `src/client/game/scene/clouds/`. A cloud is a set of soft blobs that puff out, break into smaller pieces along their path and wear away. `cloudRaster.js` merges overlapping blobs into one pixel-art silhouette and shades each lobe from the field, and `cloudLayer.js` draws them into two world-space canvases per scene (behind and in front of fighters) aligned to a fixed cloud pixel grid. `cloudEmitters.js` turns contacts into blobs from a contact point, surface normal, impact strength and momentum, so every floor and wall collision uses the same rules. `effects.js` calls these emitters; the simulation, rasterizer and emitters are plain modules tested in `tests/movementClouds.test.js`.

Shockwave hits broadcast `shockwave:hit` for each affected fighter, including bots.
`powerups/shockwaveHit.js` uses the shared cloud system to follow the fighter for
650 ms, laying a tapering smoke trail along their actual flight path. Puffs are
spaced by distance travelled, drawn behind the fighter on every client, and
dissipate after emission stops.

Opponent movement uses `src/client/game/audio/remoteMovementAudio.js`: terrain-specific footsteps and landings, jump and wall-jump cues, and wall-slide and falling-air loops. Event sequence IDs prevent repeated snapshots from replaying cues; older senders use movement transitions. Footsteps follow movement speed. Loops recalculate distance after each rendered frame and stop on landing, death, disconnect, respawn, presentation reset, or scene shutdown. Invisible fighters remain audible. The spawn intro suppresses movement audio.

Falling wind uses `fallingAirVolume` in `movementAudio.js` for both local and remote fighters, at 45% of the original gain while retaining speed/time swell and playback fades.

## Lobby and match audio

Bank Bust vault damage reuses the shared coin-pickup sound, with randomized
pitch and volume that scales with damage. Rapid hits are throttled, including
when reduced motion is enabled.

`public/assets/music/lobby-aligned.mp3` is the supplied 決戦の鐘 lobby render. `matchmaking-aligned.mp3` is the supplied lower-pitched 決戦の鐘 (0.76x) render. They stream through two persistent HTML audio elements owned by navigation; party changes preserve playback. Both play continuously, with the inactive version silent, keeping memory use bounded without decoding both full songs into Web Audio buffers.

The lobby pair and sudden death music remain encoded as MP3 at 128 kbit/s stereo or 64 kbit/s mono. Bank Bust, Candyland, and the default map music use 96 kbit/s stereo; Mangrove and Serenity use 56 kbit/s mono. The lobby pair's alignment timing is unchanged.

`src/client/navigation/lobbyAudio.mjs` uses the original version in the lobby and the relaxed version during ready, searching, found, and loading. It waits for the next quarter-note boundary and crossfades over approximately one beat. Cancellation switches back using the same rule. Both versions use the same base level, multiplied by the user's music setting. New matchmaking participants play `/assets/player-join.mp3`; your own arrival, the initial roster, reordering, and repeated updates are silent. Match found and loading do not play a sound effect. Party join notifications also use the player-join cue. There is no runtime speed change, pitch shift, or low-pass filtering. If the relaxed stream is unavailable, the original continues until it can switch; media errors fall back to the available stream.

The relaxed track continues at its existing level over the loading screen. Successful map music playback fades both lobby streams out, then pauses them. Map music fades in at 30% of its configured level during the intro/countdown and rises to its configured level at FIGHT. Joining a live match fades straight to the configured level. FIGHT also ends any remaining lobby audio if map playback was unavailable.

Music and SFX retain independent user settings across separately bundled pages. Hidden tabs pause lobby audio; returning resumes its existing position. State changes and duplicate matchmaking messages do not restart tracks or replay confirmation cues.

Lobby and matchmaking music use a base gain of 0.264, multiplied by the user's music setting.

Both exports use a 109.703 BPM pulse grid. Offline Rubber Band R3 time maps anchor 448 detected lobby pulses and 396 relaxed pulses, preserving each source's pitch. Initial silence is about 0.075 seconds for the lobby and 0.435 seconds for matchmaking. The original needs only small timing corrections; the relaxed version is approximately 4.4% faster than its source to match the grid. Fixed gains match their loudness at approximately -17.5/-17.6 LUFS, with decoded true peaks below -1.6 dBFS. No synthesized layers, echoes, or reverb are added.

The separate renders have different arrangements and lengths: they cannot be aligned as identical instrument stems. Full source content is retained, followed by enough silence for loops of 113 and 100 four-beat bars. `lobbyMusicTiming.mjs` records those lengths and the common beat interval. Every two seconds, and before a switch, the controller corrects bar-phase drift on the silent standby only, allowing the decoder to seek before the crossfade. Audible streams are never seeked during a reversed fade. All media playback rates remain 1. Lobby return explicitly resumes the shared audio context because Phaser suspends it when the battle is destroyed.

Each switch prepares the incoming stream at most once. A `seeked` event completes that preparation instead of repeatedly seeking against an advancing reference. Periodic standby synchronization skips a prepared switch. Returning from battle clears stale playback readiness and waits for the resumed stream's `playing` event or resolved play promise before fading it in; a rejected start can be retried on the next gesture or state change.

Export measurements in earlier work logs were local observations. The shipped tracks and `src/client/navigation/lobbyMusicTiming.mjs` are the retained runtime references.

Relevant checks: `node --test tests/lobbyAudio.test.mjs tests/musicEnvelope.test.js tests/matchPresentation.test.js tests/navigation.test.js tests/navigationTransitions.test.js tests/rewardPresentation.test.js`.

The battle countdown plays its beeps and the final `/assets/game-sounds/start.mp3` FIGHT cue. Both cues are preloaded when the countdown starts.

On the match results screen, Escape, Enter, or Space activates Exit. The Exit button preloads and plays the UI click cue before returning to the lobby. The automatic countdown return is silent.

## Map terrain and footsteps

Set each map document's `metadata.terrain` through Map Studio/API (built-in defaults live in `src/shared/maps/<id>.json`):

- `grass`: Lushy Peaks, Mangrove Meadow, Serenity. Four natural foot-on-grass steps and the soft “smush” landing.
- `hard`: Industrial terrain defaults to the original three footsteps and concrete landing. Bank Bust overrides only the footsteps with a ready-made metal contact.

Bank Bust uses three individual metal footsteps and a heavier metal landing extracted from SoftDistortionFX’s CC0 `Metal Footsteps`. The landing layers a short bass thud with the recorded impact and plays at increased gain capped at full volume. Footstep and hard-terrain landing keys are overridden for local and remote fighters; other movement retains shared samples. `src/shared/physics/movementSounds.js` owns the isolated key mapping. Source and processing details live in `public/assets/bank-bust/movement/README.md`.

This is a map-wide material, not automatic texture detection. Missing or unknown materials safely fall back to `hard`.

To add another material, add a named entry to `src/shared/physics/terrainAudio.json` with a label, `volumeScale`, `landing`, and a nonempty `steps` array. Sound entries need a unique `key` and `files` paths relative to `public/assets`. Add the files, then set the map's `terrain` to the new name. Preloading and selection use this registry automatically; no character-specific edits are needed. Keep asset licenses beside the files.

`footstepVolumeScale` is the master multiplier. Grass uses four individual foot contacts extracted from a real walking recording and normalized to −22 LUFS with a −4 dB true-peak ceiling. Its landing volume is independently reduced through `landing.volumeScale`. The untouched CC0 preview remains alongside the game-ready files. Speed-dependent pitch/volume and nonrepeating variants are retained.

The initial player spawn is marked for a silent landing. The marker is consumed on the first grounded frame (or cleared on a deliberate jump or a real fall). Later gameplay landings retain their normal audio. This only suppresses the landing sound, not spawn visuals.

Tests: `node --test tests/playerAudio.test.js`.


## UI cues and source records

Level 10 artwork has a continuous gold CSS glow with gently cycling brightness
in the shared `levelBadge.css`,
covering both framed and standalone badges across selection, profiles, lobbies,
and battle HUDs. Reduced motion keeps a static glow.

Successful character upgrades transition the details badge from the previous
level to the new one alongside the stat count-up. Reduced motion shows the new
badge immediately. Stat gain labels reserve their space before confirmation so
revealing the plus amounts does not resize the panel. Purchase confirmations use the shared pixel window styles. Server-confirmed
purchase confirmations stay on Body. Successful unlocks shake and enlarge the
existing lock icon, then split the existing crossed-chain artwork; upgrades use a gold halo behind the body and a simple Level Up label. Result labels stay brief. Stat headers always reserve
gain space so confirmation does not change the panel height. Reduced motion skips the
burst and stat count-up while retaining the result message.

`src/client/ui/uiSounds.js` owns delegated click/hover sounds, lazy loading and manual cue suppression. [UI sound usage and credits](../../public/assets/ui-sound/README.md), [reward sound sources](../../public/assets/ui-sound/rewards/README.md), and [movement sound provenance](../../public/assets/movement/README.md) stay beside their assets.

Profile battle logs share `battleLogView.js` on the lobby popup and standalone
profile page. Only recorded victories, defeats, and draws appear in the list and
past-ten summary; legacy matches with unknown results are hidden. The pixel-font
summary labels net trophies, wins, losses, and draws when present. Match rows show
only the result, mode, map, time, and recorded trophy change; combat stats and
rewards are omitted. Recorded zero trophy changes remain visible.

Match results play separate win, loss, and draw cues. Null and explicit `draw`
outcomes use `/assets/game-sounds/draw.mp3`, a short original suspended-fifth
chime; result playback pauses map music and respects the existing SFX settings
and audio-unlock handling. [Draw sound source](../../public/assets/game-sounds/README.md).

Both the lobby profile and standalone profile use `src/client/account/nameChangeDialog.js` for name changes. They open a dedicated native modal using the shared popup frame, chroma header and close button. The dialog states the 50-gem cost and once-per-month limit, shows the next eligible date or current balance, and keeps validation errors inside the dialog. Its blue Change Name action includes the gem icon and price. Escape, Cancel and backdrop dismissal restore focus to the opener.

Projectile damage uses one fading red screen pulse. While its tween is active,
the poison-water renderer leaves opacity to the tween and pauses the looping
water warning; the warning resumes afterward only if the player is in water.

Sudden-death poison water uses a dense murky-green body, layered acid-green surface glow,
and outlined bubbles in `poisonWaterRenderer.js`. Bubble positions advance by
elapsed frame time independently of the rising surface, fading at their spawn
and surface instead of recalculating their loop from the changing water depth.
Surface interpolation is frame-rate independent; long resume gaps are capped.

Sparrow arrows use compact orange/gold pixel flame clusters on both basic and
super volleys. Flight flames trail backward; embedded flames rise until the arrow
expires. Super flames are larger, with a brief bow-side spark cue and a held-draw
release animation. These cosmetics do not change burn damage or projectile timing.
The renderer caps flame objects and clears them on presentation reset/shutdown.

Gloop spars with Thorg, who retreats while hurt and slimed. Gloop prioritizes his earned hook over another basic attack once charged. Preview rounds clear packet deduplication and slime splat history because their action IDs restart.

Showcase run animation, footstep cadence, and dust cadence follow simulated movement speed, including slime slows. Attack and super animations retain their normal timing.

## Ready restriction badges

The shell's existing runtime clock renders `views/readyRestrictionView.js` above
Ready in the lobby, without a separate floating maintenance banner.
Maintenance uses the runtime expiry and server clock offset;
Suspension uses the account's matchmaking suspension from `/status` (chat-only
restrictions do not appear here). Both can appear together, update once per second,
and hide individually at expiry. Countdown text includes days for long restrictions.
The pixel clock hand ticks while active; reduced motion keeps it still.
While restrictions are visible, the win streak moves into the same row on their
left. Restriction badges match the streak's original height and brown-and-gold
pixel frame; the streak's appearance stays the same. It returns to its usual position above
Ready after expiry.

## Party settings

Party settings reuse the main Settings `site-setting` cards and checkbox styling.
Owners can enable Hide enemy Bros (off by default) to replace opposing human
players' lobby and matchmaking-preview portraits with `/assets/ui/hidden-bro.png`.
Teammates and configured bots stay visible; character levels are hidden with the
portrait. This is a presentation setting, not network payload redaction; combat
still uses the real selection. It follows team changes and roster updates.
Apply `npm run migrate:apply -- party-hidden-bros` for the additive
`parties.hide_enemy_bros` column. Older schemas disable the new control.

## Rarity labels

`public/styles/ui-system.css` gives displayed rarity labels a shared square,
ink-framed badge with white pixel text and a solid rarity-colored fill. This
covers shop offers, collection cards and icons, skin details, card preview
captions, and admin offer previews. Rarity classes supply `--bb-rarity-fill`;
keep new rarity labels consistent with this shared treatment.

## Pixel arrows

Every arrow in the UI is one of four pixel SVGs in `public/assets/ui/arrows/`
(`arrow-right`, `arrow-left`, `arrow-up`, `arrow-down`). Use the `.bb-arrow`
class from `public/styles/ui-system.css` rather than a text glyph: build it with
`pixelArrow(direction, size)` from `src/client/ui/pixelArrow.js`, or
`arrowHtml()` from `src/shared/site/html.cjs` in server-rendered pages. The
arrow is a mask tinted by `currentColor`; `bb-arrow-sm` and `bb-arrow-lg` change
the size of one art pixel, and links and buttons nudge their arrow one art pixel
on hover. Pseudo-element arrows (chat jump-to-latest, skin steppers) mask the
same files. Markdown arrows (`→`) in help and news render as the pixel arrow.
The site header's navigation carets are intentionally separate.
