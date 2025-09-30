-- Migration: Create app_sessions table for consolidating app usage data
-- This replaces scattered app information across multiple tables

CREATE TABLE IF NOT EXISTS app_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    session_id UUID REFERENCES user_sessions(id) ON DELETE CASCADE,
    app_name TEXT NOT NULL,
    window_title TEXT,
    bundle_id TEXT, -- for macOS app identification

    -- Timing
    start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_time TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Enhanced context from LLM analysis
    context_type TEXT, -- work, learning, debugging, creating, etc.
    domain TEXT,       -- software development, data analysis, etc.
    activity_summary TEXT, -- brief description of what user did

    -- Metadata
    is_active BOOLEAN DEFAULT TRUE,
    transition_reason TEXT, -- why user switched (timeout, explicit switch, etc.)

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_session_id ON app_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_app_name ON app_sessions(app_name);
CREATE INDEX IF NOT EXISTS idx_app_sessions_active ON app_sessions(user_id, is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_app_sessions_start_time ON app_sessions(start_time);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_app_sessions_user_session_app ON app_sessions(user_id, session_id, app_name);

-- Function to auto-calculate duration when session ends
CREATE OR REPLACE FUNCTION update_app_session_duration()
RETURNS TRIGGER AS $$
BEGIN
    -- Calculate duration when end_time is set
    IF NEW.end_time IS NOT NULL AND (OLD.end_time IS NULL OR OLD.end_time != NEW.end_time) THEN
        NEW.duration_seconds = EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time))::INTEGER;
    END IF;

    -- Update timestamp
    NEW.updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update duration
DROP TRIGGER IF EXISTS app_session_duration_trigger ON app_sessions;
CREATE TRIGGER app_session_duration_trigger
    BEFORE UPDATE ON app_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_app_session_duration();

-- Function to end active app sessions when starting a new one
CREATE OR REPLACE FUNCTION end_previous_app_sessions()
RETURNS TRIGGER AS $$
BEGIN
    -- End any active sessions for this user/session that aren't this app
    UPDATE app_sessions
    SET
        end_time = NOW(),
        is_active = FALSE,
        transition_reason = 'app_switch'
    WHERE
        user_id = NEW.user_id
        AND session_id = NEW.session_id
        AND app_name != NEW.app_name
        AND is_active = TRUE
        AND id != NEW.id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-end previous sessions
DROP TRIGGER IF EXISTS end_previous_sessions_trigger ON app_sessions;
CREATE TRIGGER end_previous_sessions_trigger
    AFTER INSERT ON app_sessions
    FOR EACH ROW
    EXECUTE FUNCTION end_previous_app_sessions();

-- Add comments for documentation
COMMENT ON TABLE app_sessions IS 'Consolidated app usage tracking - replaces scattered app data across multiple tables';
COMMENT ON COLUMN app_sessions.context_type IS 'LLM-determined activity type: work, learning, debugging, creating, etc.';
COMMENT ON COLUMN app_sessions.domain IS 'LLM-determined domain: software development, data analysis, design, etc.';
COMMENT ON COLUMN app_sessions.duration_seconds IS 'Auto-calculated from start_time and end_time';
COMMENT ON COLUMN app_sessions.is_active IS 'TRUE if user is currently in this app session';