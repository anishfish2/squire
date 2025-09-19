// AI Suggestions Routes
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// POST /api/suggestions - Create new AI suggestion
router.post('/', async (req, res) => {
  try {
    const {
      user_id,
      session_ids,
      suggestion_type,
      suggestion_content,
      confidence_score,
      context_data = {},
      expires_hours = 168, // 7 days default
      priority = 5
    } = req.body;

    const { data, error } = await supabase
      .rpc('create_ai_suggestion', {
        p_user_id: user_id,
        p_session_ids: session_ids || [],
        p_suggestion_type: suggestion_type,
        p_suggestion_content: suggestion_content,
        p_confidence_score: confidence_score,
        p_context_data: context_data,
        p_expires_hours: expires_hours,
        p_priority: priority
      });

    if (error) throw error;

    // Get the created suggestion
    const { data: suggestion, error: suggestionError } = await supabase
      .from('ai_suggestions')
      .select('*')
      .eq('id', data)
      .single();

    if (suggestionError) throw suggestionError;

    res.status(201).json({ suggestion, suggestion_id: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/suggestions/user/:userId/active - Get active suggestions for user
router.get('/user/:userId/active', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 10 } = req.query;

    const { data, error } = await supabase
      .rpc('get_active_suggestions', {
        p_user_id: userId,
        p_limit: parseInt(limit)
      });

    if (error) throw error;

    res.json({ suggestions: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/suggestions/:id - Get specific suggestion
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('ai_suggestions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Suggestion not found' });

    res.json({ suggestion: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/suggestions/:id/status - Update suggestion status
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, feedback } = req.body;

    const { data, error } = await supabase
      .rpc('update_suggestion_status', {
        p_suggestion_id: id,
        p_new_status: status,
        p_feedback: feedback || null
      });

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Suggestion not found' });

    res.json({ success: true, message: 'Status updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/suggestions/user/:userId - Get all suggestions for user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      status,
      suggestion_type,
      limit = 50,
      offset = 0,
      order_by = 'created_at',
      order_direction = 'desc'
    } = req.query;

    let query = supabase
      .from('ai_suggestions')
      .select('*')
      .eq('user_id', userId);

    if (status) {
      query = query.eq('status', status);
    }

    if (suggestion_type) {
      query = query.eq('suggestion_type', suggestion_type);
    }

    query = query
      .order(order_by, { ascending: order_direction === 'asc' })
      .range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) throw error;

    res.json({ suggestions: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/suggestions/:id - Update suggestion
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      suggestion_content,
      confidence_score,
      context_data,
      expires_at,
      priority,
      metadata
    } = req.body;

    const updateData = {};
    if (suggestion_content !== undefined) updateData.suggestion_content = suggestion_content;
    if (confidence_score !== undefined) updateData.confidence_score = confidence_score;
    if (context_data !== undefined) updateData.context_data = context_data;
    if (expires_at !== undefined) updateData.expires_at = expires_at;
    if (priority !== undefined) updateData.priority = priority;
    if (metadata !== undefined) updateData.metadata = metadata;

    const { data, error } = await supabase
      .from('ai_suggestions')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Suggestion not found' });

    res.json({ suggestion: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/suggestions/:id - Delete suggestion
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('ai_suggestions')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Suggestion not found' });

    res.json({ success: true, message: 'Suggestion deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/suggestions/cleanup - Cleanup expired suggestions
router.post('/cleanup', async (req, res) => {
  try {
    const { data, error } = await supabase
      .rpc('cleanup_expired_suggestions');

    if (error) throw error;

    res.json({
      success: true,
      message: `${data} suggestions cleaned up`,
      cleaned_count: data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/suggestions/analytics/:userId - Get suggestion analytics
router.get('/analytics/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { days = 30 } = req.query;

    const { data, error } = await supabase
      .from('ai_suggestions')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());

    if (error) throw error;

    const analytics = {
      total: data.length,
      by_status: data.reduce((acc, s) => {
        acc[s.status] = (acc[s.status] || 0) + 1;
        return acc;
      }, {}),
      by_type: data.reduce((acc, s) => {
        acc[s.suggestion_type] = (acc[s.suggestion_type] || 0) + 1;
        return acc;
      }, {}),
      avg_confidence: data.length ?
        data.reduce((sum, s) => sum + (s.confidence_score || 0), 0) / data.length : 0,
      response_rate: data.length ?
        data.filter(s => s.status !== 'pending').length / data.length : 0
    };

    res.json({ analytics });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;