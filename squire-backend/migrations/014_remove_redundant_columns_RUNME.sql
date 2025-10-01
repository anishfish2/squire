-- ========================================
-- COMPLETE MIGRATION: Remove Redundant Columns from user_sessions
-- ========================================
-- Run this entire file in your Supabase SQL Editor
--
-- These columns are redundant because:
-- - ocr_logs[] is stored in ocr_events table
-- - mouse_movements[] and clicks[] are stored in user_events table
-- - app_usage is stored in app_sessions table
--
-- This migration reduces storage overhead and simplifies the schema

-- ========================================
-- Step 1: Drop dependent trigger first
-- ========================================
DROP TRIGGER IF EXISTS trigger_extract_knowledge_from_session ON user_sessions;

-- ========================================
-- Step 2: Drop the function that the trigger used
-- ========================================
DROP FUNCTION IF EXISTS extract_knowledge_from_session();

-- ========================================
-- Step 3: Update generate_session_insights function
-- ========================================
-- This function now queries from the proper tables instead of redundant columns
CREATE OR REPLACE FUNCTION generate_session_insights(
    p_user_id UUID,
    p_session_id UUID
)
RETURNS JSONB AS $$
DECLARE
    session_duration INTERVAL;
    click_count INTEGER;
    ocr_count INTEGER;
    most_used_app TEXT;
    insights JSONB;
BEGIN
    -- Calculate session metrics from user_sessions
    SELECT
        COALESCE(session_end, NOW()) - session_start
    INTO session_duration
    FROM user_sessions
    WHERE id = p_session_id AND user_id = p_user_id;

    -- Get click count from user_events
    SELECT COUNT(*) INTO click_count
    FROM user_events
    WHERE session_id = p_session_id
    AND event_type = 'interaction'
    AND event_data->>'action' = 'mouse_click';

    -- Get OCR count from ocr_events
    SELECT COUNT(*) INTO ocr_count
    FROM ocr_events
    WHERE session_id = p_session_id;

    -- Get most used app from app_sessions
    SELECT app_name INTO most_used_app
    FROM app_sessions
    WHERE session_id = p_session_id AND user_id = p_user_id
    ORDER BY duration_seconds DESC NULLS LAST
    LIMIT 1;

    -- Build insights object
    insights := jsonb_build_object(
        'duration_minutes', EXTRACT(EPOCH FROM COALESCE(session_duration, INTERVAL '0')) / 60,
        'click_count', COALESCE(click_count, 0),
        'ocr_count', COALESCE(ocr_count, 0),
        'most_used_app', most_used_app,
        'productivity_score', CASE
            WHEN EXTRACT(EPOCH FROM COALESCE(session_duration, INTERVAL '0')) > 3600 AND COALESCE(click_count, 0) > 100 THEN 'high'
            WHEN EXTRACT(EPOCH FROM COALESCE(session_duration, INTERVAL '0')) > 1800 AND COALESCE(click_count, 0) > 50 THEN 'medium'
            ELSE 'low'
        END
    );

    RETURN insights;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- Step 4: Drop GIN indexes for redundant columns
-- ========================================
DROP INDEX IF EXISTS idx_user_sessions_app_usage_gin;

-- ========================================
-- Step 5: Drop the redundant columns
-- ========================================
ALTER TABLE user_sessions DROP COLUMN IF EXISTS ocr_logs CASCADE;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS mouse_movements CASCADE;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS clicks CASCADE;
ALTER TABLE user_sessions DROP COLUMN IF EXISTS app_usage CASCADE;

-- ========================================
-- Step 6: Update add_session_event function
-- ========================================
-- Remove references to dropped columns
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

-- ========================================
-- Step 7: Add documentation
-- ========================================
COMMENT ON TABLE user_sessions IS 'High-level session container - stores session lifecycle only. Event data stored in: ocr_events, user_events, app_sessions, keystroke_sequences';
COMMENT ON COLUMN user_sessions.session_data IS 'JSONB for miscellaneous session metadata only. Specific events stored in dedicated tables.';

-- ========================================
-- MIGRATION COMPLETE
-- ========================================
-- Columns dropped: ocr_logs, mouse_movements, clicks, app_usage
-- Trigger dropped: trigger_extract_knowledge_from_session
-- Functions updated: generate_session_insights, add_session_event
