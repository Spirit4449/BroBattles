-- Run with game servers and matchmaking stopped, before deploying the renamed
-- character assets and code. Back up the database first. This transaction is
-- rerunnable and preserves the highest character level if both keys exist.
SET @rename_previous_safe_updates = @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;
START TRANSACTION;

UPDATE users SET char_class = CASE char_class WHEN 'wizard' THEN 'ozzy' WHEN 'huntress' THEN 'sparrow' WHEN 'hunteress' THEN 'sparrow' ELSE char_class END
WHERE char_class IN ('wizard', 'huntress', 'hunteress');
UPDATE users SET char_levels = JSON_REMOVE(JSON_SET(char_levels, '$.ozzy', GREATEST(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(char_levels, '$.ozzy')) AS UNSIGNED), 0), COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(char_levels, '$.wizard')) AS UNSIGNED), 0))), '$.wizard') WHERE JSON_CONTAINS_PATH(char_levels, 'one', '$.wizard');
UPDATE users SET char_levels = JSON_REMOVE(JSON_SET(char_levels, '$.sparrow', GREATEST(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(char_levels, '$.sparrow')) AS UNSIGNED), 0), COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(char_levels, '$.huntress')) AS UNSIGNED), 0), COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(char_levels, '$.hunteress')) AS UNSIGNED), 0))), '$.huntress', '$.hunteress') WHERE JSON_CONTAINS_PATH(char_levels, 'one', '$.huntress', '$.hunteress');
UPDATE users SET selected_skin_id_by_char = JSON_REMOVE(JSON_SET(selected_skin_id_by_char, '$.ozzy', 'ozzy-default'), '$.wizard') WHERE JSON_CONTAINS_PATH(selected_skin_id_by_char, 'one', '$.wizard') AND NOT JSON_CONTAINS_PATH(selected_skin_id_by_char, 'one', '$.ozzy');
UPDATE users SET selected_skin_id_by_char = JSON_REMOVE(JSON_SET(selected_skin_id_by_char, '$.sparrow', 'sparrow-default'), '$.huntress', '$.hunteress') WHERE JSON_CONTAINS_PATH(selected_skin_id_by_char, 'one', '$.huntress', '$.hunteress') AND NOT JSON_CONTAINS_PATH(selected_skin_id_by_char, 'one', '$.sparrow');
UPDATE users SET selected_skin_id_by_char = JSON_REMOVE(selected_skin_id_by_char, '$.wizard', '$.huntress', '$.hunteress') WHERE JSON_CONTAINS_PATH(selected_skin_id_by_char, 'one', '$.wizard', '$.huntress', '$.hunteress');
UPDATE users SET selected_profile_icon_id = CASE selected_profile_icon_id WHEN 'wizard' THEN 'ozzy' WHEN 'huntress' THEN 'sparrow' ELSE selected_profile_icon_id END WHERE selected_profile_icon_id IN ('wizard', 'huntress');
UPDATE users SET selected_card_id = 'ozzy-spell' WHERE selected_card_id = 'wizard-spell';
INSERT IGNORE INTO user_profile_icons (user_id, icon_id, unlocked_at, source) SELECT user_id, CASE icon_id WHEN 'wizard' THEN 'ozzy' ELSE 'sparrow' END, unlocked_at, source FROM user_profile_icons WHERE icon_id IN ('wizard', 'huntress');
DELETE FROM user_profile_icons WHERE icon_id IN ('wizard', 'huntress');
INSERT IGNORE INTO user_skins (user_id, skin_id, acquired_at, source) SELECT user_id, CASE skin_id WHEN 'wizard-default' THEN 'ozzy-default' ELSE 'sparrow-default' END, acquired_at, source FROM user_skins WHERE skin_id IN ('wizard-default', 'huntress-default');
DELETE FROM user_skins WHERE skin_id IN ('wizard-default', 'huntress-default');
INSERT IGNORE INTO user_cards (user_id, card_id, acquired_at, source) SELECT user_id, 'ozzy-spell', acquired_at, source FROM user_cards WHERE card_id = 'wizard-spell';
DELETE FROM user_cards WHERE card_id = 'wizard-spell';
UPDATE match_participants SET char_class = CASE char_class WHEN 'wizard' THEN 'ozzy' WHEN 'huntress' THEN 'sparrow' WHEN 'hunteress' THEN 'sparrow' ELSE char_class END WHERE char_class IN ('wizard', 'huntress', 'hunteress');
UPDATE match_bot_participants SET char_class = CASE char_class WHEN 'wizard' THEN 'ozzy' WHEN 'huntress' THEN 'sparrow' ELSE char_class END WHERE char_class IN ('wizard', 'huntress');
-- Preserve purchase limits for the renamed card offer.
UPDATE shop_redemptions SET offer_id = 'card-ozzy-spell' WHERE offer_id = 'card-wizard-spell';
COMMIT;
SET SESSION SQL_SAFE_UPDATES = @rename_previous_safe_updates;
