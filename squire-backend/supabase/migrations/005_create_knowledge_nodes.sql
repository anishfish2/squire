-- Enable pgvector extension for embeddings (optional - comment out if not using)
-- CREATE EXTENSION IF NOT EXISTS vector;

-- Create knowledge_nodes table
CREATE TABLE IF NOT EXISTS knowledge_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    node_type TEXT NOT NULL CHECK (node_type IN ('concept', 'habit', 'preference', 'skill', 'tool', 'workflow', 'goal', 'pattern', 'context')),
    content JSONB NOT NULL,
    weight NUMERIC(4,3) DEFAULT 1.000 CHECK (weight >= 0.000 AND weight <= 10.000),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    -- embeddings VECTOR(1536), -- Uncomment if using pgvector with OpenAI embeddings
    source_events UUID[] DEFAULT '{}', -- References to user_events that created this node
    access_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}' NOT NULL
);

-- Create trigger for last_updated timestamp
CREATE TRIGGER update_knowledge_nodes_last_updated
    BEFORE UPDATE ON knowledge_nodes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_knowledge_nodes_user_id ON knowledge_nodes(user_id);
CREATE INDEX idx_knowledge_nodes_user_type_weight ON knowledge_nodes(user_id, node_type, weight DESC);
CREATE INDEX idx_knowledge_nodes_last_updated ON knowledge_nodes(last_updated DESC);
CREATE INDEX idx_knowledge_nodes_access_count ON knowledge_nodes(access_count DESC);
CREATE INDEX idx_knowledge_nodes_content_gin ON knowledge_nodes USING GIN(content);
CREATE INDEX idx_knowledge_nodes_source_events_gin ON knowledge_nodes USING GIN(source_events);

-- Create vector index if using embeddings (uncomment if using pgvector)
-- CREATE INDEX idx_knowledge_nodes_embeddings ON knowledge_nodes USING ivfflat (embeddings vector_cosine_ops);

-- Enable Row Level Security
ALTER TABLE knowledge_nodes ENABLE ROW LEVEL SECURITY;

-- Create RLS policy (temporary for dummy user testing)
CREATE POLICY "Users can access own knowledge nodes" ON knowledge_nodes
    FOR ALL USING (true);

-- Create function for creating/updating knowledge nodes
CREATE OR REPLACE FUNCTION upsert_knowledge_node(
    p_user_id UUID,
    p_node_type TEXT,
    p_content JSONB,
    p_weight NUMERIC DEFAULT 1.000,
    p_source_event_ids UUID[] DEFAULT '{}',
    p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    existing_node_id UUID;
    new_node_id UUID;
    content_hash TEXT;
BEGIN
    -- Create a simple hash of the content to detect similar nodes
    content_hash := MD5(p_content::TEXT);

    -- Check if similar node already exists
    SELECT id INTO existing_node_id
    FROM knowledge_nodes
    WHERE user_id = p_user_id
        AND node_type = p_node_type
        AND MD5(content::TEXT) = content_hash
    LIMIT 1;

    IF existing_node_id IS NOT NULL THEN
        -- Update existing node
        UPDATE knowledge_nodes
        SET
            weight = LEAST(weight + (p_weight * 0.1), 10.000), -- Increase weight but cap at 10
            last_updated = NOW(),
            source_events = array_cat(source_events, p_source_event_ids),
            access_count = access_count + 1,
            metadata = metadata || p_metadata
        WHERE id = existing_node_id;

        RETURN existing_node_id;
    ELSE
        -- Create new node
        INSERT INTO knowledge_nodes (
            user_id,
            node_type,
            content,
            weight,
            source_events,
            metadata
        )
        VALUES (
            p_user_id,
            p_node_type,
            p_content,
            p_weight,
            p_source_event_ids,
            p_metadata
        )
        RETURNING id INTO new_node_id;

        RETURN new_node_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function for finding similar nodes
CREATE OR REPLACE FUNCTION find_similar_nodes(
    p_user_id UUID,
    p_node_type TEXT DEFAULT NULL,
    p_content_search TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    node_type TEXT,
    content JSONB,
    weight NUMERIC,
    similarity_score NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        n.id,
        n.node_type,
        n.content,
        n.weight,
        -- Simple text similarity score (can be replaced with vector similarity)
        CASE
            WHEN p_content_search IS NOT NULL THEN
                CASE
                    WHEN n.content::TEXT ILIKE '%' || p_content_search || '%' THEN 0.8
                    ELSE 0.1
                END
            ELSE 1.0
        END as similarity_score
    FROM knowledge_nodes n
    WHERE n.user_id = p_user_id
        AND (p_node_type IS NULL OR n.node_type = p_node_type)
        AND (p_content_search IS NULL OR n.content::TEXT ILIKE '%' || p_content_search || '%')
    ORDER BY n.weight DESC, similarity_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;