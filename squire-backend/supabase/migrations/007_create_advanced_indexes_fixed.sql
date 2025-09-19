-- Advanced indexing strategy for optimal performance (Fixed for immutability)

-- Partial indexes for active sessions
CREATE INDEX idx_user_sessions_active_partial ON user_sessions(user_id, session_start DESC)
    WHERE session_end IS NULL;

-- Partial indexes for pending suggestions
CREATE INDEX idx_ai_suggestions_pending_partial ON ai_suggestions(user_id, priority DESC, created_at DESC)
    WHERE status = 'pending';

-- Partial indexes for active suggestions (simplified to avoid NOW() immutability issue)
CREATE INDEX idx_ai_suggestions_active_partial ON ai_suggestions(user_id, confidence_score DESC)
    WHERE status IN ('pending', 'viewed');

-- Composite indexes for common query patterns
CREATE INDEX idx_sessions_user_type_time ON user_sessions(user_id, session_type, session_start DESC);
CREATE INDEX idx_events_user_importance_time ON user_events(user_id, importance_score DESC, created_at DESC);
CREATE INDEX idx_nodes_user_weight_type ON knowledge_nodes(user_id, weight DESC, node_type);

-- Covering indexes to avoid table lookups for common queries
CREATE INDEX idx_user_sessions_covering ON user_sessions(user_id, session_start DESC)
    INCLUDE (id, session_type, created_at);

CREATE INDEX idx_ai_suggestions_covering ON ai_suggestions(user_id, status, created_at DESC)
    INCLUDE (id, suggestion_type, priority, confidence_score);

CREATE INDEX idx_knowledge_nodes_covering ON knowledge_nodes(user_id, node_type, weight DESC)
    INCLUDE (id, created_at, last_updated);

-- Text search indexes for content search
CREATE INDEX idx_knowledge_nodes_content_text ON knowledge_nodes
    USING GIN(to_tsvector('english', content::TEXT));

CREATE INDEX idx_ai_suggestions_content_text ON ai_suggestions
    USING GIN(to_tsvector('english', suggestion_content::TEXT));

-- Indexes for analytics and reporting
CREATE INDEX idx_user_sessions_analytics ON user_sessions(created_at, session_type)
    WHERE session_end IS NOT NULL;

CREATE INDEX idx_user_events_analytics ON user_events(created_at, event_type, importance_score);

CREATE INDEX idx_ai_suggestions_analytics ON ai_suggestions(created_at, status, suggestion_type, confidence_score);

-- Hash indexes for exact equality lookups (PostgreSQL 10+)
CREATE INDEX idx_user_profiles_email_hash ON user_profiles USING HASH(email);
CREATE INDEX idx_user_sessions_session_type_hash ON user_sessions USING HASH(session_type);

-- Conditional unique indexes
CREATE UNIQUE INDEX idx_user_profiles_email_active ON user_profiles(email)
    WHERE email IS NOT NULL;

-- Multi-column GIN indexes for complex JSONB queries
CREATE INDEX idx_session_complex_gin ON user_sessions
    USING GIN((session_data || app_usage || device_info));

-- Indexes for knowledge graph traversal optimization
CREATE INDEX idx_relationships_bidirectional ON knowledge_relationships(target_node_id, source_node_id, relationship_type, strength);

-- Time-based partitioning preparation indexes
CREATE INDEX idx_user_sessions_time_partition ON user_sessions(created_at, user_id);
CREATE INDEX idx_user_events_time_partition ON user_events(created_at, user_id);

-- Indexes to support efficient cleanup operations
CREATE INDEX idx_user_sessions_cleanup ON user_sessions(session_end) WHERE session_end IS NOT NULL;
CREATE INDEX idx_user_events_cleanup ON user_events(created_at, importance_score);
CREATE INDEX idx_ai_suggestions_cleanup ON ai_suggestions(created_at, status);
CREATE INDEX idx_knowledge_relationships_cleanup ON knowledge_relationships(last_reinforced, strength, reinforcement_count);

-- Statistics and maintenance
-- Update table statistics for better query planning
ANALYZE user_profiles;
ANALYZE user_sessions;
ANALYZE ai_suggestions;
ANALYZE user_events;
ANALYZE knowledge_nodes;
ANALYZE knowledge_relationships;