-- Fix event_type constraint to match application values
ALTER TABLE user_events DROP CONSTRAINT user_events_event_type_check;
ALTER TABLE user_events ADD CONSTRAINT user_events_event_type_check
    CHECK (event_type IN (
        'interaction', 'preference', 'pattern', 'habit', 'skill', 'goal', 'workflow', 'error', 'success',
        'app_switch', 'ocr_capture', 'suggestion_click', 'session_start', 'session_end', 'error_occurred'
    ));