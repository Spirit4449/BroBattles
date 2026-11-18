-- Some earlier installations indexed the Stripe payment-intent ID without
-- making it unique. Each intent identifies one order for refunds and disputes.
SET @payment_intent_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shop_orders' AND NON_UNIQUE = 0
    GROUP BY INDEX_NAME
    HAVING COUNT(*) = 1 AND MAX(COLUMN_NAME) = 'stripe_payment_intent_id'
      AND MAX(SUB_PART) IS NULL
  ),
  'SELECT 1',
  'ALTER TABLE shop_orders ADD UNIQUE KEY uniq_shop_order_payment_intent (stripe_payment_intent_id)'
);
PREPARE payment_intent_stmt FROM @payment_intent_ddl;
EXECUTE payment_intent_stmt;
DEALLOCATE PREPARE payment_intent_stmt;
