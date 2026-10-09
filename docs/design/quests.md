# Quests — feature specification

Status: proposed design, not implemented. Updated October 9, 2026.

This document captures the proposed player experience and implementation requirements for daily and weekly quests in Bro Battles. It is a planning reference for product, design, and engineering. Numbers and choices below are recommended launch defaults unless explicitly identified as established requirements; they still need playtesting and economy tuning. Once implemented, maintained operational behavior belongs in the [progression guide](../development/progression.md).

## 1. Feature summary

Players receive three daily quests and four weekly quests. They earn coins and gems by completing gameplay goals and claiming their rewards. Completing all three daily quests also earns a small bonus. All assigned quests progress simultaneously; players do not need to activate or equip them.

The user's established requirements are three daily quests, three to five weekly quests, varied gameplay objectives, coins and gems initially, and a reward system that can expand to other items. Four weeklies, rerolls, bonus rewards, target counts, and the detailed rules in this document are proposals.

The feature should make an ordinary session feel rewarding, give players reasons to experiment, and offer achievable progress even when they lose. A daily set should usually fit within a short session; a weekly set should fit across several sessions without requiring attendance every day. Validate session-length assumptions with actual match data before launch.

## 2. Launch scope and defaults

| Area | Proposed launch behavior |
| --- | --- |
| Daily board | Three quests: participation, combat, and variety |
| Weekly board | Four quests: participation, combat, variety/objective, and daily completions |
| Assignment | Personalized per account, stable for the period |
| Progress | Automatic, cumulative, shared across devices |
| Daily reset | Midnight America/New_York |
| Weekly reset | Monday at midnight America/New_York |
| Rerolls | One free daily reroll per account per day; no weekly rerolls initially |
| Rewards | Coins and gems; fixed when the quest is assigned |
| Daily bonus | Complete all three daily slots for a small gem reward |
| Weekly bonus | None initially; each weekly has its own reward |
| Eligible play | Public matchmaking, including server-assigned bot fills |
| Excluded play | Private/custom games, manually added bot games, training, aborted matches |
| Collection | Manual Claim; completed unclaimed rewards delivered automatically at reset |
| Progress timing | Durable progress applied when a valid match settles |

Only Duels and Bank Bust are currently playable in the repository. Coming Soon modes must not enter the quest pool simply because their trophy threshold has been reached.

## 3. Player journey

1. The player enters the lobby and sees the Quests button.
2. Opening it shows the daily board, its reset countdown, and the three assigned objectives. The panel remembers the last selected tab afterward.
3. The player can inspect rewards or replace one unfinished daily quest using the free reroll.
4. Playing eligible matches advances every matching daily and weekly objective.
5. The match-results screen shows relevant progress changes, including completed quests.
6. The player claims rewards from the results screen or the quest panel. The wallet updates only after confirmed server success.
7. Completing all daily slots unlocks the daily bonus immediately, even if individual rewards have not been claimed yet.
8. On reset, incomplete quests expire, completed unclaimed rewards are delivered, and a new board becomes available.

A player does not have to open the panel before playing. Assignment must happen before their first eligible match in a period, so that match counts.

## 4. Quest selection and fairness

### Daily slots

- **Participation:** An accessible objective such as completing matches. Avoid requiring wins in this slot.
- **Combat:** Damage, eliminations, or successful special attacks. Cumulative progress should survive losses.
- **Variety:** Different owned Bros, a Bro spotlight, a team variant, or an unlocked playable mode.

### Weekly slots

- **Participation:** A larger cumulative play goal.
- **Combat:** Wins, eliminations, damage, or successful specials.
- **Variety/objective:** Character variety or Bank Bust participation/objective contribution.
- **Daily completions:** Ten completed daily quests during the week.

Weekly assignment should leave room for playing several days rather than demanding seven. The proposed ten-daily goal can be completed in four days; verify that players joining late in the week still receive a sensible board.

### Eligibility and distribution

Assignment uses server-owned character ownership, personally unlocked modes, playable mode status, and supported metric availability. A party host's access must not cause an otherwise locked mode quest to be assigned to another player.

Do not require a purchase, cosmetic ownership, spending currency, a specific friend, or an unavailable map. Team quests can be completed with matchmaking teammates.

Assign multi-Bro goals only when the account owns enough Bros. Otherwise substitute an eligible objective. Do not quietly change the displayed target after assignment. Spotlight quests name an owned Bro explicitly.

Avoid duplicate templates within a board and avoid daily/weekly copies of the same template where the eligible pool permits. Related goals may overlap: a team win can advance participation, wins, and a weekly team objective together. Do not consume progress for only one quest.

Use a short recent-assignment history to reduce repetition, but prefer an accessible repeat over an impossible assignment. Selection should be bounded, with a verified fallback for every slot.

For first-time feature access or a new account arriving midweek, replace the weekly daily-completion goal with an achievable general objective when fewer than four daily periods remain. This exception applies only to first enrollment, not to existing players reopening their board late.

## 5. Quest catalog

Targets below are starting hypotheses, not promises about difficulty. Damage thresholds require telemetry because character levels, modes, and match lengths affect output. Do not ship damage quests with arbitrary thresholds just to fill the pool.

### Daily candidates

| Quest | Objective | Assignment notes |
| --- | --- | --- |
| Warm-Up | Complete 3 eligible matches | Participation default |
| Back in the Arena | Complete 2 Duels matches | Participation alternative |
| Victory Lap | Win 2 matches | Combat slot; never the guaranteed participation slot |
| Heavy Hitter | Deal a configured total of opponent damage | Tune separately from vault damage |
| Clean Up Crew | Earn 5 eliminations across matches | Validate feasibility in Duels versus Bank Bust |
| Special Delivery | Land 8 successful special attacks | Requires dedicated tracking |
| Switch It Up | Complete matches with 2 different owned Bros | At least two owned Bros |
| Bro Spotlight | Complete 2 matches with a named owned Bro | Character chosen on assignment |
| Squad Up | Complete 2 team Duels matches | 2v2 or 3v3; premade party unnecessary |
| Bank Job | Complete 2 Bank Bust matches | Bank Bust personally unlocked |
| Vault Breaker | Deal a configured total of enemy-vault damage | Separate objective-damage metric required |
| Power Trip | Collect 5 beneficial powerups | Requires pickup tracking and supported mode eligibility |

### Weekly candidates

| Quest | Objective | Assignment notes |
| --- | --- | --- |
| Arena Regular | Complete 20 eligible matches | Participation default |
| Winner's Circle | Win 8 matches | Wins need not be consecutive |
| Heavyweight | Deal a larger configured total of opponent damage | Tune using observed weekly play |
| Specialist | Land 40 successful special attacks | Requires dedicated tracking |
| Bro Rotation | Complete 3 matches each with 3 different owned Bros | Show per-Bro progress; at least three owned Bros |
| Team Player | Win 5 team matches | Eligible team Duels or Bank Bust |
| Demolition Crew | Deal a larger configured total of enemy-vault damage | Bank Bust unlocked |
| Power Sampler | Collect 4 distinct beneficial powerup types | Requires distinct-type tracking |
| Daily Business | Complete 10 daily quests | Counts completion, not claims or daily bonuses |

### Optional later skill challenges

- **Air Time:** Land attacks while airborne.
- **Ground Shaker:** Hit opponents with downward-stomp knockback.
- **Character Mastery:** Complete a meaningful character-specific combat action.
- **Future mode objectives:** Flag captures, goals, survival waves, or other objectives once those modes are playable and tracked.

These should expand variety after the core feature is stable. Avoid adding them to launch solely because the mechanic exists; reliable tracking and fair difficulty are prerequisites.

### Objectives to avoid in the regular rotation

Avoid taking damage intentionally, losing matches, spending currency, winning long streaks, remaining at low health, repeatedly pressing movement buttons, and competing for the final vault hit. These can encourage poor play or make daily rewards unreliable. Rare feats belong in a separate achievements system.

## 6. Exact progress semantics

| Metric | Counting rule |
| --- | --- |
| Match completion | One increment for a valid match in which the participant satisfies completion/participation rules |
| Win | One increment when the player's team wins; a draw is not a win |
| Opponent damage | Actual server-applied health damage to enemies, excluding overkill, self damage, friendly damage, and vaults |
| Elimination | One server-attributed enemy elimination; environmental deaths count only if authoritative combat attribution awards the elimination |
| Special hit | One increment per special activation that successfully damages an opponent, regardless of projectile count, targets, or damage ticks |
| Vault damage | Actual damage applied to the enemy vault, excluding overkill |
| Beneficial pickup | One successfully applied, eligible powerup pickup; harmful pickups do not count |
| Distinct pickup types | Set of eligible collected type IDs; repeats do not increase the distinct count |
| Different Bros | Set of character IDs used in completed eligible matches; skins do not create additional Bros |
| Three matches per Bro | Per-character match counts; a Bro contributes to the main count after reaching three |
| Daily completion | Each daily slot's first transition to complete, once; collection time is irrelevant |

“Land a special attack” should be described in the quest details as “Damage an opponent with a special. Each use counts once.” This avoids giving multi-hit or damage-over-time characters a large counting advantage. If a future Bro has a non-damaging special, exclude it from this template until there is a well-defined equivalent success condition.

Use contribution-based goals where possible. Do not add assists until the game has a reliable assist definition and authoritative tracking.

A brief disconnect followed by a successful rejoin should not invalidate progress. A player who leaves and never returns does not earn participation completion; a player eliminated in Duels is still a legitimate participant through the match outcome and must not be treated as AFK. Define activity using participation while alive, with combat/objective actions or meaningful movement. Existing match validity and abandonment behavior must be audited before implementing these checks. Do not introduce a minimum match duration that rejects genuine quick wins.

The proposed launch policy settles all quest metrics only for valid, eligible participants at the end of the match; unfinished/abandoned matches do not bank damage or pickups separately.

## 7. Rewards and economy

### Initial reward schedule

To keep assignments comparable, use slot reward budgets rather than letting an easy random draw pay much less than another player's board.

| Slot | Illustrative reward |
| --- | --- |
| Daily participation | 150 coins |
| Daily combat | 200 coins |
| Daily variety | 150 coins |
| Daily completion bonus | 5 gems |
| Weekly participation | 750 coins |
| Weekly combat | 10 gems |
| Weekly variety/objective | 600 coins |
| Weekly daily-completion goal | 15 gems |

At full completion this adds 4,850 coins and 60 gems per seven-day week, before normal match rewards and other sources. These amounts are provisional. Compare them with match income, free shop claims, Trophy Road grants, upgrade costs, cosmetic prices, and expected completion rates before release.

Quest rewards do not receive win-streak multipliers or normal battle-reward multipliers. Tuning quest rewards should use an explicit quest economy configuration.

### Extensible reward model

Represent rewards as a list of typed grants. Examples:

```json
{
  "rewards": [
    { "type": "currency", "currency": "coins", "amount": 150 },
    { "type": "currency", "currency": "gems", "amount": 5 }
  ]
}
```

Future grants can reference a skin, player card, profile icon, or another supported catalog item. This is a proposed schema; adapt naming to a reusable existing grant contract during implementation rather than creating a competing reward system.

The UI must support several grants, show a readable name and quantity for each, and allow item inspection. Unknown grant types must fail catalog validation, not silently disappear or partially award.

Before activating collectible rewards, define duplicate-ownership treatment per grant type. Do not silently discard an advertised collectible. Claims preserve current equipment selections.

Persist a reward snapshot with the assigned quest and use it for claims and previews. Catalog changes must not alter a reward the player has already been promised.

## 8. Lobby and quest-panel UI

### Lobby entry

Add a Quests button alongside the existing progression/navigation controls, following the lobby's established placement and mobile layout. Use an accessible quest/scroll icon and visible text.

A badge shows the total number of claimable quest rewards and bonuses across both tabs. Unfinished quests do not create a permanent alert. Completion can briefly highlight the button; avoid continuous pulsing. Selecting the button opens the panel without leaving the lobby.

### Panel structure

Use the game's existing pixel-style frames, typography, currency art, buttons, focus handling, and overlay conventions. The discussion mockup demonstrates hierarchy and interactions; it is not the final art direction or a substitute for the existing UI components.

Order the panel as follows:

1. Quests title and accessible close button.
2. Daily and Weekly tabs, each with a claimable count when relevant.
3. Server-based reset countdown and reroll availability where applicable.
4. Quest cards in stable slot order.
5. Daily bonus strip, visible only on the Daily tab.
6. Contextual inline feedback for loading or failed actions.

Three daily cards should fit comfortably on a typical desktop. Four or five weekly cards can use the established panel scrolling pattern. On mobile, expand to a full-screen panel with vertically stacked cards and clear touch targets.

### Quest card contents

Every card includes a short name, exact objective, numeric progress, a progress bar, visible reward grants, and the relevant action/status. Use text as well as color to communicate completion.

| State | Presentation | Action |
| --- | --- | --- |
| In progress | Current/target count and partial bar | Reroll when eligible |
| Complete, unclaimed | Full bar and Complete label | Claim |
| Claim pending | Preserve card and show pending state | Disable duplicate submission |
| Claimed | Claimed checkmark and retained reward information | None |
| Claim failed | Preserve completed state with inline error | Retry |
| Expired | Omit from current board; retain receipt/history as needed | No progress or reroll |

Keep cards in their original positions after completion and collection. A moving list is harder to scan. For multi-Bro quests, expand a short breakdown showing each qualifying Bro and its progress; a top-level “1 / 3 Bros” alone is insufficient.

### Daily bonus

Show three completion markers, a “Complete all 3 daily quests” label, and the reward. Markers fill on completion, regardless of claim state. When all three fill, show Claim; afterward show Claimed. The bonus is one reward per daily period, not a repeatable loop.

### Reroll flow

Show “1 free reroll available” on the Daily tab. Each eligible unfinished card exposes a labeled Reroll action. Clicking it opens a small confirmation with the current progress and the consequence: “Replace this quest? Its progress will be lost. Uses your free daily reroll.”

The server replaces the quest in the same slot, preserving the slot's reward budget and the board's fairness rules. The replacement starts at zero and cannot be the same template as the discarded quest. Exclude active duplicate templates. If no alternative is eligible, explain that and do not spend the reroll.

A completed quest cannot be rerolled. Rerolling does not reopen completed slots, generate extra daily-completion credit, or reset the daily bonus. No paid rerolls initially.

Disable rerolls while the account has an active eligible match or an unsettled match result that could affect the quest. This prevents ambiguity about which assignment receives an in-flight result.

## 9. Results-screen and reward experience

Under normal match rewards, show a compact recap of quests changed by that match: objective name, before/after progress, and completion state. Show at most three rows initially, prioritize completions, and allow expansion for other affected quests. Include daily and weekly progress without duplicating the same card elsewhere on the results screen.

Completed entries can be claimed here using the same claim operation as the lobby. Collection in either location updates both views and the wallet. A completed daily bonus can appear as another claimable entry.

Animate progress toward the new value. Show a short completion cue and use the existing shared reward presentation where suitable. Routine currency claims should remain quick; future collectibles may warrant the existing richer reveal.

If settlement is still pending, show “Quest progress updating…” and refresh after authoritative settlement. Never present a locally predicted result as durably complete. If delayed results arrive after a subsequent match, recover progress without replaying celebrations indefinitely.

Do not add a permanent quest HUD during combat for launch. Keep the fight unobstructed.

## 10. Reset, expiry, and time rules

Use the named America/New_York timezone, matching the current shop catalog. Compute calendar boundaries with timezone-aware logic; do not assume every day is 24 hours or every week is 168 hours. The countdown comes from server timestamps and is corrected on refresh/foregrounding. Changing the device clock cannot create a new board.

Daily and weekly progress reset independently. There is no carryover of incomplete progress. Weekly progress persists across daily resets.

### Matches crossing a boundary

Bind a match to the daily and weekly periods active when the match starts, and persist those period/assignment references in the durable result record. The whole match counts toward those boards even if it ends after reset. A post-reset match counts toward the new boards.

A daily completed by a boundary-crossing match contributes to the weekly period associated with that daily's start date. It must not accidentally count toward the new week because the result was processed late.

Retain expired assignments until all referenced results can be reconciled. Do not delete a quest just because the current clock passed its end time.

### Unclaimed completed rewards

At reset, automatically deliver completed unclaimed rewards through the same receipt-backed grant path. Show a concise “Previous quest rewards collected” summary on the next lobby visit. If a late result completes an expired quest, deliver its reward then; if it finishes the daily set, deliver that bonus too.

Manual claims, reset delivery, and delayed-result delivery must compete for the same unique receipt, so exactly one grant succeeds. Auto-delivery needs a durable background/reconciliation path and login recovery, rather than depending solely on the player opening Quests. A failed delivery remains pending and retries; expiry must not erase it.

## 11. Backend design and integration

### Existing integration points

- Gameplay catalogs and shared definitions live in `src/shared/`.
- `src/server/core/gameRoom/rewardManager.js` tracks basic hits, damage, kills, and match rewards, and commits match results transactionally.
- `src/server/services/match/matchResultService.js` journals match-result snapshots for retry/reconciliation.
- `src/client/lobby/wallet.mjs` owns shared wallet synchronization.
- `src/client/lobby/shop/shop.js` contains the existing shared reward presentation.
- Trophy Road provides an existing pattern for transactional, receipt-backed claims; see the progression guide.

These are integration candidates, not evidence that quest-specific tracking already exists. Special activations, pickup types, objective damage, participation eligibility, and period bindings require an explicit audit and likely additional server data.

### Proposed components

- Shared quest catalog with stable IDs, categories, metrics, mode/ownership restrictions, target rules, and reward budgets.
- Server assignment service that resolves eligibility and persists stable boards.
- Server progress service that applies authoritative settled-match metrics.
- Server claim service using reusable validated reward grants and unique receipts.
- Reset/reconciliation worker that handles expired boards and outstanding delivery.
- Client quest store shared by lobby, results, badges, and claims.

Keep unsupported metrics out of assignment. Validate IDs, supported metrics, positive integer targets/currency amounts, valid reward references, category fallbacks, and launch mode eligibility with content validation.

### Conceptual storage

| Record | Required responsibilities |
| --- | --- |
| Quest period | User, period type/key, UTC boundaries, timezone/version, board version, reroll usage, daily bonus state |
| Quest instance | Unique ID, slot, template/version, target/parameter snapshot, reward snapshot, progress, lifecycle timestamps, replacement relationship |
| Quest progress receipt | Match/user processing identity, assignment references, durable applied status or unique application receipt |
| Quest reward receipt | Unique source identity, grant snapshot, committed reward amounts/items, delivery method, claimed timestamp |

Use database uniqueness for one board per user/period, one active instance per slot, one application per match/user/instance, one bonus per daily period, and one grant per reward source. Sets and per-character counters need structured progress, not just one integer. Exact schema should follow the existing MySQL migration and transaction conventions.

### Durable processing and concurrency

Persist new quest metrics and period bindings in the match journal before settlement. Once base rewards are committed, quest updates still need guaranteed retry: either integrate into the existing transaction without weakening recovery, or write a durable quest-processing outbox in that transaction. Prefer an outbox if it prevents quest failures from blocking ordinary match rewards. A plain callback after reward commit is insufficient because a crash could lose progress permanently.

Serialize progress, completion, claims, and rerolls consistently per user/period. Deduplicate replayed match results. A completed quest's transition increments Daily Business once, even when multiple metrics or retries attempt completion.

Claim validation and every reward grant must commit atomically with the receipt. The client sends a quest instance/source ID, never trusted amounts or balances. Return the existing receipt for duplicate requests. Partial grant failures roll back the entire claim.

Persist assignment and reward snapshots so catalog edits cannot change active contracts. Deploys must preserve processing support for outstanding snapshot versions. Reroll requests also need stable request IDs and idempotent responses; retrying after a dropped response must not spend another reroll.

### Proposed API surface

| Operation | Behavior |
| --- | --- |
| GET `/api/quests` | Ensure current boards exist; return authoritative boards, progress, rewards, reset timestamps, revision, and delivery summaries |
| POST `/api/quests/:instanceId/claim` | Validate account ownership/completion; grant or return existing receipt |
| POST `/api/quests/:instanceId/reroll` | Validate current period, match state, slot eligibility, and allowance; return persisted replacement |
| POST `/api/quests/daily/:periodKey/bonus/claim` | Claim or return existing daily-bonus receipt |

Names are proposals and should follow the repository's routing conventions during implementation. Use authenticated account identity; clients cannot query or mutate another account by supplying a user ID. Bound mutation rates and return specific errors for expired assignments, unavailable rerolls, incomplete quests, and temporarily pending settlement.

Notify connected clients when progress or claims change, and reconcile on lobby entry, panel open, and foregrounding. Use revisions so older reads cannot overwrite newer quest or wallet state. A lost socket notification must not permanently hide progress.

## 12. Edge cases and accessibility

- **No network:** Keep the last known board with a stale/offline label. Do not mark a claim successful until acknowledged.
- **Multiple devices:** Both see the same assignments, reroll allowance, progress, and receipts.
- **Unlock during a period:** Existing quests remain stable; subsequent assignment or an eligible reroll can use newly accessible content.
- **Mode disabled mid-period:** Replace an unfinished affected quest with a compatible fallback and preserve its reward budget without spending the player's reroll. Preserve progress only when the metric is semantically equivalent; otherwise provide a clearly labeled replacement or compensation policy. Do not silently erase completed rewards.
- **Feature disabled:** Stop new assignment/progress according to a defined operational switch, but keep recovery and delivery of earned rewards available.
- **Draw:** Counts as match completion, not a win.
- **Bots:** Server-assigned matchmaking bots may count under the stated policy; manually arranged bot farming does not. Verify match provenance rather than trusting a client flag.
- **Reset while open:** Refresh the board using server time; avoid replacing a card mid-claim. Reconcile pending results/claims by source ID.
- **Keyboard:** Focus stays within the modal, Escape closes it, and focus returns to the opener. Tabs and claim/reroll controls are keyboard accessible.
- **Reduced motion:** Reveal final progress and wallet values without flying particles or motion-heavy transitions.
- **Screen readers:** Announce completion and claim outcomes politely; label progress bars with the objective and numeric state.
- **Mobile:** Support narrow screens, wrapped descriptions, and touch targets; rewards must remain inspectable without hover.

## 13. Implementation sequence

1. **Tracking audit and economy baseline:** Verify current stat semantics, participant validity, public/custom provenance, and match duration/reward distributions. Finalize feasible targets and reward budgets.
2. **Core contract and persistence:** Add catalog validation, calendar-period calculation, stable assignment, snapshots, migrations, and idempotent receipts.
3. **Durable progress:** Implement existing reliable match/win/character metrics, journal/outbox recovery, completion transitions, and daily-to-weekly credit.
4. **Claims and reset delivery:** Add atomic reward grants, daily bonus, rollover, automatic delivery, and reroll concurrency handling.
5. **Player surfaces:** Build lobby panel, badge, quest store, wallet integration, match recap, mobile layout, and accessibility.
6. **Expanded tracking:** Add opponent/vault damage separation, special activation success, and powerup metrics as verified. Enable their templates only once reliable.
7. **Controlled launch:** Enable for a small account cohort, inspect correctness and economy, tune future assignments, then expand.

Launch can use a smaller varied pool built from completed matches, wins, owned Bros, team variants, and Bank Bust matches. The richer combat quests should not block shipping the core system if their telemetry needs more work. Never advertise an objective that cannot yet progress reliably.

## 14. Validation and acceptance criteria

The feature is ready when:

- Every eligible account receives exactly three dailies and the configured weekly count; four is the initial default.
- Boards remain stable across reloads, devices, and server restarts, and only accessible quests are assigned.
- A player's first eligible match counts without requiring a prior panel visit.
- One match advances all applicable quests exactly once, including after journal replay or an outbox retry.
- Draws, abandonments, eliminated participants, custom games, and bot provenance follow the documented rules.
- Special multi-hits and damage-over-time ticks cannot multiply activation credit; damage excludes overkill and the wrong target type.
- Rerolls consume at most one allowance, keep the reward budget, start fresh, and cannot race an unsettled match or completed quest.
- Daily completion credit and the daily bonus each happen once and do not depend on claiming rewards.
- Midnight, Monday, daylight-saving changes, delayed results, and matches crossing reset preserve the correct period attribution.
- Concurrent/manual/automatic claims never double-grant; a partial failure never leaves a partial reward.
- Catalog edits cannot change active objectives or promised rewards; unsupported reward types fail validation.
- Wallet and quest state synchronize across surfaces without older responses overwriting newer state.
- Claim errors remain recoverable, and loading/offline states never imply a reward was lost or delivered when it was not.
- Desktop and mobile layouts show complete objectives/rewards, with keyboard and reduced-motion behavior verified.

Follow the repository's testing rules during implementation: focused behavioral tests while iterating, `npm test` once when complete, content validation after catalog changes, and a client build when entry points/HTML require it. Do not run database tests without explicit authorization. This specification itself changes no runtime behavior and needs no game tests.

## 15. Launch measurement and remaining decisions

Measure assignment, eligible progress, completion, claim/delivery, reroll, and error events by quest template and version. Track median matches/time to completion, completion rates, most-rerolled templates, currency earned, and differences by account maturity and mode. Avoid collecting raw player input or unnecessary personal data.

Watch for quests that are frequently rerolled, fail to progress, disproportionately favor one Bro, or encourage players to abandon team objectives. Track pending settlement/delivery age, duplicate processing suppressed, and claim failure rates as reliability signals.

Before implementation, confirm or tune these proposed choices:

- Four weeklies rather than three or five.
- The New York reset schedule and whether it should remain aligned with the shop.
- Public-match-only eligibility and counting server-assigned bot fills.
- One free daily reroll and its progress-loss confirmation.
- Automatic delivery of completed unclaimed rewards at reset.
- Illustrative rewards, damage targets, and actual expected session length.
- Whether the initial launch includes special/powerup tracking or adds it afterward.

Future extensions include cosmetic rewards, occasional event quests, additional playable-mode objectives, and optional character mastery. Keep permanent achievements and any future season pass separate from the daily/weekly contract so the first release remains understandable.
