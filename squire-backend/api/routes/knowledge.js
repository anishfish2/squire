// Knowledge Graph Routes
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// POST /api/knowledge/nodes - Create/update knowledge node
router.post('/nodes', async (req, res) => {
  try {
    const {
      user_id,
      node_type,
      content,
      weight = 1.0,
      source_event_ids = [],
      metadata = {}
    } = req.body;

    const { data, error } = await supabase
      .rpc('upsert_knowledge_node', {
        p_user_id: user_id,
        p_node_type: node_type,
        p_content: content,
        p_weight: weight,
        p_source_event_ids: source_event_ids,
        p_metadata: metadata
      });

    if (error) throw error;

    // Get the created/updated node
    const { data: node, error: nodeError } = await supabase
      .from('knowledge_nodes')
      .select('*')
      .eq('id', data)
      .single();

    if (nodeError) throw nodeError;

    res.status(201).json({ node, node_id: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/knowledge/nodes/user/:userId - Get all nodes for user
router.get('/nodes/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      node_type,
      min_weight,
      limit = 100,
      offset = 0,
      order_by = 'weight',
      order_direction = 'desc'
    } = req.query;

    let query = supabase
      .from('knowledge_nodes')
      .select('*')
      .eq('user_id', userId);

    if (node_type) {
      query = query.eq('node_type', node_type);
    }

    if (min_weight) {
      query = query.gte('weight', parseFloat(min_weight));
    }

    query = query
      .order(order_by, { ascending: order_direction === 'asc' })
      .range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) throw error;

    res.json({ nodes: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/knowledge/nodes/:id - Get specific node
router.get('/nodes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('knowledge_nodes')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Node not found' });

    res.json({ node: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/knowledge/nodes/:id - Update node
router.put('/nodes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { content, weight, metadata } = req.body;

    const updateData = {};
    if (content !== undefined) updateData.content = content;
    if (weight !== undefined) updateData.weight = weight;
    if (metadata !== undefined) updateData.metadata = metadata;

    const { data, error } = await supabase
      .from('knowledge_nodes')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Node not found' });

    res.json({ node: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/knowledge/nodes/:id - Delete node
router.delete('/nodes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('knowledge_nodes')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Node not found' });

    res.json({ success: true, message: 'Node deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/knowledge/relationships - Create/update relationship
router.post('/relationships', async (req, res) => {
  try {
    const {
      user_id,
      source_node_id,
      target_node_id,
      relationship_type,
      strength = 0.5,
      metadata = {}
    } = req.body;

    const { data, error } = await supabase
      .rpc('upsert_knowledge_relationship', {
        p_user_id: user_id,
        p_source_node_id: source_node_id,
        p_target_node_id: target_node_id,
        p_relationship_type: relationship_type,
        p_strength: strength,
        p_metadata: metadata
      });

    if (error) throw error;

    // Get the created/updated relationship
    const { data: relationship, error: relError } = await supabase
      .from('knowledge_relationships')
      .select('*')
      .eq('id', data)
      .single();

    if (relError) throw relError;

    res.status(201).json({ relationship, relationship_id: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/knowledge/relationships/user/:userId - Get all relationships for user
router.get('/relationships/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      relationship_type,
      min_strength,
      source_node_id,
      target_node_id,
      limit = 100,
      offset = 0
    } = req.query;

    let query = supabase
      .from('knowledge_relationships')
      .select(`
        *,
        source_node:knowledge_nodes!source_node_id(*),
        target_node:knowledge_nodes!target_node_id(*)
      `)
      .eq('user_id', userId);

    if (relationship_type) {
      query = query.eq('relationship_type', relationship_type);
    }

    if (min_strength) {
      query = query.gte('strength', parseFloat(min_strength));
    }

    if (source_node_id) {
      query = query.eq('source_node_id', source_node_id);
    }

    if (target_node_id) {
      query = query.eq('target_node_id', target_node_id);
    }

    query = query
      .order('strength', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) throw error;

    res.json({ relationships: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/knowledge/traverse/:userId/:nodeId - Traverse knowledge graph
router.get('/traverse/:userId/:nodeId', async (req, res) => {
  try {
    const { userId, nodeId } = req.params;
    const {
      relationship_types,
      max_depth = 3,
      min_strength = 0.3
    } = req.query;

    const relationshipTypesArray = relationship_types ?
      relationship_types.split(',') : null;

    const { data, error } = await supabase
      .rpc('traverse_knowledge_graph', {
        p_user_id: userId,
        p_start_node_id: nodeId,
        p_relationship_types: relationshipTypesArray,
        p_max_depth: parseInt(max_depth),
        p_min_strength: parseFloat(min_strength)
      });

    if (error) throw error;

    res.json({ graph: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/knowledge/path/:userId/:sourceId/:targetId - Find connection path
router.get('/path/:userId/:sourceId/:targetId', async (req, res) => {
  try {
    const { userId, sourceId, targetId } = req.params;
    const { max_depth = 5 } = req.query;

    const { data, error } = await supabase
      .rpc('find_connection_path', {
        p_user_id: userId,
        p_start_node_id: sourceId,
        p_end_node_id: targetId,
        p_max_depth: parseInt(max_depth)
      });

    if (error) throw error;

    res.json({ path: data || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/knowledge/similar/:userId - Find similar nodes
router.get('/similar/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      node_type,
      content_search,
      limit = 10
    } = req.query;

    const { data, error } = await supabase
      .rpc('find_similar_nodes', {
        p_user_id: userId,
        p_node_type: node_type,
        p_content_search: content_search,
        p_limit: parseInt(limit)
      });

    if (error) throw error;

    res.json({ similar_nodes: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/knowledge/analytics/:userId - Get knowledge graph analytics
router.get('/analytics/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Get nodes
    const { data: nodes, error: nodesError } = await supabase
      .from('knowledge_nodes')
      .select('*')
      .eq('user_id', userId);

    if (nodesError) throw nodesError;

    // Get relationships
    const { data: relationships, error: relsError } = await supabase
      .from('knowledge_relationships')
      .select('*')
      .eq('user_id', userId);

    if (relsError) throw relsError;

    const analytics = {
      nodes: {
        total: nodes.length,
        by_type: nodes.reduce((acc, n) => {
          acc[n.node_type] = (acc[n.node_type] || 0) + 1;
          return acc;
        }, {}),
        avg_weight: nodes.length ?
          nodes.reduce((sum, n) => sum + n.weight, 0) / nodes.length : 0,
        top_nodes: nodes
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 10)
          .map(n => ({ id: n.id, weight: n.weight, type: n.node_type }))
      },
      relationships: {
        total: relationships.length,
        by_type: relationships.reduce((acc, r) => {
          acc[r.relationship_type] = (acc[r.relationship_type] || 0) + 1;
          return acc;
        }, {}),
        avg_strength: relationships.length ?
          relationships.reduce((sum, r) => sum + r.strength, 0) / relationships.length : 0,
        strongest: relationships
          .sort((a, b) => b.strength - a.strength)
          .slice(0, 10)
          .map(r => ({
            id: r.id,
            strength: r.strength,
            type: r.relationship_type,
            source: r.source_node_id,
            target: r.target_node_id
          }))
      },
      connectivity: {
        density: nodes.length > 1 ?
          relationships.length / (nodes.length * (nodes.length - 1)) : 0,
        isolated_nodes: nodes.filter(n =>
          !relationships.some(r =>
            r.source_node_id === n.id || r.target_node_id === n.id
          )
        ).length
      }
    };

    res.json({ analytics });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/knowledge/export/:userId - Export knowledge graph
router.get('/export/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { format = 'json' } = req.query;

    // Get all nodes and relationships
    const { data: nodes, error: nodesError } = await supabase
      .from('knowledge_nodes')
      .select('*')
      .eq('user_id', userId);

    if (nodesError) throw nodesError;

    const { data: relationships, error: relsError } = await supabase
      .from('knowledge_relationships')
      .select('*')
      .eq('user_id', userId);

    if (relsError) throw relsError;

    const exportData = {
      export_timestamp: new Date().toISOString(),
      user_id: userId,
      nodes: nodes || [],
      relationships: relationships || [],
      metadata: {
        total_nodes: nodes?.length || 0,
        total_relationships: relationships?.length || 0,
        node_types: [...new Set(nodes?.map(n => n.node_type) || [])],
        relationship_types: [...new Set(relationships?.map(r => r.relationship_type) || [])]
      }
    };

    if (format === 'cypher') {
      // Convert to Cypher queries for Neo4j import
      const cypherQueries = [];

      // Create nodes
      nodes?.forEach(node => {
        const props = JSON.stringify({
          id: node.id,
          weight: node.weight,
          content: node.content,
          created_at: node.created_at
        });
        cypherQueries.push(`CREATE (n:${node.node_type} ${props})`);
      });

      // Create relationships
      relationships?.forEach(rel => {
        cypherQueries.push(
          `MATCH (a {id: "${rel.source_node_id}"}), (b {id: "${rel.target_node_id}"}) ` +
          `CREATE (a)-[:${rel.relationship_type.toUpperCase()} {strength: ${rel.strength}}]->(b)`
        );
      });

      res.json({ cypher_queries: cypherQueries });
    } else {
      res.json(exportData);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;