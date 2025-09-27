-- Create ocr_events table
CREATE TABLE IF NOT EXISTS ocr_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    app_name TEXT NOT NULL,
    window_title TEXT,
    ocr_text TEXT[] DEFAULT '{}',
    context_data JSONB DEFAULT '{}' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Create trigger for updated_at timestamp
CREATE TRIGGER update_ocr_events_updated_at
    BEFORE UPDATE ON ocr_events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_ocr_events_session_id ON ocr_events(session_id);
CREATE INDEX idx_ocr_events_app_name ON ocr_events(app_name);
CREATE INDEX idx_ocr_events_created_at ON ocr_events(created_at DESC);
CREATE INDEX idx_ocr_events_session_app ON ocr_events(session_id, app_name);

-- Create GIN index for JSONB context_data
CREATE INDEX idx_ocr_events_context_data_gin ON ocr_events USING GIN(context_data);

-- Create GIN index for text array ocr_text
CREATE INDEX idx_ocr_events_ocr_text_gin ON ocr_events USING GIN(ocr_text);

-- Enable Row Level Security
ALTER TABLE ocr_events ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for user isolation (via session)
CREATE POLICY "Users can access own ocr events" ON ocr_events
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_sessions us
            WHERE us.id = ocr_events.session_id
            AND us.user_id::TEXT = auth.jwt() ->> 'sub'
        )
    );

-- Temporary policy for dummy user testing
DROP POLICY IF EXISTS "Users can access own ocr events" ON ocr_events;
CREATE POLICY "Users can access own ocr events" ON ocr_events
    FOR ALL USING (true);

-- Create function for OCR event analysis
CREATE OR REPLACE FUNCTION get_recent_ocr_patterns(
    p_session_id UUID,
    p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
    app_name TEXT,
    pattern_count INTEGER,
    recent_content TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        oe.app_name,
        COUNT(*)::INTEGER as pattern_count,
        ARRAY_AGG(DISTINCT array_to_string(oe.ocr_text, ' ')) as recent_content
    FROM ocr_events oe
    WHERE oe.session_id = p_session_id
    GROUP BY oe.app_name
    ORDER BY pattern_count DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;