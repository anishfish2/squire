// User Profile Routes
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// GET /api/profiles/:id - Get user profile
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Profile not found' });

    res.json({ profile: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/profiles - Create user profile
router.post('/', async (req, res) => {
  try {
    const { email, full_name, avatar_url, timezone } = req.body;

    const { data, error } = await supabase
      .rpc('create_user_profile', {
        p_email: email,
        p_full_name: full_name,
        p_avatar_url: avatar_url,
        p_timezone: timezone || 'UTC'
      });

    if (error) throw error;

    // Get the created profile
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', data)
      .single();

    if (profileError) throw profileError;

    res.status(201).json({ profile, id: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/profiles/:id - Update user profile
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, avatar_url, preferences, metadata, timezone, settings } = req.body;

    const updateData = {};
    if (full_name !== undefined) updateData.full_name = full_name;
    if (avatar_url !== undefined) updateData.avatar_url = avatar_url;
    if (preferences !== undefined) updateData.preferences = preferences;
    if (metadata !== undefined) updateData.metadata = metadata;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (settings !== undefined) updateData.settings = settings;

    const { data, error } = await supabase
      .from('user_profiles')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Profile not found' });

    res.json({ profile: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/profiles/:id/stats - Get user statistics
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;

    // Get comprehensive user stats
    const { data: sessions } = await supabase
      .from('user_sessions')
      .select('id, created_at, session_end')
      .eq('user_id', id);

    const { data: suggestions } = await supabase
      .from('ai_suggestions')
      .select('id, status, confidence_score')
      .eq('user_id', id);

    const { data: events } = await supabase
      .from('user_events')
      .select('id, event_type, importance_score')
      .eq('user_id', id);

    const { data: nodes } = await supabase
      .from('knowledge_nodes')
      .select('id, node_type, weight')
      .eq('user_id', id);

    const stats = {
      sessions: {
        total: sessions?.length || 0,
        active: sessions?.filter(s => !s.session_end).length || 0
      },
      suggestions: {
        total: suggestions?.length || 0,
        pending: suggestions?.filter(s => s.status === 'pending').length || 0,
        avg_confidence: suggestions?.length ?
          suggestions.reduce((sum, s) => sum + (s.confidence_score || 0), 0) / suggestions.length : 0
      },
      events: {
        total: events?.length || 0,
        high_importance: events?.filter(e => e.importance_score > 0.7).length || 0
      },
      knowledge: {
        total_nodes: nodes?.length || 0,
        by_type: nodes?.reduce((acc, n) => {
          acc[n.node_type] = (acc[n.node_type] || 0) + 1;
          return acc;
        }, {}) || {}
      }
    };

    res.json({ stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;