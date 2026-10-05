# Progression and cosmetics

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

Modes unlock automatically at the player's highest achieved trophies. Queue admission checks every human party member on the server. Skins, icons, cards and Bros require their Trophy Road claim. Ownership is permanent and uses the same tables and equip endpoints as Shop and Profile. Gloop cannot be bought through `/buy` or unlocked through `/upgrade`; existing owners keep their levels. To add another trophy Bro, set its stats' `unlockMethod` to `{ "type": "trophyRoad", "min": ... }` and add a `character` reward with its character key.

Only Duels and Bank Bust currently have playable game implementations in this repository. The other modes retain their existing Coming Soon status independently of trophy access. Adding their gameplay is a separate task.

## User-supplied milestone icons

The 200-trophy icon is retired. The user-supplied square WebP images are installed at:

- `public/assets/profile-icons/500trophies.webp`
- `public/assets/profile-icons/1000trophies.webp`
- `public/assets/profile-icons/5000trophies.webp`
- `public/assets/profile-icons/7500trophies.webp`
- `public/assets/profile-icons/10000trophies.webp`

Their IDs, road rewards and profile selection are registered. The original supplied images remain the selectable profile icons; generated bundle illustrations represent them on multi-reward road cards.

## Claims and presentation

`createRewardPresentation` in `src/client/lobby/shop/shop.js` is shared by Shop and Trophy Road. The revised showcase removes circular reward halos, uses large cosmetic artwork, places currencies in a separate row, and keeps collectible reveals open until Done/Escape. The header wallet sits above the road blur, glows on impacts, and counts up as currency particles arrive. Reduced motion skips the flying particles and entrance motion. Claim errors stay inline on the road.

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
- `rarity`
- `cost.coins` and `cost.gems` (display/legacy metadata; sale prices are
  authoritative in `src/shared/catalogs/shopCatalog.json`)

### Layout Standardization

Renderer now uses one fixed internal placement for every card. Keep all frames
in the same 650x1250 template with consistent inner content area.

### Adding A New Card

1. Add the frame image under `public/assets/player-cards/`.
2. Add its entry in `src/shared/catalogs/playerCardsCatalog.json`.
3. Ensure `id` is stable and unique. Never rename ids that are already owned by users.

4. Add a validated Shop offer when the card should be purchasable, or grant
   ownership through a progression/service path.

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
