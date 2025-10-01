-- Migration 016: Create vision_events table
-- This table stores vision analysis jobs and results

CREATE TABLE IF NOT EXISTS vision_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    session_id UUID REFERENCES user_sessions(id) ON DELETE SET NULL,
    ocr_event_id UUID REFERENCES ocr_events(id) ON DELETE SET NULL, -- Link to corresponding OCR event

    -- App context
    app_name TEXT NOT NULL,
    window_title TEXT,
    bundle_id TEXT,

    -- Screenshot storage
    screenshot_url TEXT, -- Supabase Storage URL
    screenshot_storage_path TEXT, -- Path within storage bucket
    screenshot_size_bytes INTEGER,
    screenshot_resolution TEXT, -- e.g., "1920x1080"

    -- Vision processing
    status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    vision_analysis JSONB, -- Structured vision analysis results
    vision_model TEXT, -- e.g., 'gpt-4-vision-preview', 'claude-3-5-sonnet'
    processing_time_ms INTEGER,

    -- Error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE, -- Soft delete for retention policy

    -- Constraints
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CHECK (retry_count >= 0 AND retry_count <= 3)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_vision_events_user_id ON vision_events(user_id);
CREATE INDEX IF NOT EXISTS idx_vision_events_session_id ON vision_events(session_id);
CREATE INDEX IF NOT EXISTS idx_vision_events_ocr_event_id ON vision_events(ocr_event_id);
CREATE INDEX IF NOT EXISTS idx_vision_events_status ON vision_events(status) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_vision_events_app_name ON vision_events(app_name);
CREATE INDEX IF NOT EXISTS idx_vision_events_created_at ON vision_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vision_events_deleted_at ON vision_events(deleted_at) WHERE deleted_at IS NULL;

-- GIN index for vision analysis JSONB queries
CREATE INDEX IF NOT EXISTS idx_vision_events_vision_analysis ON vision_events USING GIN (vision_analysis);

-- Create a view for active (non-deleted) vision events
CREATE OR REPLACE VIEW active_vision_events AS
SELECT * FROM vision_events
WHERE deleted_at IS NULL;

-- Function to soft delete old screenshots based on retention policy
CREATE OR REPLACE FUNCTION soft_delete_expired_vision_events()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Mark vision events as deleted if they exceed their retention period
    WITH to_delete AS (
        SELECT ve.id
        FROM vision_events ve
        JOIN user_app_preferences uap
            ON ve.user_id = uap.user_id
            AND ve.app_name = uap.app_name
        WHERE ve.deleted_at IS NULL
        AND ve.created_at < (NOW() - INTERVAL '1 day' * uap.screenshot_retention_days)
    )
    UPDATE vision_events
    SET deleted_at = NOW()
    WHERE id IN (SELECT id FROM to_delete);

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE vision_events IS 'Stores vision analysis jobs and results for screenshots';
COMMENT ON COLUMN vision_events.screenshot_url IS 'Public URL from Supabase Storage';
COMMENT ON COLUMN vision_events.vision_analysis IS 'Structured JSON results from vision model';
COMMENT ON COLUMN vision_events.deleted_at IS 'Soft delete timestamp for retention policy enforcement';
COMMENT ON FUNCTION soft_delete_expired_vision_events() IS 'Soft deletes vision events that have exceeded their retention period based on user preferences';
