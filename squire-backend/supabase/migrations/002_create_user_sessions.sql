-- Create user_sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    session_start TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    session_end TIMESTAMP WITH TIME ZONE,
    session_data JSONB DEFAULT '{}' NOT NULL,
    ocr_logs JSONB[] DEFAULT '{}',
    mouse_movements JSONB[] DEFAULT '{}',
    clicks JSONB[] DEFAULT '{}',
    app_usage JSONB DEFAULT '{}' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    session_type TEXT DEFAULT 'active' CHECK (session_type IN ('active', 'background', 'idle', 'closed')),
    device_info JSONB DEFAULT '{}' NOT NULL
);

-- Create trigger for updated_at timestamp
CREATE TRIGGER update_user_sessions_updated_at
    BEFORE UPDATE ON user_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_user_id_session_start ON user_sessions(user_id, session_start DESC);
CREATE INDEX idx_user_sessions_user_id_created_at ON user_sessions(user_id, created_at DESC);
CREATE INDEX idx_user_sessions_session_type ON user_sessions(session_type);
CREATE INDEX idx_user_sessions_active ON user_sessions(user_id, session_start) WHERE session_end IS NULL;

-- Create GIN indexes for JSONB columns
CREATE INDEX idx_user_sessions_session_data_gin ON user_sessions USING GIN(session_data);
CREATE INDEX idx_user_sessions_app_usage_gin ON user_sessions USING GIN(app_usage);
CREATE INDEX idx_user_sessions_device_info_gin ON user_sessions USING GIN(device_info);

-- Enable Row Level Security
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for session ownership (temporary policy for dummy user testing)
CREATE POLICY "Users can access own sessions" ON user_sessions
    FOR ALL USING (true); -- Temporary policy for dummy user testing

-- Create function for session management
CREATE OR REPLACE FUNCTION start_user_session(
    p_user_id UUID,
    p_device_info JSONB DEFAULT '{}',
    p_session_type TEXT DEFAULT 'active'
)
RETURNS UUID AS $$
DECLARE
    new_session_id UUID;
BEGIN
    INSERT INTO user_sessions (user_id, device_info, session_type)
    VALUES (p_user_id, p_device_info, p_session_type)
    RETURNING id INTO new_session_id;

    -- Update user's last_active timestamp
    UPDATE user_profiles
    SET last_active = NOW()
    WHERE id = p_user_id;

    RETURN new_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function for ending session
CREATE OR REPLACE FUNCTION end_user_session(
    p_session_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE user_sessions
    SET session_end = NOW(), session_type = 'closed'
    WHERE id = p_session_id AND session_end IS NULL;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function for adding session events
CREATE OR REPLACE FUNCTION add_session_event(
    p_session_id UUID,
    p_event_type TEXT,
    p_event_data JSONB
)
RETURNS BOOLEAN AS $$
BEGIN
    CASE p_event_type
        WHEN 'ocr' THEN
            UPDATE user_sessions
            SET ocr_logs = ocr_logs || ARRAY[p_event_data],
                updated_at = NOW()
            WHERE id = p_session_id;
        WHEN 'mouse_movement' THEN
            UPDATE user_sessions
            SET mouse_movements = mouse_movements || ARRAY[p_event_data],
                updated_at = NOW()
            WHERE id = p_session_id;
        WHEN 'click' THEN
            UPDATE user_sessions
            SET clicks = clicks || ARRAY[p_event_data],
                updated_at = NOW()
            WHERE id = p_session_id;
        ELSE
            UPDATE user_sessions
            SET session_data = session_data || jsonb_build_object(p_event_type, p_event_data),
                updated_at = NOW()
            WHERE id = p_session_id;
    END CASE;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;