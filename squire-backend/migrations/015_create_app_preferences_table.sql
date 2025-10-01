-- Migration 015: Create user_app_preferences table
-- This table stores per-user, per-app preferences for OCR and Vision capture

CREATE TABLE IF NOT EXISTS user_app_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    app_name TEXT NOT NULL,
    bundle_id TEXT, -- Optional: for more precise app identification

    -- Feature toggles
    allow_ocr BOOLEAN DEFAULT true,
    allow_vision BOOLEAN DEFAULT false,
    allow_screenshots BOOLEAN DEFAULT false,

    -- Frequency controls
    ocr_frequency TEXT DEFAULT 'normal', -- 'low', 'normal', 'high'
    vision_frequency TEXT DEFAULT 'low', -- 'low', 'normal', 'high'

    -- Privacy settings
    mask_sensitive_content BOOLEAN DEFAULT false,
    screenshot_retention_days INTEGER DEFAULT 30,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_capture_at TIMESTAMP WITH TIME ZONE,

    -- Constraints
    UNIQUE(user_id, app_name),
    CHECK (ocr_frequency IN ('low', 'normal', 'high')),
    CHECK (vision_frequency IN ('low', 'normal', 'high')),
    CHECK (screenshot_retention_days > 0 AND screenshot_retention_days <= 365)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_app_preferences_user_id ON user_app_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_app_preferences_app_name ON user_app_preferences(app_name);
CREATE INDEX IF NOT EXISTS idx_user_app_preferences_allow_vision ON user_app_preferences(allow_vision) WHERE allow_vision = true;

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_user_app_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_app_preferences_updated_at
    BEFORE UPDATE ON user_app_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_user_app_preferences_updated_at();

-- Insert default preferences for common apps (all users will start with OCR enabled, vision disabled)
COMMENT ON TABLE user_app_preferences IS 'Stores per-user, per-app preferences for OCR and Vision capture';
COMMENT ON COLUMN user_app_preferences.allow_ocr IS 'Whether to perform OCR on this app';
COMMENT ON COLUMN user_app_preferences.allow_vision IS 'Whether to perform vision analysis on this app';
COMMENT ON COLUMN user_app_preferences.allow_screenshots IS 'Whether to store full screenshots for this app';
COMMENT ON COLUMN user_app_preferences.mask_sensitive_content IS 'Whether to blur/mask sensitive areas before storage';
COMMENT ON COLUMN user_app_preferences.screenshot_retention_days IS 'Number of days to retain screenshots before auto-deletion';
