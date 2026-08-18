-- Migration: Add email feature support
-- Run this on the VPS: psql -U postgres tracking_crm -f migrate-email.sql

-- 1. site_emails table
CREATE TABLE IF NOT EXISTS site_emails (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  app_password TEXT NOT NULL,
  last_uid     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_emails_site_id ON site_emails(site_id);

-- 2. source column on conversations (chat | email)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'chat';

-- 3. email_thread_id column on conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS email_thread_id TEXT;

-- 4. email_message_id column on messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS email_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_email_message_id ON messages(email_message_id) WHERE email_message_id IS NOT NULL;

SELECT 'Migration complete ✓' AS status;
