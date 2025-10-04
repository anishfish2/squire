-- Migration 019: Add used_in_llm tracking to vision_events
-- This ensures each vision event is only used once in LLM context

ALTER TABLE vision_events
ADD COLUMN IF NOT EXISTS used_in_llm BOOLEAN DEFAULT FALSE;

-- Add timestamp for when it was used
ALTER TABLE vision_events
ADD COLUMN IF NOT EXISTS used_in_llm_at TIMESTAMP WITH TIME ZONE;

-- Create index for faster queries on unused events
CREATE INDEX IF NOT EXISTS idx_vision_events_unused
ON vision_events(user_id, used_in_llm, created_at DESC)
WHERE used_in_llm = FALSE;

-- Create composite index for unused events by app
CREATE INDEX IF NOT EXISTS idx_vision_events_unused_by_app
ON vision_events(user_id, app_name, used_in_llm, created_at DESC)
WHERE used_in_llm = FALSE;

COMMENT ON COLUMN vision_events.used_in_llm IS 'Whether this vision event has been used in an LLM context';
COMMENT ON COLUMN vision_events.used_in_llm_at IS 'Timestamp when this event was used in LLM context';
