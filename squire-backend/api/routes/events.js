// User Events Routes
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// POST /api/events - Create new user event
router.post('/', async (req, res) => {
  try {
    const {
      user_id,
      event_type,
      event_data,
      importance_score,
      tags = [],
      session_id,
      related_suggestion_id
    } = req.body;

    const { data, error } = await supabase
      .rpc('add_user_event', {
        p_user_id: user_id,
        p_event_type: event_type,
        p_event_data: event_data,
        p_importance_score: importance_score,
        p_tags: tags,
        p_session_id: session_id,
        p_related_suggestion_id: related_suggestion_id
      });

    if (error) throw error;

    // Get the created event
    const { data: event, error: eventError } = await supabase
      .from('user_events')
      .select('*')
      .eq('id', data)
      .single();

    if (eventError) throw eventError;

    res.status(201).json({ event, event_id: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/events/user/:userId - Get all events for user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      event_type,
      min_importance,
      tags,
      session_id,
      limit = 100,
      offset = 0,
      order_by = 'created_at',
      order_direction = 'desc'
    } = req.query;

    let query = supabase
      .from('user_events')
      .select('*')
      .eq('user_id', userId);

    if (event_type) {
      query = query.eq('event_type', event_type);
    }

    if (min_importance) {
      query = query.gte('importance_score', parseFloat(min_importance));
    }

    if (tags) {
      const tagArray = tags.split(',');
      query = query.overlaps('tags', tagArray);
    }

    if (session_id) {
      query = query.eq('session_id', session_id);
    }

    query = query
      .order(order_by, { ascending: order_direction === 'asc' })
      .range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) throw error;

    res.json({ events: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/events/:id - Get specific event
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('user_events')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Event not found' });

    res.json({ event: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/events/:id - Update event
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      event_data,
      importance_score,
      tags,
      metadata
    } = req.body;

    const updateData = {};
    if (event_data !== undefined) updateData.event_data = event_data;
    if (importance_score !== undefined) updateData.importance_score = importance_score;
    if (tags !== undefined) updateData.tags = tags;
    if (metadata !== undefined) updateData.metadata = metadata;

    const { data, error } = await supabase
      .from('user_events')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Event not found' });

    res.json({ event: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/events/:id - Delete event
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('user_events')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Event not found' });

    res.json({ success: true, message: 'Event deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/events/bulk - Create multiple events
router.post('/bulk', async (req, res) => {
  try {
    const { events } = req.body; // Array of event objects

    const results = [];
    for (const event of events) {
      try {
        const { data, error } = await supabase
          .rpc('add_user_event', {
            p_user_id: event.user_id,
            p_event_type: event.event_type,
            p_event_data: event.event_data,
            p_importance_score: event.importance_score,
            p_tags: event.tags || [],
            p_session_id: event.session_id,
            p_related_suggestion_id: event.related_suggestion_id
          });

        if (error) {
          results.push({ success: false, error: error.message, event });
        } else {
          results.push({ success: true, event_id: data, event });
        }
      } catch (err) {
        results.push({ success: false, error: err.message, event });
      }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({
      results,
      total: events.length,
      successful: successCount,
      failed: events.length - successCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/events/user/:userId/analytics - Get event analytics
router.get('/user/:userId/analytics', async (req, res) => {
  try {
    const { userId } = req.params;
    const { days = 30 } = req.query;

    const { data, error } = await supabase
      .from('user_events')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());

    if (error) throw error;

    const analytics = {
      total: data.length,
      by_type: data.reduce((acc, e) => {
        acc[e.event_type] = (acc[e.event_type] || 0) + 1;
        return acc;
      }, {}),
      avg_importance: data.length ?
        data.reduce((sum, e) => sum + (e.importance_score || 0), 0) / data.length : 0,
      high_importance_count: data.filter(e => e.importance_score > 0.7).length,
      tag_frequency: data.reduce((acc, e) => {
        (e.tags || []).forEach(tag => {
          acc[tag] = (acc[tag] || 0) + 1;
        });
        return acc;
      }, {}),
      daily_counts: data.reduce((acc, e) => {
        const date = new Date(e.created_at).toISOString().split('T')[0];
        acc[date] = (acc[date] || 0) + 1;
        return acc;
      }, {})
    };

    res.json({ analytics });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/events/user/:userId/patterns - Get behavioral patterns
router.get('/user/:userId/patterns', async (req, res) => {
  try {
    const { userId } = req.params;
    const { event_type, days = 30 } = req.query;

    let query = supabase
      .from('user_events')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true });

    if (event_type) {
      query = query.eq('event_type', event_type);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Analyze patterns
    const patterns = {
      frequency: {
        hourly: new Array(24).fill(0),
        daily: {},
        weekly: new Array(7).fill(0)
      },
      sequences: {},
      trends: {
        increasing: [],
        decreasing: [],
        stable: []
      }
    };

    // Calculate frequency patterns
    data.forEach(event => {
      const date = new Date(event.created_at);
      const hour = date.getHours();
      const day = date.toISOString().split('T')[0];
      const weekday = date.getDay();

      patterns.frequency.hourly[hour]++;
      patterns.frequency.daily[day] = (patterns.frequency.daily[day] || 0) + 1;
      patterns.frequency.weekly[weekday]++;
    });

    // Find common sequences (simplified)
    for (let i = 0; i < data.length - 1; i++) {
      const current = data[i].event_type;
      const next = data[i + 1].event_type;
      const sequence = `${current} → ${next}`;
      patterns.sequences[sequence] = (patterns.sequences[sequence] || 0) + 1;
    }

    res.json({ patterns });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/events/process-to-knowledge/:userId - Process events to knowledge graph
router.post('/process-to-knowledge/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { batch_size = 100 } = req.body;

    const { data, error } = await supabase
      .rpc('process_events_to_knowledge', {
        p_user_id: userId,
        p_batch_size: batch_size
      });

    if (error) throw error;

    res.json({
      success: true,
      message: `${data} events processed to knowledge graph`,
      processed_count: data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;