// Session Management Routes
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// POST /api/sessions/start - Start a new session
router.post('/start', async (req, res) => {
  try {
    const { user_id, device_info, session_type = 'active' } = req.body;

    const { data, error } = await supabase
      .rpc('start_user_session', {
        p_user_id: user_id,
        p_device_info: device_info || {},
        p_session_type: session_type
      });

    if (error) throw error;

    // Get the created session
    const { data: session, error: sessionError } = await supabase
      .from('user_sessions')
      .select('*')
      .eq('id', data)
      .single();

    if (sessionError) throw sessionError;

    res.status(201).json({ session, session_id: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/sessions/:id/end - End a session
router.put('/:id/end', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .rpc('end_user_session', {
        p_session_id: id
      });

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Session not found or already ended' });

    res.json({ success: true, message: 'Session ended successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/events - Add events to a session
router.post('/:id/events', async (req, res) => {
  try {
    const { id } = req.params;
    const { event_type, event_data } = req.body;

    const { data, error } = await supabase
      .rpc('add_session_event', {
        p_session_id: id,
        p_event_type: event_type,
        p_event_data: event_data
      });

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Session not found' });

    res.json({ success: true, message: 'Event added successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/events/bulk - Add multiple events at once
router.post('/:id/events/bulk', async (req, res) => {
  try {
    const { id } = req.params;
    const { events } = req.body; // Array of {event_type, event_data}

    const results = [];
    for (const event of events) {
      const { data, error } = await supabase
        .rpc('add_session_event', {
          p_session_id: id,
          p_event_type: event.event_type,
          p_event_data: event.event_data
        });

      if (error) {
        results.push({ success: false, error: error.message, event });
      } else {
        results.push({ success: true, event });
      }
    }

    res.json({ results, total: events.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/:id - Get session details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('user_sessions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Session not found' });

    res.json({ session: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/user/:userId - Get all sessions for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, offset = 0, active_only = false } = req.query;

    let query = supabase
      .from('user_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (active_only === 'true') {
      query = query.is('session_end', null);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({ sessions: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/:id/insights - Get session insights
router.get('/:id/insights', async (req, res) => {
  try {
    const { id } = req.params;

    // First verify session exists and get user_id
    const { data: session, error: sessionError } = await supabase
      .from('user_sessions')
      .select('user_id')
      .eq('id', id)
      .single();

    if (sessionError) throw sessionError;
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { data, error } = await supabase
      .rpc('generate_session_insights', {
        p_user_id: session.user_id,
        p_session_id: id
      });

    if (error) throw error;

    res.json({ insights: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/user/:userId/active - Get active sessions for user
router.get('/user/:userId/active', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('user_sessions')
      .select('*')
      .eq('user_id', userId)
      .is('session_end', null)
      .order('session_start', { ascending: false });

    if (error) throw error;

    res.json({ active_sessions: data || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/sessions/:id - Update session data
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { session_data, app_usage, session_type } = req.body;

    const updateData = {};
    if (session_data !== undefined) updateData.session_data = session_data;
    if (app_usage !== undefined) updateData.app_usage = app_usage;
    if (session_type !== undefined) updateData.session_type = session_type;

    const { data, error } = await supabase
      .from('user_sessions')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Session not found' });

    res.json({ session: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;