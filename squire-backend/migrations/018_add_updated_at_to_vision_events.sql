-- Migration 018: Add updated_at column to vision_events table
-- Required for tracking when vision events are updated

ALTER TABLE vision_events
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Create index for updated_at queries
CREATE INDEX IF NOT EXISTS idx_vision_events_updated_at ON vision_events(updated_at DESC);

-- Add trigger to automatically update updated_at on row updates
CREATE OR REPLACE FUNCTION update_vision_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_vision_events_updated_at ON vision_events;

CREATE TRIGGER trigger_vision_events_updated_at
    BEFORE UPDATE ON vision_events
    FOR EACH ROW
    EXECUTE FUNCTION update_vision_events_updated_at();

COMMENT ON COLUMN vision_events.updated_at IS 'Timestamp of last update, automatically maintained by trigger';
