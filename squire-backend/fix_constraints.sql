-- Fix session_type constraint to match application values
ALTER TABLE user_sessions DROP CONSTRAINT user_sessions_session_type_check;
ALTER TABLE user_sessions ADD CONSTRAINT user_sessions_session_type_check
    CHECK (session_type IN ('productivity', 'development', 'research', 'general', 'active', 'background', 'idle', 'closed'));

-- Also create the missing tables if not already done
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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_usage_metrics_user_id ON usage_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_ocr_events_session_id ON ocr_events(session_id);

-- Enable RLS and create policies
ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can access own usage metrics" ON usage_metrics;
CREATE POLICY "Users can access own usage metrics" ON usage_metrics FOR ALL USING (true);

DROP POLICY IF EXISTS "Users can access own ocr events" ON ocr_events;
CREATE POLICY "Users can access own ocr events" ON ocr_events FOR ALL USING (true);