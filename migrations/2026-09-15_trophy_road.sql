-- Apply with scripts/apply-trophy-road-migration.cjs (safe to re-run).
-- Keep historical claim receipts and balances. Only new non-currency rewards
-- are backfilled for milestones claimed on the old road.
UPDATE users u LEFT JOIN (
 SELECT user_id, MAX(CAST(SUBSTRING(tier_id, 13) AS UNSIGNED)) AS claimed_peak
 FROM user_trophy_reward_claims WHERE tier_id REGEXP '^trophy-tier-[0-9]+$' GROUP BY user_id
) c ON c.user_id = u.user_id
SET u.trophy_peak = GREATEST(u.trophy_peak, COALESCE(u.trophies, 0), COALESCE(c.claimed_peak, 0));
UPDATE users SET selected_profile_icon_id = 'ninja' WHERE selected_profile_icon_id = '200trophies';
