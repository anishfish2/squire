-- Comprehensive Test Suite for All Database Migrations
-- Run this after applying all migrations (001-010) to verify everything works

-- Test Data Setup
DO $$
DECLARE
    test_user_id UUID;
    test_session_id UUID;
    test_suggestion_id UUID;
    test_event_id UUID;
    test_node_id UUID;
    test_node_id_2 UUID;
    test_relationship_id UUID;
    test_results JSONB := '{}';
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'STARTING COMPREHENSIVE TEST SUITE';
    RAISE NOTICE '========================================';

    -- TEST 1: User Profile Management
    RAISE NOTICE 'TEST 1: Creating user profile...';
    SELECT create_user_profile(
        'comprehensive.test@example.com',
        'Comprehensive Test User',
        'https://example.com/avatar.png',
        'America/Los_Angeles'
    ) INTO test_user_id;

    ASSERT test_user_id IS NOT NULL, 'User profile creation failed';
    RAISE NOTICE '✓ User profile created: %', test_user_id;

    -- TEST 2: Session Management
    RAISE NOTICE 'TEST 2: Starting user session...';
    SELECT start_user_session(
        test_user_id,
        '{"browser": "Chrome", "os": "macOS", "version": "120.0", "screen": "2560x1440"}',
        'active'
    ) INTO test_session_id;

    ASSERT test_session_id IS NOT NULL, 'Session creation failed';
    RAISE NOTICE '✓ Session started: %', test_session_id;

    -- TEST 3: Session Events
    RAISE NOTICE 'TEST 3: Adding session events...';

    -- Add OCR events
    PERFORM add_session_event(
        test_session_id,
        'ocr',
        jsonb_build_object('text', 'Hello World Document', 'confidence', 0.95, 'timestamp', NOW(), 'language', 'en')
    );

    PERFORM add_session_event(
        test_session_id,
        'ocr',
        jsonb_build_object('text', 'Important Meeting Notes', 'confidence', 0.92, 'timestamp', NOW(), 'language', 'en')
    );

    -- Add clicks
    PERFORM add_session_event(
        test_session_id,
        'click',
        jsonb_build_object('x', 150, 'y', 300, 'button', 'left', 'timestamp', NOW(), 'target', 'save-button')
    );

    -- Add mouse movements
    PERFORM add_session_event(
        test_session_id,
        'mouse_movement',
        jsonb_build_object('x', 200, 'y', 350, 'timestamp', NOW(), 'velocity', 150)
    );

    RAISE NOTICE '✓ Session events added successfully';

    -- TEST 4: AI Suggestions
    RAISE NOTICE 'TEST 4: Creating AI suggestions...';
    SELECT create_ai_suggestion(
        test_user_id,
        ARRAY[test_session_id],
        'productivity',
        jsonb_build_object(
            'title', 'Use keyboard shortcuts',
            'description', 'Based on your clicking patterns, you could save time with Cmd+S',
            'action', 'learn_shortcuts',
            'estimated_time_saved', '2 minutes per hour'
        ),
        0.87,
        jsonb_build_object(
            'detected_pattern', 'frequent_save_clicks',
            'sessions_analyzed', 1,
            'confidence_factors', '["high_click_frequency", "repetitive_actions"]'
        ),
        48, -- expires in 48 hours
        9   -- high priority
    ) INTO test_suggestion_id;

    ASSERT test_suggestion_id IS NOT NULL, 'AI suggestion creation failed';
    RAISE NOTICE '✓ AI suggestion created: %', test_suggestion_id;

    -- Update suggestion status
    PERFORM update_suggestion_status(
        test_suggestion_id,
        'viewed',
        jsonb_build_object('viewed_at', NOW(), 'device', 'desktop', 'interaction_time', 5)
    );
    RAISE NOTICE '✓ Suggestion status updated to viewed';

    -- TEST 5: User Events
    RAISE NOTICE 'TEST 5: Creating user events...';
    SELECT add_user_event(
        test_user_id,
        'habit',
        jsonb_build_object(
            'action', 'saves_frequently',
            'frequency', 'every_2_minutes',
            'tool', 'text_editor',
            'pattern_strength', 'strong'
        ),
        0.8,
        ARRAY['productivity', 'habits', 'text_editing'],
        test_session_id,
        test_suggestion_id
    ) INTO test_event_id;

    ASSERT test_event_id IS NOT NULL, 'User event creation failed';
    RAISE NOTICE '✓ User event created: %', test_event_id;

    -- TEST 6: Knowledge Nodes
    RAISE NOTICE 'TEST 6: Creating knowledge nodes...';
    SELECT upsert_knowledge_node(
        test_user_id,
        'habit',
        jsonb_build_object(
            'name', 'frequent_saving',
            'description', 'User saves documents every 2 minutes',
            'strength', 'strong',
            'context', 'text_editing'
        ),
        2.5,
        ARRAY[test_event_id],
        jsonb_build_object('source', 'behavior_analysis', 'confidence', 0.85)
    ) INTO test_node_id;

    ASSERT test_node_id IS NOT NULL, 'Knowledge node creation failed';
    RAISE NOTICE '✓ Knowledge node created: %', test_node_id;

    -- Create a second node for relationship testing
    SELECT upsert_knowledge_node(
        test_user_id,
        'tool',
        jsonb_build_object(
            'name', 'text_editor',
            'usage_frequency', 'daily',
            'proficiency', 'intermediate',
            'features_used', '["save", "copy", "paste"]'
        ),
        2.0,
        ARRAY[]::UUID[],
        jsonb_build_object('source', 'app_usage_analysis')
    ) INTO test_node_id_2;

    ASSERT test_node_id_2 IS NOT NULL, 'Second knowledge node creation failed';
    RAISE NOTICE '✓ Second knowledge node created: %', test_node_id_2;

    -- TEST 7: Knowledge Relationships
    RAISE NOTICE 'TEST 7: Creating knowledge relationships...';
    SELECT upsert_knowledge_relationship(
        test_user_id,
        test_node_id,
        test_node_id_2,
        'triggers',
        0.75,
        jsonb_build_object(
            'description', 'frequent saving habit is triggered by text editor usage',
            'strength_source', 'behavioral_correlation'
        )
    ) INTO test_relationship_id;

    ASSERT test_relationship_id IS NOT NULL, 'Knowledge relationship creation failed';
    RAISE NOTICE '✓ Knowledge relationship created: %', test_relationship_id;

    -- TEST 8: Knowledge Graph Traversal
    RAISE NOTICE 'TEST 8: Testing knowledge graph traversal...';
    PERFORM traverse_knowledge_graph(test_user_id, test_node_id, NULL, 2, 0.5);
    RAISE NOTICE '✓ Knowledge graph traversal completed';

    -- TEST 9: Session Insights
    RAISE NOTICE 'TEST 9: Generating session insights...';
    SELECT generate_session_insights(test_user_id, test_session_id) INTO test_results;
    RAISE NOTICE '✓ Session insights generated: %', test_results;

    -- TEST 10: End Session
    RAISE NOTICE 'TEST 10: Ending session...';
    PERFORM end_user_session(test_session_id);
    RAISE NOTICE '✓ Session ended successfully';

    -- TEST 11: Active Suggestions Query
    RAISE NOTICE 'TEST 11: Querying active suggestions...';
    PERFORM get_active_suggestions(test_user_id, 10);
    RAISE NOTICE '✓ Active suggestions query completed';

    -- TEST 12: Similar Nodes Search
    RAISE NOTICE 'TEST 12: Finding similar nodes...';
    PERFORM find_similar_nodes(test_user_id, 'habit', 'saving', 5);
    RAISE NOTICE '✓ Similar nodes search completed';

    -- TEST 13: Knowledge Processing
    RAISE NOTICE 'TEST 13: Processing events to knowledge...';
    PERFORM process_events_to_knowledge(test_user_id, 50);
    RAISE NOTICE '✓ Events processed to knowledge graph';

    -- TEST 14: Database Health Check
    RAISE NOTICE 'TEST 14: Running database health check...';
    SELECT database_health_check() INTO test_results;
    RAISE NOTICE '✓ Database health check completed: %', test_results;

    -- TEST 15: Data Export (GDPR)
    RAISE NOTICE 'TEST 15: Testing data export...';
    SELECT export_user_data(test_user_id) INTO test_results;
    RAISE NOTICE '✓ User data export completed (% KB)', LENGTH(test_results::TEXT) / 1024;

    -- TEST 16: Cleanup Functions (Dry Run)
    RAISE NOTICE 'TEST 16: Testing cleanup functions...';
    SELECT comprehensive_cleanup(true) INTO test_results;
    RAISE NOTICE '✓ Cleanup dry run completed: %', test_results;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'ALL TESTS PASSED SUCCESSFULLY!';
    RAISE NOTICE '========================================';

EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '========================================';
        RAISE NOTICE 'TEST FAILED: %', SQLERRM;
        RAISE NOTICE '========================================';
        RAISE;
END $$;

-- Verification Queries
RAISE NOTICE 'Running verification queries...';

-- Check table counts
SELECT 'TABLE RECORD COUNTS' as info;
SELECT 'user_profiles' as table_name, COUNT(*) as records FROM user_profiles
UNION ALL
SELECT 'user_sessions', COUNT(*) FROM user_sessions
UNION ALL
SELECT 'ai_suggestions', COUNT(*) FROM ai_suggestions
UNION ALL
SELECT 'user_events', COUNT(*) FROM user_events
UNION ALL
SELECT 'knowledge_nodes', COUNT(*) FROM knowledge_nodes
UNION ALL
SELECT 'knowledge_relationships', COUNT(*) FROM knowledge_relationships;

-- Check indexes
SELECT 'INDEX VERIFICATION' as info;
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename IN ('user_profiles', 'user_sessions', 'ai_suggestions', 'user_events', 'knowledge_nodes', 'knowledge_relationships')
    AND schemaname = 'public'
ORDER BY tablename, indexname;

-- Check RLS policies
SELECT 'RLS POLICY VERIFICATION' as info;
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Check functions
SELECT 'FUNCTION VERIFICATION' as info;
SELECT
    routine_name,
    routine_type,
    security_type
FROM information_schema.routines
WHERE routine_schema = 'public'
    AND routine_name NOT LIKE 'update_updated_at%'
ORDER BY routine_name;

-- Performance test with sample data
SELECT 'PERFORMANCE TEST' as info;
EXPLAIN (ANALYZE, BUFFERS)
SELECT
    up.email,
    COUNT(us.id) as session_count,
    COUNT(ais.id) as suggestion_count,
    AVG(ais.confidence_score) as avg_confidence
FROM user_profiles up
LEFT JOIN user_sessions us ON up.id = us.user_id
LEFT JOIN ai_suggestions ais ON up.id = ais.user_id
GROUP BY up.id, up.email;

RAISE NOTICE 'Comprehensive test suite completed successfully!';