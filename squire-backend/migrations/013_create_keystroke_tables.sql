-- Create keystroke sequences table for efficient storage
CREATE TABLE keystroke_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    sequence_start TIMESTAMP WITH TIME ZONE,
    sequence_duration INTEGER, -- milliseconds
    keystroke_count INTEGER NOT NULL,
    sequence_data JSONB NOT NULL, -- keys, timings, modifiers, patterns, metadata
    app_context TEXT, -- primary app during sequence
    session_context JSONB, -- additional session context
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create keystroke analysis table for storing analysis results
CREATE TABLE keystroke_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
    sequence_id UUID REFERENCES keystroke_sequences(id) ON DELETE CASCADE,
    analysis_data JSONB NOT NULL, -- patterns, efficiency scores, recommendations
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX idx_keystroke_sequences_user_time ON keystroke_sequences(user_id, created_at DESC);
CREATE INDEX idx_keystroke_sequences_app ON keystroke_sequences(app_context, created_at DESC);
CREATE INDEX idx_keystroke_analysis_user ON keystroke_analysis(user_id, created_at DESC);
CREATE INDEX idx_keystroke_analysis_sequence ON keystroke_analysis(sequence_id);

-- Create indexes on JSONB data for pattern queries
CREATE INDEX idx_keystroke_patterns ON keystroke_sequences USING GIN((sequence_data->'patterns'));
CREATE INDEX idx_keystroke_metadata ON keystroke_sequences USING GIN((sequence_data->'metadata'));
CREATE INDEX idx_analysis_recommendations ON keystroke_analysis USING GIN((analysis_data->'recommendations'));

-- Add comments for documentation
COMMENT ON TABLE keystroke_sequences IS 'Stores compressed keystroke sequences with timing and pattern data';
COMMENT ON TABLE keystroke_analysis IS 'Stores analysis results and efficiency insights for keystroke sequences';

COMMENT ON COLUMN keystroke_sequences.sequence_data IS 'JSONB containing keys[], timings[], modifiers[], patterns{}, metadata{}';
COMMENT ON COLUMN keystroke_analysis.analysis_data IS 'JSONB containing pattern analysis, efficiency scores, and recommendations';

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_keystroke_sequence_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER trigger_update_keystroke_sequence_updated_at
    BEFORE UPDATE ON keystroke_sequences
    FOR EACH ROW
    EXECUTE FUNCTION update_keystroke_sequence_updated_at();

-- Create function for efficient pattern querying
CREATE OR REPLACE FUNCTION get_user_keystroke_patterns(
    p_user_id UUID,
    p_app_name TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 10
)
RETURNS TABLE(
    id UUID,
    app_context TEXT,
    keystroke_count INTEGER,
    sequence_duration INTEGER,
    patterns JSONB,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ks.id,
        ks.app_context,
        ks.keystroke_count,
        ks.sequence_duration,
        ks.sequence_data->'patterns' as patterns,
        ks.created_at
    FROM keystroke_sequences ks
    WHERE ks.user_id = p_user_id
    AND (p_app_name IS NULL OR ks.app_context = p_app_name)
    ORDER BY ks.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Create function for efficiency analytics
CREATE OR REPLACE FUNCTION get_efficiency_summary(
    p_user_id UUID,
    p_days INTEGER DEFAULT 7
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'total_sequences', COUNT(*),
        'avg_efficiency_score', AVG((ka.analysis_data->>'efficiency_score')::float),
        'total_keystrokes', SUM(ks.keystroke_count),
        'avg_sequence_duration', AVG(ks.sequence_duration),
        'app_distribution', (
            SELECT jsonb_object_agg(app_context, app_count)
            FROM (
                SELECT app_context, COUNT(*) as app_count
                FROM keystroke_sequences
                WHERE user_id = p_user_id
                AND created_at > NOW() - INTERVAL '1 day' * p_days
                GROUP BY app_context
                ORDER BY app_count DESC
                LIMIT 10
            ) app_stats
        )
    ) INTO result
    FROM keystroke_sequences ks
    LEFT JOIN keystroke_analysis ka ON ks.id = ka.sequence_id
    WHERE ks.user_id = p_user_id
    AND ks.created_at > NOW() - INTERVAL '1 day' * p_days;

    RETURN COALESCE(result, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql;