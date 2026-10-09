# Progression and cosmetics

Character levels, per-level HP/damage/special gains, the level cap and upgrade prices live in `src/shared/characters/characterStats.js`. Base stats and unlock methods live in each character JSON. See [Game constants](constants.md) for current defaults. Runtime reward multipliers/floors/ceilings affect battle rewards; they do not redefine Trophy Road grants.

## Track and economy

46 milestones through 10,000 trophies. Normal intervals:

| Trophy range | Interval |
| --- | --- |
| 50–500 | 50 |
| 600–1,500 | 100 |
| 1,750–5,000 | 250 |
| 5,500–10,000 | 500 |

Exact unlock milestones (including 750 and 1,250) are inserted between normal rewards. Milestones are evenly spaced visually; the player pin interpolates between the actual trophy thresholds. This prevents the early cards from overlapping.

Ordinary rewards alternate 300 coins and 15 gems, increasing by 50% of that base for each 2,000 trophies. Milestone rewards replace the ordinary reward at that threshold. The current generated track grants 23,100 coins and 910 gems, plus cosmetics, Gloop and mode access. Definitions live in `src/shared/catalogs/trophySystem.catalog.json`; `buildTrophyRewardTrack()` in `src/server/services/trophies/trophySystem.js` derives the actual tiers and totals. Recalculate totals when editing the catalog.

## Unlocks

| Reward | Trophies |
| --- | --- |
| Duels, Tower, Bot Survival | Start |
| Capture the Flag | 100 |
| Bank Bust | 250 |
| Numeric player icon | 500 |
| Airdrop | 750 |
| Numeric player icon | 1,000 |
| Arena Spark player icon | 1,250 |
| Soccer | 1,500 |
| Slime Circuit player card | 1,750 |
| Gloop | 2,000 |
| Bedwars | 2,500 |
| Crystal Gloop skin | 3,500 |
| Numeric player icon | 5,000 |
| Numeric player icon | 7,500 |
| Arena Legend bundle | 10,000 |

The finale contains the 10,000 player icon, Arena Sovereign Ninja skin, Crown of the Arena player card, 6,000 coins and 250 gems.

Modes unlock automatically at the player's highest achieved trophies. Party queue admission checks the host’s peak trophies on the server; personal mode-selection changes check the acting player’s unlock. Solo admission checks the individual account. Skins, icons, cards and Bros require their Trophy Road claim. Ownership is permanent and uses the same tables and equip endpoints as Shop and Profile. Gloop cannot be bought through `/buy` or unlocked through `/upgrade`; existing owners keep their levels. To add another trophy Bro, set its stats' `unlockMethod` to `{ "type": "trophyRoad", "min": ... }` and add a `character` reward with its character key.

Only Duels and Bank Bust currently have playable game implementations in this repository. The other modes retain their existing Coming Soon status independently of trophy access. Adding their gameplay is a separate task.

## User-supplied milestone icons

The 200-trophy icon is retired. The user-supplied square WebP images are installed at:

- `public/assets/profile-icons/500trophies.webp`
- `public/assets/profile-icons/1000trophies.webp`
- `public/assets/profile-icons/5000trophies.webp`
- `public/assets/profile-icons/7500trophies.webp`
- `public/assets/profile-icons/10000trophies.webp`

Their IDs, road rewards and profile selection are registered. The original supplied images remain the selectable profile icons; generated bundle illustrations represent them on multi-reward road cards.

## Wallet synchronization

Lobby currency changes use `src/client/lobby/wallet.mjs`. Confirmed purchases and
reward claims update shared user data and notify Shop, character selection, and
the self-profile, including the lobby header. Character upgrades return the
committed coin balance; unlocks return the remaining gems. Background Shop,
Profile, and Trophy Road reads capture the wallet revision before fetching so an
older response cannot overwrite a balance updated while the request was pending.
Reward animation ticks are presentation-only; the acknowledged wallet remains
the source for affordability checks.

## Claims and presentation

`createRewardPresentation` in `src/client/lobby/shop/shop.js` is shared by Shop and Trophy Road. The revised showcase removes circular reward halos, uses large cosmetic artwork, places currencies in a separate row, and keeps collectible reveals open until Done/Escape. The header wallet sits above the road blur, glows on impacts, and counts up as currency particles arrive. Reduced motion skips the flying particles and entrance motion. Claim errors stay inline on the road.
Single player-card reveals center the card in a portrait box. The shared renderer uses the resize observer's untransformed dimensions, keeping the full card size and alignment after reveal entrance animations.

A claim locks the user row and writes its unique tier receipt, all item grants and currency in one database transaction. Repeated/concurrent requests cannot duplicate rewards. A grant failure rolls back the receipt and wallet together. The UI celebrates only an acknowledged server success, serializes claims, and refreshes ownership after dismissal. Profile and skin selection remain explicit player actions.

Gameplay skins use dedicated atlases and catalog asset overrides. Portraits are maintained separately; skin projectiles can have presentation overrides (for example the king crown and Crystal Gloop), while gameplay rules remain shared.

## Migration

Run before deploying the server changes:

```sh
node scripts/db/apply-migration.cjs trophy-road
```

The script adds `users.trophy_peak` if missing and seeds it from the maximum of current trophies and already-claimed road milestones. Future match rewards maintain it atomically. Historic unclaimed peaks cannot be recovered if the old database never recorded them.

Existing tier IDs and claim receipts are preserved. New non-currency items are backfilled for old claimed milestones, without reissuing currency or changing equipped cosmetics (except replacing the retired 200 icon). Gloop's existing level is preserved. The migration is designed to be rerun; verify each target database separately.

Verification:

```sh
node scripts/db/verify-trophy-road.cjs
node --test tests/trophyProgression.test.js tests/trophySkinAssets.test.js
npm test
npm run build
```

The MySQL verification creates a temporary user inside a transaction and rolls all test writes back. It checks unique ownership and claim receipts, Bro level preservation, and unchanged selected cosmetics.

## Win streaks

`getCurrentWinStreak()` in `src/server/services/match/battleLog.js` derives the
current consecutive wins from persisted completed battles, ordered by descending
match ID. Wins across modes count together; only a loss resets the streak.
Draws leave it unchanged and do not add a win. Live/cancelled battles and legacy outcomes without a winner do not count.
Keyset pagination supports streaks longer than the battle-log display limit.
Reading history avoids duplicate increments when match settlement is retried and
requires no new database migration. Existing recorded wins count immediately.

Status and public/self profiles expose `winStreak`. The lobby displays a flame
and number beside Ready in the same layout from two wins onward. Zero and one are hidden. Click (or keyboard activation) toggles the benefit list using shared popup slide/fade timing;
outside click, Escape, or focus leaving closes it. Hover does not open it. Active tiers are highlighted. Profiles expose `highestWinStreak` from `users.highest_win_streak`, backfilled
from completed history with the same outcome rules, and label it “Highest win streak,” including zero. Ready and
reward multipliers continue using the current streak. Match settlement raises
the stored peak with `GREATEST` in the reward transaction; losses, draws, and
retries cannot lower it. Profile reads do not scan history for the peak.
Match reward receipts save `winStreakBefore` and `winStreakAfter` in the same
transaction as the outcome. The end-of-match screen shows the increase or an
active streak of at least two being lost in a short, angled pixel badge pinned to the result
card’s top-left corner. A single counter changes from the previous value to the
new value; it never displays both numbers together. Wins emit rising pixel sparks; losses extinguish the trophy and drop
ash particles. Reduced motion uses a still icon and skips those effects; pending
rewards do not claim a streak change. Retries
reuse the saved transition. Draws persist an explicit `draw` winner value.

`src/shared/winStreakRewards.cjs` owns the benefit tiers: 3+ wins grants +25%
coins, 6+ adds +15% gems, and 9+ adds 2× trophies. Benefits combine across
currencies. The lobby list labels only active tiers and has no footer description.
The streak after the match determines eligibility, so the unlocking win qualifies.
Losses/draws have no streak bonus (draws retain the streak for the next win) and trophy losses remain unchanged. Bonuses
apply to positive match rewards after normal reward tuning/drop additions and
round once to whole units. Base rewards and bonus amounts are saved with final
credited amounts in the reward receipt. The match screen initially shows base
rewards, then a thick, scattered pixel trail travels from the fire trophy into each boosted card.
A gold flash and WobbleBoxx ding accompany the reward count-up
before rewards fly to the wallet. Reduced motion reveals the final numbers
without particle or count animation. Streak counter changes play the selected power-up
or first standalone loss cue through shared SFX settings; source credits live in
`public/assets/ui-sound/rewards/README.md`. The first win and loss of a one-win streak
have no streak badge or cue.

## Player Cards Implementation Guide

This guide explains how player cards are configured and integrated.

### Source Of Truth

All card metadata lives in:

- src/shared/catalogs/playerCardsCatalog.json

Database stores only:

- which card ids a user owns (`user_cards`)
- which card id a user has equipped (`users.selected_card_id`)

Do not duplicate card URL/cost metadata in MySQL.

### Catalog Shape

Top-level keys:

- `defaultCardId`: fallback card id
- `renderGuides.fullCardSizePx`: full exported card frame size
- `renderGuides.nonGraphicAreaPx`: internal stats/content panel reference size
- `cards[]`: card definitions

Per-card keys:

- `id`: stable unique id (stored in DB)
- `name`: display label
- `assetUrl`: card frame asset URL
- `animationUrl`: optional transparent looping WebM video (or legacy WebP); `assetUrl` is its aligned still poster
- `animationVersion` / `animationAppleVersion`: content hashes for the WebM/MOV
  download URLs. The video importer stamps these automatically. After replacing
  videos by hand, run `node scripts/art/player-card-versions.cjs`, then
  `npm run validate:content`; validation rejects stale hashes.
- `renderScale`: optional centered artwork scale, defaulting to 1; common cards
  use 0.95 in profile and shop presentations. Battle uses measured
  `battleViewport` bounds so every visible frame fills the same card rectangle.
- `rarity`
- `cost.coins` and `cost.gems` (display/legacy metadata; sale prices are
  authoritative in `src/shared/catalogs/shopCatalog.json`)

### Layout Standardization

Renderer now uses one fixed internal placement for every card. Keep all frames
in the same 650x1250 template with consistent inner content area.
Profile battle-card selectors list owned cards by rarity (common, rare, epic,
legendary), then alphabetically by name within each rarity.

### Adding A New Card

1. Add the frame image under `public/assets/player-cards/<card-id>/`.
2. Add its entry in `src/shared/catalogs/playerCardsCatalog.json`.
3. Ensure `id` is stable and unique. Never rename ids that are already owned by users.

4. Add a validated Shop offer when the card should be purchasable, or grant
   ownership through a progression/service path.

Animated cards use transparent WebM exports at the source 24 fps. Radiant Silver uses
a 540×960 canvas; Crown of the Arena crops outer sparks/padding to 400×800.
Optional `animationViewport` records the card layout rectangle in source coordinates;
battle positions the larger image around that rectangle. Profile/shop renderers
use the same logical card rectangle in a resize-aware presentation box, letting
the exported effect canvas overflow instead of shrinking the card to fit its
transparent padding. Still posters use exactly the same placement as videos.
Profile selection starts them on hover or keyboard focus and keeps them looping
while visible. Hiding a tile restores the poster and pauses its retained decoder;
removal releases it. Shop offers show their banner artwork, with an info button
for a player-card preview that contains the full effect canvas. Reward reveals and battle-introduction frames loop
automatically. Reduced-motion users receive the poster. The shared
`src/client/views/playerCardAnimation.cjs` resolves still/animated artwork.
The free `default` card is the static wood frame. The former animated silver
default is now `radiant-silver` (Radiant Silver), a common shop card. Existing
`default` selections display wood; silver must be purchased separately.
Trophy Road cards keep their existing IDs and unlocks.

The eight supplied card folders plus Radiant Silver have standalone Profile
offers and participate in the weekly Sales rotation. The `sales` section applies
the configured virtual-currency discount to pinned and rotated offers; both
the original and discounted prices appear in the shop, and the server charges
the current sale price. Bundles use their catalog price; their crossed-out
cosmetic value is calculated from the standalone offers, with included currency
listed as its own bundle item rather than converted at an undefined exchange rate.
The bundle tile names every included item. Active sale cards are hidden from the regular Profile
list until they rotate out. Profile and Skins
hide owned items, sort by rarity ascending, then name, and initially show at most two responsive
rows with an Expand/Show less control.
Standalone card prices are 25 gems for common, 50 for rare, 100 for epic, and
200 for legendary, including Shuriken Strike at the rare price. Bundles and
Trophy Road unlocks are unchanged. Reimport the uploaded batch with
`node scripts/art/install-new-player-cards.cjs`; folder names determine names,
PNG filenames determine rarities, and video filenames have no meaning.

Reimport the supplied steel/royal videos with
`node scripts/art/import-player-card-videos.cjs <steel.mp4> <royal.mp4>`.
Import Slime Circuit or Shuriken Strike individually with
`node scripts/art/import-player-card-videos.cjs --card <slime-circuit|shuriken-strike> <source.mp4>`.
Both use a 540×960 canvas. Slime uses background-connected green removal to
preserve its green artwork. Shuriken uses global keying and despill because its
red/steel artwork has no intentional green; see the asset-local README for source
mapping. All formats are encoded successfully before replacing installed assets.
The importer removes green, preserves the dark content panel, strips audio,
and preserves every source frame. Crown uses a crop after scaling; its adjusted
viewport and poster preserve content alignment. Inspect
the loop, transparent edges, and effect bounds after changing source footage.

### API Endpoints (Current)

- GET `/player-cards/catalog`
- GET `/player-cards/owned`
- POST `/player-cards/select` with body `{ "cardId": "..." }`
- POST `/player-cards/buy` with body `{ "cardId": "..." }` (legacy
  compatibility wrapper around the Shop commerce service)

Selection is allowed only if the user owns the card. New purchases belong in
Shop; profile interfaces only equip owned cards.

### Migration Notes

The database guide records the legacy schema prerequisites:

- `users.selected_card_id`
- `user_cards` table

### Troubleshooting

- Card not visible: check `assetUrl` path and copied file in public/assets/player-cards/
- Select returns 403: user does not own card id in `user_cards`
- Selected card null: migration for `selected_card_id` likely missing
- Wrong text placement: verify card art follows the shared frame template and interior spacing

The approved video presets are VP9 CRF 30 for Default and CRF 42 for Crown of the Arena.
`animationBytes` records each video's encoded size for network estimates. Cards show
posters first and request animation through the shared battle preload queue;
see [Client loading](client.md) for priority, network limits and lifecycle.
Visible profile tiles prepare their video sources before hover/focus. Started
tiles loop until hidden; decoders are retained for visibility changes and released
on removal. Closing a shop preview also releases its decoder and cleanup hooks.
Visible shop and battle cards use muted inline loops when downloads finish;
reduced motion, slow downloads and playback failures retain the poster.

## Maintaining the Shop

`src/shared/catalogs/shopCatalog.json` owns offers, prices, bundles, sale selection,
section order, labels, icons, and collapsible collection sections. The server
serializes those offers directly; adding a supported item or bundle needs no new
client switch or product ID. `shopOfferRules.js` owns sale pricing, selection,
standalone lookup and bundle valuation, shared by catalog lookup and commerce.

To add an offer:

1. Register cosmetic metadata and artwork in its cosmetic catalog first.
2. Add a stable, unique offer ID, an existing section ID, name, banner, price,
   grants and purchase limit to the shop catalog. Use `item` for one cosmetic,
   `bundle` for multiple rewards, or `currency-pack` for currency only. Provide
   just one standalone offer per cosmetic so legacy purchase routes and bundle
   valuation resolve the same price.
3. Use `lifetime` for a one-time virtual purchase or `unlimited` for repeatable
   purchases. Real-money offers currently support unlimited currency packs only;
   validation rejects unsupported purchase limits and eligibility rules.
4. Optionally set `eligibility.requiresNotOwned` to an included cosmetic. This
   blocks the whole offer when that cosmetic is owned. Other already-owned
   cosmetics are not granted twice or refunded; the listed bundle price stays
   fixed. Crossed-out bundle value includes only unowned cosmetics with standalone
   prices in the same currency. Included currency is listed separately.
5. Run `npm run validate:content` and the focused shop tests before shipping.

The Shop button, section tabs and unseen offer cards show red NEW tags; card tags
sit in the top-left corner. A section counts as seen once its header is at least
half visible for one second (a visible offer also counts for its section). That covers all its new offers, including collapsed
cards, and its displayed rotation. Tags stay visible throughout the visit;
acknowledgments are saved and tags clear only when closing the Shop. Unvisited
sections stay unread. Owned/purchased items do not trigger NEW. Viewing requires
no purchase or claim; price edits do not reset offer views. All existing unviewed
offers start unread when this feature is introduced.

`shop_views` saves acknowledgments per account, so other devices pick them up on
opening the Shop, returning to the lobby browser tab, or the foreground lobby
minute refresh. Background notification polling never rerenders an open Shop.
`POST /api/shop/viewed` accepts catalog offer IDs and the exact displayed rotation
keys. Old screens cannot acknowledge a newer rotation. Failed saves retain tags.
Apply `npm run migrate:apply -- shop-views` before deploying this feature.

Sales reset on Monday and dailies at midnight in the catalog timezone. Pinned
sale IDs stay featured; `promotedCount` entries rotate through `promotedOfferIds`.
Do not duplicate IDs across these lists. Active promotions appear only in Sales,
including skins. Offers whose home section is Sales must be in one of the lists;
when rotated out they cannot be purchased through a direct API request.

`rotation.sales.discountPercent` sets the default item discount (0 disables it).
Bundles retain their catalog price by default. An offer's optional
`saleDiscountPercent` overrides that behavior, including opting a bundle into a
sale or excluding an item with 0. Discounts round to whole currency units with a
minimum price of 1. The displayed percentage reflects that rounded price.
Checkout always uses server prices; virtual purchases also compare the displayed
amount and currency before charging. Completed receipts remain idempotent if a
price changes.

Catalog validation rejects malformed rotations, duplicate IDs/grants, ambiguous
standalone offers, invalid ownership prerequisites and unsafe amounts. An invalid
catalog makes the shop unavailable as a whole, rather than silently changing
rotation ordering or applying partial prices. Errors appear in admin Shop status
and server logs. Restart the server after catalog edits in production; development
watches shared JSON. Timezone changes require restart as well.

Rewards display the fulfilled receipt's grants, so rotation changes and edited
catalogs cannot substitute a different reward in the reveal. Checkout, daily and
virtual grants preserve equipment selections. Database and live Stripe sandbox
verification remain separate from the fast in-memory commerce tests.

Fulfilled lifetime receipts mark shop offers as Purchased, including bundles with
currency. Owning a prerequisite cosmetic without a bundle receipt only makes the
offer unavailable; it does not imply the bundle was purchased.

Profile overview stats show wins, highest win streak, and trophies in the lobby, and
trophies and total matches on the account page. Currency balances and average
character level are omitted from both profile overviews; the Bros grid still
shows each unlocked character’s level.
