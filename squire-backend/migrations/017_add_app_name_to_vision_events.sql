-- Migration 017: Add app_name column to vision_events table
-- This stores the app context for each vision capture

ALTER TABLE vision_events
ADD COLUMN IF NOT EXISTS app_name TEXT;

-- Create index for faster app-based queries
CREATE INDEX IF NOT EXISTS idx_vision_events_app_name
ON vision_events(app_name);

-- Create composite index for user + app queries
CREATE INDEX IF NOT EXISTS idx_vision_events_user_app
ON vision_events(user_id, app_name, created_at DESC);
