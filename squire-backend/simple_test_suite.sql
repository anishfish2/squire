-- Simple Test Suite for Supabase SQL Editor
-- This version works without RAISE NOTICE statements

-- Test 1: Create user profile
SELECT 'TEST 1: Creating user profile' as test_step;
SELECT create_user_profile(
    'test@example.com',
    'Test User',
    'https://example.com/avatar.png',
    'America/New_York'
) as user_id;

-- Get the user ID for subsequent tests
WITH test_user AS (
    SELECT id as user_id FROM user_profiles WHERE email = 'test@example.com' LIMIT 1
)
-- Test 2: Start session
SELECT 'TEST 2: Starting session' as test_step;

-- Start session (we'll use a fixed user ID for simplicity)
SELECT start_user_session(
    (SELECT id FROM user_profiles WHERE email = 'test@example.com' LIMIT 1),
    jsonb_build_object('browser', 'Chrome', 'os', 'macOS'),
    'active'
) as session_id;

-- Test 3: Add session events
SELECT 'TEST 3: Adding session events' as test_step;

SELECT add_session_event(
    (SELECT id FROM user_sessions ORDER BY created_at DESC LIMIT 1),
    'ocr',
    jsonb_build_object('text', 'Hello World', 'confidence', 0.95)
) as event_added;

-- Test 4: Create AI suggestion
SELECT 'TEST 4: Creating AI suggestion' as test_step;

SELECT create_ai_suggestion(
    (SELECT id FROM user_profiles WHERE email = 'test@example.com' LIMIT 1),
    ARRAY[(SELECT id FROM user_sessions ORDER BY created_at DESC LIMIT 1)],
    'productivity',
    jsonb_build_object('title', 'Use shortcuts', 'description', 'Save time with Cmd+S'),
    0.85,
    jsonb_build_object('pattern', 'clicks'),
    24,
    8
) as suggestion_id;

-- Test 5: Create user event
SELECT 'TEST 5: Creating user event' as test_step;

SELECT add_user_event(
    (SELECT id FROM user_profiles WHERE email = 'test@example.com' LIMIT 1),
    'habit',
    jsonb_build_object('action', 'frequent_saving', 'frequency', 'high'),
    0.8,
    ARRAY['productivity'],
    (SELECT id FROM user_sessions ORDER BY created_at DESC LIMIT 1),
    NULL
) as event_id;

-- Test 6: Create knowledge node
SELECT 'TEST 6: Creating knowledge node' as test_step;

SELECT upsert_knowledge_node(
    (SELECT id FROM user_profiles WHERE email = 'test@example.com' LIMIT 1),
    'habit',
    jsonb_build_object('name', 'saving_habit', 'strength', 'strong'),
    2.0,
    ARRAY[]::UUID[],
    jsonb_build_object('source', 'test')
) as node_id;

-- Test 7: Verify data was created
SELECT 'TEST 7: Data verification' as test_step;

SELECT 'user_profiles' as table_name, COUNT(*) as records FROM user_profiles
UNION ALL
SELECT 'user_sessions', COUNT(*) FROM user_sessions
UNION ALL
SELECT 'ai_suggestions', COUNT(*) FROM ai_suggestions
UNION ALL
SELECT 'user_events', COUNT(*) FROM user_events
UNION ALL
SELECT 'knowledge_nodes', COUNT(*) FROM knowledge_nodes;

-- Test 8: Test key functions
SELECT 'TEST 8: Testing functions' as test_step;

SELECT * FROM get_active_suggestions(
    (SELECT id FROM user_profiles WHERE email = 'test@example.com' LIMIT 1),
    5
);

-- Test 9: Database health check
SELECT 'TEST 9: Health check' as test_step;
SELECT database_health_check() as health_status;

-- Final verification
SELECT 'ALL TESTS COMPLETED - Check results above' as final_message;

-- Show created data
SELECT 'Created test data:' as summary;
SELECT
    up.email,
    COUNT(DISTINCT us.id) as sessions,
    COUNT(DISTINCT ais.id) as suggestions,
    COUNT(DISTINCT ue.id) as events,
    COUNT(DISTINCT kn.id) as knowledge_nodes
FROM user_profiles up
LEFT JOIN user_sessions us ON up.id = us.user_id
LEFT JOIN ai_suggestions ais ON up.id = ais.user_id
LEFT JOIN user_events ue ON up.id = ue.user_id
LEFT JOIN knowledge_nodes kn ON up.id = kn.user_id
WHERE up.email = 'test@example.com'
GROUP BY up.email;