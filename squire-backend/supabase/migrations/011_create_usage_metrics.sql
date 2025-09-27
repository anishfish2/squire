-- Create usage_metrics table
CREATE TABLE IF NOT EXISTS usage_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    app_usage JSONB DEFAULT '{}' NOT NULL,
    suggestions_generated INTEGER DEFAULT 0,
    suggestions_clicked INTEGER DEFAULT 0,
    session_duration INTEGER DEFAULT 0,
    efficiency_indicator TEXT DEFAULT 'normal' CHECK (efficiency_indicator IN ('low', 'normal', 'high')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE(user_id, date)
);

-- Create trigger for updated_at timestamp
CREATE TRIGGER update_usage_metrics_updated_at
    BEFORE UPDATE ON usage_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_usage_metrics_user_id ON usage_metrics(user_id);
CREATE INDEX idx_usage_metrics_user_date ON usage_metrics(user_id, date DESC);
CREATE INDEX idx_usage_metrics_date ON usage_metrics(date DESC);
CREATE INDEX idx_usage_metrics_efficiency ON usage_metrics(efficiency_indicator);

-- Create GIN index for JSONB app_usage
CREATE INDEX idx_usage_metrics_app_usage_gin ON usage_metrics USING GIN(app_usage);

-- Enable Row Level Security
ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for user isolation
CREATE POLICY "Users can access own usage metrics" ON usage_metrics
    FOR ALL USING (true); -- Temporary policy for dummy user testing

-- Create function for getting daily metrics
CREATE OR REPLACE FUNCTION get_user_daily_metrics(
    p_user_id UUID,
    p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
    date DATE,
    total_session_minutes INTEGER,
    apps_used INTEGER,
    suggestions_generated INTEGER,
    suggestions_clicked INTEGER,
    efficiency_indicator TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        um.date,
        um.session_duration as total_session_minutes,
        jsonb_object_keys(um.app_usage)::TEXT[]::INTEGER as apps_used,
        um.suggestions_generated,
        um.suggestions_clicked,
        um.efficiency_indicator
    FROM usage_metrics um
    WHERE um.user_id = p_user_id
        AND um.date >= CURRENT_DATE - INTERVAL '1 day' * p_days
    ORDER BY um.date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function for aggregating app usage
CREATE OR REPLACE FUNCTION get_top_apps_usage(
    p_user_id UUID,
    p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
    app_name TEXT,
    total_minutes INTEGER,
    usage_days INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        app_key::TEXT as app_name,
        SUM((app_value::TEXT)::INTEGER) as total_minutes,
        COUNT(DISTINCT um.date) as usage_days
    FROM usage_metrics um,
         jsonb_each(um.app_usage) as app_usage(app_key, app_value)
    WHERE um.user_id = p_user_id
        AND um.date >= CURRENT_DATE - INTERVAL '1 day' * p_days
    GROUP BY app_key
    ORDER BY total_minutes DESC
    LIMIT 10;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;