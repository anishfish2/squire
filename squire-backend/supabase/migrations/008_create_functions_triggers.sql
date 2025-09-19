-- Advanced database functions and triggers

-- Function for automatic knowledge graph updates from session data
CREATE OR REPLACE FUNCTION extract_knowledge_from_session()
RETURNS TRIGGER AS $$
DECLARE
    ocr_text TEXT;
    app_name TEXT;
    pattern_data JSONB;
BEGIN
    -- Extract knowledge from OCR logs
    IF array_length(NEW.ocr_logs, 1) > 0 THEN
        -- Create knowledge nodes for frequently recognized text
        FOR ocr_text IN
            SELECT DISTINCT jsonb_extract_path_text(log, 'text')
            FROM unnest(NEW.ocr_logs) AS log
            WHERE jsonb_extract_path_text(log, 'confidence')::NUMERIC > 0.8
        LOOP
            IF LENGTH(ocr_text) > 3 AND LENGTH(ocr_text) < 100 THEN
                PERFORM upsert_knowledge_node(
                    NEW.user_id,
                    'concept',
                    jsonb_build_object('text', ocr_text, 'source', 'ocr'),
                    0.3,
                    ARRAY[]::UUID[],
                    jsonb_build_object('extracted_from', 'session_ocr')
                );
            END IF;
        END LOOP;
    END IF;

    -- Extract app usage patterns
    IF NEW.app_usage ? 'app_name' THEN
        app_name := NEW.app_usage->>'app_name';
        PERFORM upsert_knowledge_node(
            NEW.user_id,
            'tool',
            jsonb_build_object('name', app_name, 'usage_duration', NEW.app_usage->'duration'),
            0.5,
            ARRAY[]::UUID[],
            jsonb_build_object('extracted_from', 'app_usage', 'session_id', NEW.id)
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for knowledge extraction from sessions
CREATE TRIGGER trigger_extract_knowledge_from_session
    AFTER UPDATE OF ocr_logs, app_usage ON user_sessions
    FOR EACH ROW
    EXECUTE FUNCTION extract_knowledge_from_session();

-- Function for automatic AI suggestion cleanup
CREATE OR REPLACE FUNCTION auto_cleanup_suggestions()
RETURNS TRIGGER AS $$
BEGIN
    -- Mark suggestions as expired if they've been pending too long
    UPDATE ai_suggestions
    SET status = 'expired'
    WHERE user_id = NEW.user_id
        AND status = 'pending'
        AND created_at < NOW() - INTERVAL '7 days'
        AND expires_at IS NULL;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for suggestion cleanup on user activity
CREATE TRIGGER trigger_auto_cleanup_suggestions
    AFTER INSERT ON user_sessions
    FOR EACH ROW
    EXECUTE FUNCTION auto_cleanup_suggestions();

-- Function for maintaining knowledge node weights
CREATE OR REPLACE FUNCTION update_node_weights()
RETURNS TRIGGER AS $$
DECLARE
    related_nodes UUID[];
    node_id UUID;
BEGIN
    -- Increase weight of nodes related to new events
    IF NEW.event_type IN ('success', 'preference', 'habit') THEN
        -- Find related knowledge nodes based on event content
        SELECT ARRAY_AGG(kn.id) INTO related_nodes
        FROM knowledge_nodes kn
        WHERE kn.user_id = NEW.user_id
            AND kn.content::TEXT ILIKE '%' || (NEW.event_data->>'keyword') || '%'
        LIMIT 5;

        -- Update weights of related nodes
        IF related_nodes IS NOT NULL THEN
            FOREACH node_id IN ARRAY related_nodes
            LOOP
                UPDATE knowledge_nodes
                SET weight = LEAST(weight + 0.1, 10.0),
                    last_updated = NOW()
                WHERE id = node_id;
            END LOOP;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updating node weights based on events
CREATE TRIGGER trigger_update_node_weights
    AFTER INSERT ON user_events
    FOR EACH ROW
    EXECUTE FUNCTION update_node_weights();

-- Function for session analytics and insights
CREATE OR REPLACE FUNCTION generate_session_insights(
    p_user_id UUID,
    p_session_id UUID
)
RETURNS JSONB AS $$
DECLARE
    session_duration INTERVAL;
    click_count INTEGER;
    ocr_count INTEGER;
    most_used_app TEXT;
    insights JSONB;
BEGIN
    -- Calculate session metrics
    SELECT
        COALESCE(session_end, NOW()) - session_start,
        array_length(clicks, 1),
        array_length(ocr_logs, 1),
        app_usage->>'app_name'
    INTO session_duration, click_count, ocr_count, most_used_app
    FROM user_sessions
    WHERE id = p_session_id AND user_id = p_user_id;

    -- Build insights object
    insights := jsonb_build_object(
        'duration_minutes', EXTRACT(EPOCH FROM session_duration) / 60,
        'click_count', COALESCE(click_count, 0),
        'ocr_count', COALESCE(ocr_count, 0),
        'most_used_app', most_used_app,
        'productivity_score', CASE
            WHEN EXTRACT(EPOCH FROM session_duration) > 3600 AND click_count > 100 THEN 'high'
            WHEN EXTRACT(EPOCH FROM session_duration) > 1800 AND click_count > 50 THEN 'medium'
            ELSE 'low'
        END
    );

    RETURN insights;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for batch processing events into knowledge graph
CREATE OR REPLACE FUNCTION process_events_to_knowledge(
    p_user_id UUID,
    p_batch_size INTEGER DEFAULT 100
)
RETURNS INTEGER AS $$
DECLARE
    processed_count INTEGER := 0;
    event_record RECORD;
BEGIN
    -- Process unprocessed events
    FOR event_record IN
        SELECT id, event_type, event_data, importance_score
        FROM user_events
        WHERE user_id = p_user_id
            AND NOT (metadata ? 'processed_to_knowledge')
        ORDER BY importance_score DESC, created_at DESC
        LIMIT p_batch_size
    LOOP
        -- Create knowledge nodes based on event type
        CASE event_record.event_type
            WHEN 'habit' THEN
                PERFORM upsert_knowledge_node(
                    p_user_id,
                    'habit',
                    event_record.event_data,
                    event_record.importance_score * 2,
                    ARRAY[event_record.id],
                    jsonb_build_object('source', 'event_processing')
                );
            WHEN 'preference' THEN
                PERFORM upsert_knowledge_node(
                    p_user_id,
                    'preference',
                    event_record.event_data,
                    event_record.importance_score * 1.5,
                    ARRAY[event_record.id],
                    jsonb_build_object('source', 'event_processing')
                );
            WHEN 'skill' THEN
                PERFORM upsert_knowledge_node(
                    p_user_id,
                    'skill',
                    event_record.event_data,
                    event_record.importance_score * 2,
                    ARRAY[event_record.id],
                    jsonb_build_object('source', 'event_processing')
                );
            ELSE
                -- Generic processing for other event types
                PERFORM upsert_knowledge_node(
                    p_user_id,
                    'pattern',
                    event_record.event_data,
                    event_record.importance_score,
                    ARRAY[event_record.id],
                    jsonb_build_object('source', 'event_processing', 'event_type', event_record.event_type)
                );
        END CASE;

        -- Mark event as processed
        UPDATE user_events
        SET metadata = metadata || jsonb_build_object('processed_to_knowledge', true, 'processed_at', NOW())
        WHERE id = event_record.id;

        processed_count := processed_count + 1;
    END LOOP;

    RETURN processed_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for health check and maintenance
CREATE OR REPLACE FUNCTION database_health_check()
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    table_stats JSONB;
BEGIN
    -- Collect table statistics
    SELECT jsonb_object_agg(table_name, row_count) INTO table_stats
    FROM (
        SELECT 'user_profiles' as table_name, COUNT(*) as row_count FROM user_profiles
        UNION ALL
        SELECT 'user_sessions', COUNT(*) FROM user_sessions
        UNION ALL
        SELECT 'ai_suggestions', COUNT(*) FROM ai_suggestions
        UNION ALL
        SELECT 'user_events', COUNT(*) FROM user_events
        UNION ALL
        SELECT 'knowledge_nodes', COUNT(*) FROM knowledge_nodes
        UNION ALL
        SELECT 'knowledge_relationships', COUNT(*) FROM knowledge_relationships
    ) stats;

    result := jsonb_build_object(
        'timestamp', NOW(),
        'table_counts', table_stats,
        'active_sessions', (SELECT COUNT(*) FROM user_sessions WHERE session_end IS NULL),
        'pending_suggestions', (SELECT COUNT(*) FROM ai_suggestions WHERE status = 'pending'),
        'high_importance_events', (SELECT COUNT(*) FROM user_events WHERE importance_score > 0.7),
        'database_size_mb', (SELECT pg_size_pretty(pg_database_size(current_database())))
    );

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;