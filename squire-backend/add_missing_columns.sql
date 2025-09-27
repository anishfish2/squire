-- Add missing ocr_event_id column to ai_suggestions table
ALTER TABLE ai_suggestions ADD COLUMN IF NOT EXISTS ocr_event_id UUID REFERENCES ocr_events(id) ON DELETE SET NULL;

-- Create index for the new column
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_ocr_event_id ON ai_suggestions(ocr_event_id);

-- Also add missing session_id column (looks like app expects it)
ALTER TABLE ai_suggestions ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES user_sessions(id) ON DELETE CASCADE;

-- Create index for session_id
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_session_id ON ai_suggestions(session_id);