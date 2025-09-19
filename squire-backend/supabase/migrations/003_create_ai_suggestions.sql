-- Create ai_suggestions table
CREATE TABLE IF NOT EXISTS ai_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    session_ids UUID[] DEFAULT '{}',
    suggestion_type TEXT NOT NULL CHECK (suggestion_type IN ('productivity', 'workflow', 'automation', 'optimization', 'learning', 'reminder', 'insight')),
    suggestion_content JSONB NOT NULL,
    confidence_score NUMERIC(3,2) CHECK (confidence_score >= 0.00 AND confidence_score <= 1.00),
    context_data JSONB DEFAULT '{}' NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'viewed', 'accepted', 'dismissed', 'expired')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    feedback JSONB DEFAULT '{}' NOT NULL,
    metadata JSONB DEFAULT '{}' NOT NULL,
    priority INTEGER DEFAULT 5 CHECK (priority >= 1 AND priority <= 10)
);

-- Create indexes for performance
CREATE INDEX idx_ai_suggestions_user_id ON ai_suggestions(user_id);
CREATE INDEX idx_ai_suggestions_user_status_created ON ai_suggestions(user_id, status, created_at DESC);
CREATE INDEX idx_ai_suggestions_expires_at ON ai_suggestions(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_ai_suggestions_suggestion_type ON ai_suggestions(suggestion_type);
CREATE INDEX idx_ai_suggestions_priority ON ai_suggestions(priority DESC);
CREATE INDEX idx_ai_suggestions_confidence ON ai_suggestions(confidence_score DESC);

-- Create GIN index for JSONB columns
CREATE INDEX idx_ai_suggestions_content_gin ON ai_suggestions USING GIN(suggestion_content);
CREATE INDEX idx_ai_suggestions_context_gin ON ai_suggestions USING GIN(context_data);

-- Create array index for session_ids
CREATE INDEX idx_ai_suggestions_session_ids_gin ON ai_suggestions USING GIN(session_ids);

-- Enable Row Level Security
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for suggestion ownership (temporary policy for dummy user testing)
CREATE POLICY "Users can access own suggestions" ON ai_suggestions
    FOR ALL USING (true); -- Temporary policy for dummy user testing

-- Create function for creating AI suggestions
CREATE OR REPLACE FUNCTION create_ai_suggestion(
    p_user_id UUID,
    p_session_ids UUID[],
    p_suggestion_type TEXT,
    p_suggestion_content JSONB,
    p_confidence_score NUMERIC DEFAULT NULL,
    p_context_data JSONB DEFAULT '{}',
    p_expires_hours INTEGER DEFAULT 168, -- 7 days default
    p_priority INTEGER DEFAULT 5
)
RETURNS UUID AS $$
DECLARE
    new_suggestion_id UUID;
    expires_timestamp TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Calculate expiration time
    IF p_expires_hours IS NOT NULL THEN
        expires_timestamp := NOW() + (p_expires_hours || ' hours')::INTERVAL;
    END IF;

    INSERT INTO ai_suggestions (
        user_id,
        session_ids,
        suggestion_type,
        suggestion_content,
        confidence_score,
        context_data,
        expires_at,
        priority
    )
    VALUES (
        p_user_id,
        p_session_ids,
        p_suggestion_type,
        p_suggestion_content,
        p_confidence_score,
        p_context_data,
        expires_timestamp,
        p_priority
    )
    RETURNING id INTO new_suggestion_id;

    RETURN new_suggestion_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function for updating suggestion status
CREATE OR REPLACE FUNCTION update_suggestion_status(
    p_suggestion_id UUID,
    p_new_status TEXT,
    p_feedback JSONB DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE ai_suggestions
    SET
        status = p_new_status,
        feedback = COALESCE(p_feedback, feedback),
        metadata = metadata || jsonb_build_object('status_changed_at', NOW())
    WHERE id = p_suggestion_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function for getting active suggestions
CREATE OR REPLACE FUNCTION get_active_suggestions(
    p_user_id UUID,
    p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    suggestion_type TEXT,
    suggestion_content JSONB,
    confidence_score NUMERIC,
    priority INTEGER,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.suggestion_type,
        s.suggestion_content,
        s.confidence_score,
        s.priority,
        s.created_at
    FROM ai_suggestions s
    WHERE s.user_id = p_user_id
        AND s.status = 'pending'
        AND (s.expires_at IS NULL OR s.expires_at > NOW())
    ORDER BY s.priority DESC, s.confidence_score DESC, s.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function for cleaning up expired suggestions
CREATE OR REPLACE FUNCTION cleanup_expired_suggestions()
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE ai_suggestions
    SET status = 'expired'
    WHERE status IN ('pending', 'viewed')
        AND expires_at IS NOT NULL
        AND expires_at < NOW();

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;