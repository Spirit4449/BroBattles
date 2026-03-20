# Player Cards Implementation Guide

This guide explains how player cards are configured and integrated.

## Source Of Truth

All card metadata lives in:

- src/config/player-cards.catalog.json

Database stores only:

- which card ids a user owns (`user_cards`)
- which card id a user has equipped (`users.selected_card_id`)

Do not duplicate card URL/cost metadata in MySQL.

## Catalog Shape

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
- `cost.coins` and `cost.gems`

## Layout Standardization

Renderer now uses one fixed internal placement for every card. Keep all frames
in the same 650x1250 template with consistent inner content area.

## Adding A New Card

1. Add frame image under:

- public/assets/player-cards/

2. Add card entry in:

- src/config/player-cards.catalog.json

3. Ensure `id` is stable and unique. Never rename ids that are already owned by users.

4. Grant ownership by inserting into `user_cards` or through a route/service.

## API Endpoints (Current)

- GET `/player-cards/catalog`
- GET `/player-cards/owned`
- POST `/player-cards/select` with body `{ "cardId": "..." }`
- POST `/player-cards/buy` with body `{ "cardId": "..." }`

Selection is allowed only if user owns the card.

## Migration Notes

Use the SQL in database.md to add:

- `users.selected_card_id`
- `user_cards` table

## Troubleshooting

- Card not visible: check `assetUrl` path and copied file in public/assets/player-cards/
- Select returns 403: user does not own card id in `user_cards`
- Selected card null: migration for `selected_card_id` likely missing
- Wrong text placement: verify card art follows the shared frame template and interior spacing
