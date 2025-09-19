-- Create knowledge_relationships table
CREATE TABLE IF NOT EXISTS knowledge_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    source_node_id UUID NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    target_node_id UUID NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL CHECK (relationship_type IN ('depends_on', 'leads_to', 'conflicts_with', 'similar_to', 'part_of', 'triggers', 'reinforces', 'replaces', 'enables')),
    strength NUMERIC(3,2) DEFAULT 0.50 CHECK (strength >= 0.00 AND strength <= 1.00),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    last_reinforced TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    reinforcement_count INTEGER DEFAULT 1,
    metadata JSONB DEFAULT '{}' NOT NULL,

    -- Prevent self-relationships
    CONSTRAINT no_self_relationship CHECK (source_node_id != target_node_id),
    -- Unique relationship per type between nodes
    CONSTRAINT unique_relationship UNIQUE (source_node_id, target_node_id, relationship_type)
);

-- Create indexes for performance
CREATE INDEX idx_knowledge_relationships_source ON knowledge_relationships(source_node_id);
CREATE INDEX idx_knowledge_relationships_target ON knowledge_relationships(target_node_id);
CREATE INDEX idx_knowledge_relationships_user_type ON knowledge_relationships(user_id, relationship_type);
CREATE INDEX idx_knowledge_relationships_strength ON knowledge_relationships(strength DESC);
CREATE INDEX idx_knowledge_relationships_user_nodes ON knowledge_relationships(user_id, source_node_id, target_node_id);

-- Enable Row Level Security
ALTER TABLE knowledge_relationships ENABLE ROW LEVEL SECURITY;

-- Create RLS policy (temporary for dummy user testing)
CREATE POLICY "Users can access own knowledge relationships" ON knowledge_relationships
    FOR ALL USING (true);

-- Create function for creating/updating relationships
CREATE OR REPLACE FUNCTION upsert_knowledge_relationship(
    p_user_id UUID,
    p_source_node_id UUID,
    p_target_node_id UUID,
    p_relationship_type TEXT,
    p_strength NUMERIC DEFAULT 0.50,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    existing_relationship_id UUID;
    new_relationship_id UUID;
BEGIN
    -- Validate that both nodes belong to the user
    IF NOT EXISTS (
        SELECT 1 FROM knowledge_nodes
        WHERE id = p_source_node_id AND user_id = p_user_id
    ) OR NOT EXISTS (
        SELECT 1 FROM knowledge_nodes
        WHERE id = p_target_node_id AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'Both nodes must belong to the specified user';
    END IF;

    -- Check if relationship already exists
    SELECT id INTO existing_relationship_id
    FROM knowledge_relationships
    WHERE source_node_id = p_source_node_id
        AND target_node_id = p_target_node_id
        AND relationship_type = p_relationship_type;

    IF existing_relationship_id IS NOT NULL THEN
        -- Update existing relationship (strengthen it)
        UPDATE knowledge_relationships
        SET
            strength = LEAST(strength + (p_strength * 0.1), 1.00), -- Increase strength but cap at 1.0
            last_reinforced = NOW(),
            reinforcement_count = reinforcement_count + 1,
            metadata = metadata || p_metadata
        WHERE id = existing_relationship_id;

        RETURN existing_relationship_id;
    ELSE
        -- Create new relationship
        INSERT INTO knowledge_relationships (
            user_id,
            source_node_id,
            target_node_id,
            relationship_type,
            strength,
            metadata
        )
        VALUES (
            p_user_id,
            p_source_node_id,
            p_target_node_id,
            p_relationship_type,
            p_strength,
            p_metadata
        )
        RETURNING id INTO new_relationship_id;

        RETURN new_relationship_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function for traversing the knowledge graph
CREATE OR REPLACE FUNCTION traverse_knowledge_graph(
    p_user_id UUID,
    p_start_node_id UUID,
    p_relationship_types TEXT[] DEFAULT NULL,
    p_max_depth INTEGER DEFAULT 3,
    p_min_strength NUMERIC DEFAULT 0.30
)
RETURNS TABLE (
    node_id UUID,
    node_type TEXT,
    content JSONB,
    relationship_type TEXT,
    strength NUMERIC,
    depth INTEGER,
    path UUID[]
) AS $$
WITH RECURSIVE graph_traversal AS (
    -- Base case: start node
    SELECT
        kn.id as node_id,
        kn.node_type,
        kn.content,
        NULL::TEXT as relationship_type,
        1.0::NUMERIC as strength,
        0 as depth,
        ARRAY[kn.id] as path
    FROM knowledge_nodes kn
    WHERE kn.id = p_start_node_id AND kn.user_id = p_user_id

    UNION ALL

    -- Recursive case: follow relationships
    SELECT
        kn.id as node_id,
        kn.node_type,
        kn.content,
        kr.relationship_type,
        kr.strength,
        gt.depth + 1,
        gt.path || kn.id
    FROM graph_traversal gt
    JOIN knowledge_relationships kr ON kr.source_node_id = ANY(gt.path)
    JOIN knowledge_nodes kn ON kn.id = kr.target_node_id
    WHERE gt.depth < p_max_depth
        AND kr.user_id = p_user_id
        AND kr.strength >= p_min_strength
        AND (p_relationship_types IS NULL OR kr.relationship_type = ANY(p_relationship_types))
        AND NOT (kn.id = ANY(gt.path)) -- Prevent cycles
)
SELECT * FROM graph_traversal ORDER BY depth, strength DESC;
$$ LANGUAGE sql SECURITY DEFINER;

-- Create function for finding connection paths between nodes
CREATE OR REPLACE FUNCTION find_connection_path(
    p_user_id UUID,
    p_start_node_id UUID,
    p_end_node_id UUID,
    p_max_depth INTEGER DEFAULT 5
)
RETURNS TABLE (
    path_length INTEGER,
    node_path UUID[],
    relationship_path TEXT[],
    total_strength NUMERIC
) AS $$
WITH RECURSIVE path_search AS (
    -- Base case
    SELECT
        1 as path_length,
        ARRAY[p_start_node_id] as node_path,
        ARRAY[]::TEXT[] as relationship_path,
        1.0::NUMERIC as total_strength,
        p_start_node_id as current_node
    WHERE p_start_node_id = p_end_node_id

    UNION ALL

    -- Recursive case
    SELECT
        ps.path_length + 1,
        ps.node_path || kr.target_node_id,
        ps.relationship_path || kr.relationship_type,
        ps.total_strength * kr.strength,
        kr.target_node_id
    FROM path_search ps
    JOIN knowledge_relationships kr ON kr.source_node_id = ps.current_node
    WHERE ps.path_length < p_max_depth
        AND kr.user_id = p_user_id
        AND NOT (kr.target_node_id = ANY(ps.node_path)) -- Prevent cycles
        AND kr.target_node_id = p_end_node_id
)
SELECT path_length, node_path, relationship_path, total_strength
FROM path_search
WHERE current_node = p_end_node_id
ORDER BY path_length, total_strength DESC
LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;