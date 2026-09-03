# Adaptive matchmaking bots

Duels supports server-run bots on Lushy Peaks, Mangrove Meadow, and Serenity. No bot accounts, browser sessions, or inference API calls are created. Bank Bust and mid-match disconnect replacement are not supported.

## Deploy and enable

1. Drain active matches and stop old matchmaking workers, then apply `migrations/2026-09-03_adaptive_bots.sql`. This adds temporary bot participants and converts queued ratings to account trophies without resetting wait times.
2. Deploy the server and the client build together. Existing bot-only vertical physics has been removed from the client, so mixed client/server versions should not be used.
3. Start with the existing admin **Fill with bots** control in a Duel queue. Explicit unlimited-health testing remains available only through that admin control.
4. For automatic-fill testing, add `"bots": { "enabled": true, "rolloutPercent": 100 }` to `runtime-overrides.json`, retaining its other settings, then restart the server. This enables every Duel queue. For a limited production cohort, use `10` instead: cohorts are assigned consistently by queued user/party ID, so 90% of accounts/parties will receive no automatic bots, even after repeated queue attempts. Increase the percentage after gameplay and capacity checks.
5. Disable new fills with `"enabled": false`. Existing rooms continue to completion. Configuration changes through the existing runtime-config service take effect immediately; direct file changes require a restart.

Defaults are disabled with zero rollout. A missing bot table does not prevent human-only rooms from loading, but enabling bots requires the migration.

### If automatic filling does not start

- Confirm the running server has loaded `enabled: true` and `rolloutPercent: 100` for testing. Editing the JSON file alone does not reload it; restart the server, then leave and rejoin a Duel queue. The first bot stages after 10 seconds, and the ready check follows once all seats are filled.
- Run the **entire** migration file with old matchmaking workers stopped. Warning 1050 (`Table already exists`) is harmless on reruns. The migration temporarily disables `SQL_SAFE_UPDATES` for its backfill transaction and restores the connection's previous setting afterward; no Workbench preference change is needed. An older copy can fail with error 1175 before clearing stale `claimed_by` values, which exclude those tickets from matchmaking.
- If the queue still does not fill, inspect the server console for `[mm] tick failed:`. Successful assembly logs `[match:assembled]` with human and bot counts. Bank Bust does not support automatic bots.

## Queue and participant contracts

- Human-first grouping preserves complete party tickets and their team relationships. Compatibility uses account trophies: a 100-trophy window expands 15 trophies per second up to 400.
- The oldest eligible ticket anchors each draft. One bot seat becomes available at 10 seconds, then one each second. At most five are needed. Humans can replace draft bots until the roster commits. Loading and the existing countdown follow matchmaking.
- All assembly paths lock and revalidate tickets in one transaction. Cancellation before lock prevents assembly; cancellation after commitment cannot undo a found match.
- Roster entries add `participantId` and `isBot`. Humans retain `user_id`; bots have `user_id: null`. Existing snapshot keys and socket event names remain compatible. Bot identity is explicit, never inferred from the display name.
- Names come from 3,072 unique combinations, without duplicates among match participants. Characters are chosen uniformly from all six available characters, using default skins. Bot level is the rounded median human selected-character level; skill uses the mean human trophies.
- Combat ownership uses participant IDs. Human socket input remains authenticated by its socket; a socket cannot claim to attack as a bot. Bots have server-side ammo and special charge and use the same damage/effect machinery.
- Human match rewards remain unchanged. Bot combat stats appear in results, but bots receive no account rewards. Bot rows are deleted on finish/cancellation/abandonment, with a minute-based stale-record sweep for failures. No name-based deletion of user accounts occurs.

## Physics, navigation, and tuning

`src/shared/duelMaps.json` owns Duel layouts, collision flags, texture dimensions, spawn anchors, bounds, and powerup points. Both map rendering and server collision use it. The map editor's **Export Map Snippets** action exports a replacement entry for this catalog on Duel maps. Preserve/update anchor references when removing or reordering platforms. New textures require accurate source dimensions; the editor exports them.

`src/shared/characterFrames.json` records base-skin idle frame dimensions, paired with the existing shared body and movement tuning. Refresh dimensions when replacing base character artwork. Bots use fixed-step acceleration, drag, gravity, ground/wall jumps, directional collision, and the same body offsets as the character implementation. They use server snapshots for both axes on clients.

Navigation edges are generated by simulating actual input sequences and replaying those sequences after approaching a takeoff point. Graphs are cached by map, character, and movement modifiers. Displacement cancels an invalid traversal, and edge-aware walking plus airborne recovery reduces unforced falls. Knockback, hooks, poison, and failed recovery can still kill a bot.

The decision controller samples visible nearby opponents and projectiles, delays reactions, and scores attacks, spacing, recovery, regeneration, and pickups. Each bot has reproducible personality and aim variation. Difficulty interpolates through trophy anchors at 0, 500, 1,250 and 2,000, with reaction ranges of 350–500, 250–350, 180–260, and 140–220 ms respectively. Mistakes occur at attack opportunities, not as per-frame random inputs. High-tier strength is a tuning target, not a forced outcome.

## Verification and telemetry

- `npm run test:bots`: deterministic queue, identity, physics, combat, lifecycle, rewards, and concurrency checks using isolated in-memory fixtures; no live database required.
- `node --test tests/powerups.test.js`: regression coverage for shared powerup effects.
- `npm run simulate:bots -- --seconds=45 --seed=17`: six-character headless smoke matches on all Duel maps, with per-bot damage, actions, recovery/fall counters, tick costs, and serialized packet volume. Optional `--map=1`, `--players=2`, and `--trophies=2000` narrow a scenario. This is a simulation benchmark, not a production capacity certification.
- `[match:assembled]` logs queue wait and human/bot counts. `[bots:match-result]` logs winner, human trophy ratings, bot difficulty and behavior counters, and bot processing costs. Game hub stats include active bot counts and timing totals.

Before broad rollout, test against MySQL with simultaneous queue/cancel/ready operations; play mixed human/bot matches from two browsers on every Duel map; inspect movement and attack effects under latency; confirm cleanup after abandoned matches and restart; and measure capacity on deployment hardware. Use aggregate results by trophy tier to tune high-tier win rates and reduce unforced falls/stalls. Humanlike play and high-trophy challenge still require human playtesting.
