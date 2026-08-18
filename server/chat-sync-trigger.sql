-- ================================================================
-- Chat Support ↔ Tracker Auto-Sync Trigger
-- Run this ONCE on your VPS PostgreSQL after deploying chat-support
-- ================================================================
-- When a Shopify store is connected in the Tracker (businesses table),
-- this trigger automatically creates a matching site in the chat sites table.
-- ================================================================

-- Auto-create a chat site when a business connects Shopify
CREATE OR REPLACE FUNCTION sync_business_to_chat_site()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when is_shopify_connected flips to true
  IF NEW.is_shopify_connected = true
     AND (OLD.is_shopify_connected IS DISTINCT FROM true)
     AND NEW.shopify_domain IS NOT NULL THEN

    INSERT INTO sites (
      id, name, domain, widget_key, ai_enabled,
      tracker_business_id, created_at, updated_at
    )
    VALUES (
      gen_random_uuid(),
      NEW.name,
      NEW.shopify_domain,
      gen_random_uuid(),
      true,
      NEW.id,
      now(),
      now()
    )
    ON CONFLICT (tracker_business_id) DO UPDATE SET
      name      = EXCLUDED.name,
      domain    = EXCLUDED.domain,
      updated_at = now();

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_business_sync_to_chat ON businesses;

CREATE TRIGGER trg_business_sync_to_chat
  AFTER INSERT OR UPDATE OF is_shopify_connected, shopify_domain
  ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION sync_business_to_chat_site();

-- Backfill: sync any businesses already connected before this trigger was added
INSERT INTO sites (id, name, domain, widget_key, ai_enabled, tracker_business_id, created_at, updated_at)
SELECT
  gen_random_uuid(),
  b.name,
  b.shopify_domain,
  gen_random_uuid(),
  true,
  b.id,
  now(),
  now()
FROM businesses b
WHERE b.is_shopify_connected = true
  AND b.shopify_domain IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sites s WHERE s.tracker_business_id = b.id
  );

SELECT 'Trigger installed and backfill complete.' AS result;
