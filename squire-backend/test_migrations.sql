-- Test script for Phase 2 migrations
-- Run this after applying the migrations to verify everything works

-- Test 1: Create a dummy user profile
DO $$
DECLARE
    test_user_id UUID;
    test_session_id UUID;
    test_suggestion_id UUID;
BEGIN
    -- Create test user profile
    SELECT create_user_profile(
        'test@example.com',
        'Test User',
        'https://example.com/avatar.png',
        'America/New_York'
    ) INTO test_user_id;

    RAISE NOTICE 'Created test user with ID: %', test_user_id;

    -- Test 2: Start a user session
    SELECT start_user_session(
        test_user_id,
        '{"browser": "Chrome", "os": "macOS", "screen_resolution": "1920x1080"}',
        'active'
    ) INTO test_session_id;

    RAISE NOTICE 'Created test session with ID: %', test_session_id;

    -- Test 3: Add some session events
    PERFORM add_session_event(
        test_session_id,
        'ocr',
        '{"text": "Hello World", "confidence": 0.95, "timestamp": "' || NOW() || '"}'
    );

    PERFORM add_session_event(
        test_session_id,
        'click',
        '{"x": 100, "y": 200, "button": "left", "timestamp": "' || NOW() || '"}'
    );

    PERFORM add_session_event(
        test_session_id,
        'mouse_movement',
        '{"x": 150, "y": 250, "timestamp": "' || NOW() || '"}'
    );

    RAISE NOTICE 'Added session events to session: %', test_session_id;

    -- Test 4: Create an AI suggestion
    SELECT create_ai_suggestion(
        test_user_id,
        ARRAY[test_session_id],
        'productivity',
        '{"title": "Try keyboard shortcuts", "description": "You could save time by using Cmd+C instead of right-clicking to copy", "action": "learn_shortcuts"}',
        0.85,
        '{"detected_pattern": "frequent_right_click_copy", "sessions_analyzed": 1}',
        24, -- expires in 24 hours
        8   -- high priority
    ) INTO test_suggestion_id;

    RAISE NOTICE 'Created test suggestion with ID: %', test_suggestion_id;

    -- Test 5: Update suggestion status
    PERFORM update_suggestion_status(
        test_suggestion_id,
        'viewed',
        '{"viewed_at": "' || NOW() || '", "user_agent": "test"}'
    );

    RAISE NOTICE 'Updated suggestion status to viewed';

    -- Test 6: Get active suggestions
    RAISE NOTICE 'Active suggestions for user:';
    FOR rec IN SELECT * FROM get_active_suggestions(test_user_id, 5)
    LOOP
        RAISE NOTICE 'Suggestion: % - Type: % - Priority: %', rec.id, rec.suggestion_type, rec.priority;
    END LOOP;

    -- Test 7: End the session
    PERFORM end_user_session(test_session_id);
    RAISE NOTICE 'Ended test session';

END $$;

-- Verify data was created correctly
SELECT 'User Profiles Count' as table_name, COUNT(*) as record_count FROM user_profiles
UNION ALL
SELECT 'User Sessions Count', COUNT(*) FROM user_sessions
UNION ALL
SELECT 'AI Suggestions Count', COUNT(*) FROM ai_suggestions;

-- Check if indexes were created
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename IN ('user_profiles', 'user_sessions', 'ai_suggestions')
ORDER BY tablename, indexname;

-- Check if RLS is enabled
SELECT
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE tablename IN ('user_profiles', 'user_sessions', 'ai_suggestions');

-- Check if functions were created
SELECT
    routine_name,
    routine_type
FROM information_schema.routines
WHERE routine_name IN (
    'create_user_profile',
    'start_user_session',
    'end_user_session',
    'add_session_event',
    'create_ai_suggestion',
    'update_suggestion_status',
    'get_active_suggestions',
    'cleanup_expired_suggestions'
)
ORDER BY routine_name;