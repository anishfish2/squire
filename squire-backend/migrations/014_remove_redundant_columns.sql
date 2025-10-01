-- Migration: Remove redundant columns from user_sessions table
-- These columns are redundant because:
-- - ocr_logs[] is stored in ocr_events table
-- - mouse_movements[] and clicks[] are stored in user_events table
-- - app_usage is stored in app_sessions table
--
-- This migration reduces storage overhead and simplifies the schema

-- Step 1: Drop dependent trigger first
DROP TRIGGER IF EXISTS trigger_extract_knowledge_from_session ON user_sessions;

-- Step 2: Drop the function that the trigger used
DROP FUNCTION IF EXISTS extract_knowledge_from_session();

-- Step 3: Update generate_session_insights function to not reference dropped columns
CREATE OR REPLACE FUNCTION generate_session_insights(
    p_user_id UUID,
    p_session_id UUID
)
RETURNS JSONB AS $$
DECLARE
    session_duration INTERVAL;
    insights JSONB;
BEGIN
    -- Calculate session metrics from new tables
    SELECT
        COALESCE(session_end, NOW()) - session_start
    INTO session_duration
    FROM user_sessions
    WHERE id = p_session_id AND user_id = p_user_id;

    -- Get click count from user_events
    DECLARE
        click_count INTEGER;
    BEGIN
        SELECT COUNT(*) INTO click_count
        FROM user_events
        WHERE session_id = p_session_id AND event_type = 'interaction'
        AND event_data->>'action' = 'mouse_click';
    END;

    -- Get OCR count from ocr_events
    DECLARE
        ocr_count INTEGER;
    BEGIN
        SELECT COUNT(*) INTO ocr_count
        FROM ocr_events
        WHERE session_id = p_session_id;
    END;

    -- Get most used app from app_sessions
    DECLARE
        most_used_app TEXT;
    BEGIN
        SELECT app_name INTO most_used_app
        FROM app_sessions
        WHERE session_id = p_session_id AND user_id = p_user_id
        ORDER BY duration_seconds DESC NULLS LAST
        LIMIT 1;
    END;

    -- Build insights object
    insights := jsonb_build_object(
        'duration_minutes', EXTRACT(EPOCH FROM session_duration) / 60,
        'click_count', COALESCE(click_count, 0),
        'ocr_count', COALESCE(ocr_count, 0),
        'most_used_app', most_used_app,
        'productivity_score', CASE
            WHEN EXTRACT(EPOCH FROM session_duration) > 3600 AND click_count > 100 THEN 'high'
            WHEN EXTRACT(EPOCH FROM session_duration) > 1800 AND click_count > 50 THEN 'medium'
            ELSE 'low'
        END
    );

    RETURN insights;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 4: Drop the GIN indexes that were created for these columns
DROP INDEX IF EXISTS idx_user_sessions_app_usage_gin;

-- Step 5: Now we can safely drop the redundant columns
ALTER TABLE user_sessions DROP COLUMN IF EXISTS ocr_logs;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS mouse_movements;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS clicks;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS app_usage;

-- Update the add_session_event function to remove references to dropped columns
CREATE OR REPLACE FUNCTION add_session_event(
    p_session_id UUID,
    p_event_type TEXT,
    p_event_data JSONB
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Only update session_data for generic events
    -- OCR, mouse, and click events are now stored in their respective tables
    UPDATE user_sessions
    SET session_data = session_data || jsonb_build_object(p_event_type, p_event_data),
        updated_at = NOW()
    WHERE id = p_session_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment explaining the simplified structure
COMMENT ON TABLE user_sessions IS 'High-level session container - stores session lifecycle only. Event data stored in: ocr_events, user_events, app_sessions, keystroke_sequences';
COMMENT ON COLUMN user_sessions.session_data IS 'JSONB for miscellaneous session metadata only. Specific events stored in dedicated tables.';
