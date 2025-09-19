-- Data retention and cleanup policies

-- Function for archiving old session data
CREATE OR REPLACE FUNCTION archive_old_sessions(
    p_archive_after_days INTEGER DEFAULT 90,
    p_batch_size INTEGER DEFAULT 1000
)
RETURNS INTEGER AS $$
DECLARE
    archived_count INTEGER := 0;
    session_ids UUID[];
BEGIN
    -- Get old session IDs in batches
    SELECT ARRAY_AGG(id) INTO session_ids
    FROM (
        SELECT id
        FROM user_sessions
        WHERE session_end < NOW() - (p_archive_after_days || ' days')::INTERVAL
        ORDER BY session_end
        LIMIT p_batch_size
    ) old_sessions;

    IF session_ids IS NOT NULL THEN
        -- Archive to a separate table (create if doesn't exist)
        CREATE TABLE IF NOT EXISTS user_sessions_archive (
            LIKE user_sessions INCLUDING ALL
        );

        -- Move data to archive
        INSERT INTO user_sessions_archive
        SELECT * FROM user_sessions
        WHERE id = ANY(session_ids);

        -- Delete from main table
        DELETE FROM user_sessions
        WHERE id = ANY(session_ids);

        archived_count := array_length(session_ids, 1);
    END IF;

    RETURN archived_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for cleaning up low-importance events
CREATE OR REPLACE FUNCTION cleanup_low_importance_events(
    p_importance_threshold NUMERIC DEFAULT 0.30,
    p_older_than_days INTEGER DEFAULT 30,
    p_batch_size INTEGER DEFAULT 1000
)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM user_events
    WHERE id IN (
        SELECT id
        FROM user_events
        WHERE importance_score < p_importance_threshold
            AND created_at < NOW() - (p_older_than_days || ' days')::INTERVAL
        ORDER BY created_at
        LIMIT p_batch_size
    );

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for cleaning up expired suggestions
CREATE OR REPLACE FUNCTION cleanup_old_suggestions(
    p_older_than_days INTEGER DEFAULT 30,
    p_batch_size INTEGER DEFAULT 1000
)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM ai_suggestions
    WHERE id IN (
        SELECT id
        FROM ai_suggestions
        WHERE status IN ('expired', 'dismissed')
            AND created_at < NOW() - (p_older_than_days || ' days')::INTERVAL
        ORDER BY created_at
        LIMIT p_batch_size
    );

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for pruning knowledge graph (remove weak connections)
CREATE OR REPLACE FUNCTION prune_knowledge_graph(
    p_min_strength NUMERIC DEFAULT 0.10,
    p_min_reinforcement_count INTEGER DEFAULT 1,
    p_batch_size INTEGER DEFAULT 500
)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Remove weak relationships that haven't been reinforced
    DELETE FROM knowledge_relationships
    WHERE id IN (
        SELECT id
        FROM knowledge_relationships
        WHERE strength < p_min_strength
            AND reinforcement_count <= p_min_reinforcement_count
            AND last_reinforced < NOW() - INTERVAL '30 days'
        ORDER BY strength, last_reinforced
        LIMIT p_batch_size
    );

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for comprehensive data cleanup
CREATE OR REPLACE FUNCTION comprehensive_cleanup(
    p_dry_run BOOLEAN DEFAULT true
)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    sessions_archived INTEGER := 0;
    events_cleaned INTEGER := 0;
    suggestions_cleaned INTEGER := 0;
    relationships_pruned INTEGER := 0;
BEGIN
    IF NOT p_dry_run THEN
        -- Perform actual cleanup
        SELECT archive_old_sessions(90, 1000) INTO sessions_archived;
        SELECT cleanup_low_importance_events(0.30, 30, 1000) INTO events_cleaned;
        SELECT cleanup_old_suggestions(30, 1000) INTO suggestions_cleaned;
        SELECT prune_knowledge_graph(0.10, 1, 500) INTO relationships_pruned;
    ELSE
        -- Dry run - just count what would be affected
        SELECT COUNT(*) INTO sessions_archived
        FROM user_sessions
        WHERE session_end < NOW() - INTERVAL '90 days';

        SELECT COUNT(*) INTO events_cleaned
        FROM user_events
        WHERE importance_score < 0.30
            AND created_at < NOW() - INTERVAL '30 days';

        SELECT COUNT(*) INTO suggestions_cleaned
        FROM ai_suggestions
        WHERE status IN ('expired', 'dismissed')
            AND created_at < NOW() - INTERVAL '30 days';

        SELECT COUNT(*) INTO relationships_pruned
        FROM knowledge_relationships
        WHERE strength < 0.10
            AND reinforcement_count <= 1
            AND last_reinforced < NOW() - INTERVAL '30 days';
    END IF;

    result := jsonb_build_object(
        'dry_run', p_dry_run,
        'timestamp', NOW(),
        'sessions_archived', sessions_archived,
        'events_cleaned', events_cleaned,
        'suggestions_cleaned', suggestions_cleaned,
        'relationships_pruned', relationships_pruned,
        'total_affected', sessions_archived + events_cleaned + suggestions_cleaned + relationships_pruned
    );

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for user data export (GDPR compliance)
CREATE OR REPLACE FUNCTION export_user_data(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    user_data JSONB;
BEGIN
    SELECT jsonb_build_object(
        'user_profile', (
            SELECT to_jsonb(up.*)
            FROM user_profiles up
            WHERE up.id = p_user_id
        ),
        'sessions', (
            SELECT jsonb_agg(to_jsonb(us.*))
            FROM user_sessions us
            WHERE us.user_id = p_user_id
        ),
        'ai_suggestions', (
            SELECT jsonb_agg(to_jsonb(ais.*))
            FROM ai_suggestions ais
            WHERE ais.user_id = p_user_id
        ),
        'events', (
            SELECT jsonb_agg(to_jsonb(ue.*))
            FROM user_events ue
            WHERE ue.user_id = p_user_id
        ),
        'knowledge_nodes', (
            SELECT jsonb_agg(to_jsonb(kn.*))
            FROM knowledge_nodes kn
            WHERE kn.user_id = p_user_id
        ),
        'knowledge_relationships', (
            SELECT jsonb_agg(to_jsonb(kr.*))
            FROM knowledge_relationships kr
            WHERE kr.user_id = p_user_id
        ),
        'export_timestamp', NOW()
    ) INTO user_data;

    RETURN user_data;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function for complete user data deletion (GDPR compliance)
CREATE OR REPLACE FUNCTION delete_user_data(
    p_user_id UUID,
    p_confirmation_email TEXT
)
RETURNS JSONB AS $$
DECLARE
    user_email TEXT;
    deletion_summary JSONB;
    profiles_deleted INTEGER;
    sessions_deleted INTEGER;
    suggestions_deleted INTEGER;
    events_deleted INTEGER;
    nodes_deleted INTEGER;
    relationships_deleted INTEGER;
BEGIN
    -- Verify user email matches
    SELECT email INTO user_email
    FROM user_profiles
    WHERE id = p_user_id;

    IF user_email != p_confirmation_email THEN
        RAISE EXCEPTION 'Email confirmation does not match user profile';
    END IF;

    -- Delete in correct order to handle foreign key constraints
    DELETE FROM knowledge_relationships WHERE user_id = p_user_id;
    GET DIAGNOSTICS relationships_deleted = ROW_COUNT;

    DELETE FROM knowledge_nodes WHERE user_id = p_user_id;
    GET DIAGNOSTICS nodes_deleted = ROW_COUNT;

    DELETE FROM user_events WHERE user_id = p_user_id;
    GET DIAGNOSTICS events_deleted = ROW_COUNT;

    DELETE FROM ai_suggestions WHERE user_id = p_user_id;
    GET DIAGNOSTICS suggestions_deleted = ROW_COUNT;

    DELETE FROM user_sessions WHERE user_id = p_user_id;
    GET DIAGNOSTICS sessions_deleted = ROW_COUNT;

    DELETE FROM user_profiles WHERE id = p_user_id;
    GET DIAGNOSTICS profiles_deleted = ROW_COUNT;

    deletion_summary := jsonb_build_object(
        'user_id', p_user_id,
        'email', user_email,
        'deletion_timestamp', NOW(),
        'profiles_deleted', profiles_deleted,
        'sessions_deleted', sessions_deleted,
        'suggestions_deleted', suggestions_deleted,
        'events_deleted', events_deleted,
        'nodes_deleted', nodes_deleted,
        'relationships_deleted', relationships_deleted,
        'total_records_deleted', profiles_deleted + sessions_deleted + suggestions_deleted + events_deleted + nodes_deleted + relationships_deleted
    );

    RETURN deletion_summary;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create scheduled cleanup job (requires pg_cron extension)
-- Uncomment if pg_cron is available in your Supabase instance
/*
SELECT cron.schedule(
    'daily-cleanup',
    '0 2 * * *', -- Run at 2 AM daily
    'SELECT comprehensive_cleanup(false);'
);
*/

-- Create indexes to support efficient cleanup operations
CREATE INDEX IF NOT EXISTS idx_user_sessions_cleanup ON user_sessions(session_end) WHERE session_end IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_events_cleanup ON user_events(created_at, importance_score);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_cleanup ON ai_suggestions(created_at, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_relationships_cleanup ON knowledge_relationships(last_reinforced, strength, reinforcement_count);