-- Create user_events table for knowledge graph
CREATE TABLE IF NOT EXISTS user_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('interaction', 'preference', 'pattern', 'habit', 'skill', 'goal', 'workflow', 'error', 'success')),
    event_data JSONB NOT NULL,
    importance_score NUMERIC(3,2) DEFAULT 0.50 CHECK (importance_score >= 0.00 AND importance_score <= 1.00),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    tags TEXT[] DEFAULT '{}',
    session_id UUID REFERENCES user_sessions(id) ON DELETE SET NULL,
    related_suggestion_id UUID REFERENCES ai_suggestions(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}' NOT NULL
);

-- Create indexes for performance
CREATE INDEX idx_user_events_user_id ON user_events(user_id);
CREATE INDEX idx_user_events_user_type_created ON user_events(user_id, event_type, created_at DESC);
CREATE INDEX idx_user_events_importance ON user_events(importance_score DESC);
CREATE INDEX idx_user_events_session_id ON user_events(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_user_events_tags_gin ON user_events USING GIN(tags);
CREATE INDEX idx_user_events_event_data_gin ON user_events USING GIN(event_data);

-- Enable Row Level Security
ALTER TABLE user_events ENABLE ROW LEVEL SECURITY;

-- Create RLS policy (temporary for dummy user testing)
CREATE POLICY "Users can access own events" ON user_events
    FOR ALL USING (true);

-- Create function for adding events with automatic importance scoring
CREATE OR REPLACE FUNCTION add_user_event(
    p_user_id UUID,
    p_event_type TEXT,
    p_event_data JSONB,
    p_importance_score NUMERIC DEFAULT NULL,
    p_tags TEXT[] DEFAULT '{}',
    p_session_id UUID DEFAULT NULL,
    p_related_suggestion_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    new_event_id UUID;
    calculated_importance NUMERIC;
BEGIN
    -- Auto-calculate importance if not provided
    IF p_importance_score IS NULL THEN
        calculated_importance := CASE p_event_type
            WHEN 'error' THEN 0.8
            WHEN 'success' THEN 0.7
            WHEN 'preference' THEN 0.6
            WHEN 'habit' THEN 0.7
            WHEN 'skill' THEN 0.6
            WHEN 'workflow' THEN 0.8
            ELSE 0.5
        END;
    ELSE
        calculated_importance := p_importance_score;
    END IF;

    INSERT INTO user_events (
        user_id,
        event_type,
        event_data,
        importance_score,
        tags,
        session_id,
        related_suggestion_id
    )
    VALUES (
        p_user_id,
        p_event_type,
        p_event_data,
        calculated_importance,
        p_tags,
        p_session_id,
        p_related_suggestion_id
    )
    RETURNING id INTO new_event_id;

    RETURN new_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;