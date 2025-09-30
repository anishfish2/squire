-- Add job management fields to ocr_events table
ALTER TABLE ocr_events
ADD COLUMN IF NOT EXISTS job_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS job_priority TEXT DEFAULT 'normal',
ADD COLUMN IF NOT EXISTS processing_worker_id TEXT,
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS bundle_id TEXT,
ADD COLUMN IF NOT EXISTS application_type TEXT,
ADD COLUMN IF NOT EXISTS interaction_context TEXT DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS extracted_entities JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS image_data_size INTEGER,
ADD COLUMN IF NOT EXISTS meaningful_context TEXT;

-- Create indexes for job management
CREATE INDEX IF NOT EXISTS idx_ocr_events_job_status ON ocr_events(job_status);
CREATE INDEX IF NOT EXISTS idx_ocr_events_job_priority ON ocr_events(job_priority);
CREATE INDEX IF NOT EXISTS idx_ocr_events_started_at ON ocr_events(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ocr_events_completed_at ON ocr_events(completed_at DESC);
