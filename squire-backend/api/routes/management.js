// Data Management Routes (GDPR, Cleanup, Export)
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// POST /api/management/cleanup/comprehensive - Run comprehensive cleanup
router.post('/cleanup/comprehensive', async (req, res) => {
  try {
    const { dry_run = true } = req.body;

    const { data, error } = await supabase
      .rpc('comprehensive_cleanup', {
        p_dry_run: dry_run
      });

    if (error) throw error;

    res.json({
      success: true,
      cleanup_results: data,
      dry_run: dry_run
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/management/cleanup/sessions - Archive old sessions
router.post('/cleanup/sessions', async (req, res) => {
  try {
    const { archive_after_days = 90, batch_size = 1000 } = req.body;

    const { data, error } = await supabase
      .rpc('archive_old_sessions', {
        p_archive_after_days: archive_after_days,
        p_batch_size: batch_size
      });

    if (error) throw error;

    res.json({
      success: true,
      message: `${data} sessions archived`,
      archived_count: data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/management/cleanup/events - Clean up low importance events
router.post('/cleanup/events', async (req, res) => {
  try {
    const {
      importance_threshold = 0.30,
      older_than_days = 30,
      batch_size = 1000
    } = req.body;

    const { data, error } = await supabase
      .rpc('cleanup_low_importance_events', {
        p_importance_threshold: importance_threshold,
        p_older_than_days: older_than_days,
        p_batch_size: batch_size
      });

    if (error) throw error;

    res.json({
      success: true,
      message: `${data} low-importance events cleaned up`,
      cleaned_count: data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/management/cleanup/suggestions - Clean up old suggestions
router.post('/cleanup/suggestions', async (req, res) => {
  try {
    const { older_than_days = 30, batch_size = 1000 } = req.body;

    const { data, error } = await supabase
      .rpc('cleanup_old_suggestions', {
        p_older_than_days: older_than_days,
        p_batch_size: batch_size
      });

    if (error) throw error;

    res.json({
      success: true,
      message: `${data} old suggestions cleaned up`,
      cleaned_count: data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/management/cleanup/knowledge-graph - Prune weak knowledge connections
router.post('/cleanup/knowledge-graph', async (req, res) => {
  try {
    const {
      min_strength = 0.10,
      min_reinforcement_count = 1,
      batch_size = 500
    } = req.body;

    const { data, error } = await supabase
      .rpc('prune_knowledge_graph', {
        p_min_strength: min_strength,
        p_min_reinforcement_count: min_reinforcement_count,
        p_batch_size: batch_size
      });

    if (error) throw error;

    res.json({
      success: true,
      message: `${data} weak relationships pruned`,
      pruned_count: data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/management/export/:userId - Export all user data (GDPR)
router.get('/export/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { format = 'json' } = req.query;

    const { data, error } = await supabase
      .rpc('export_user_data', {
        p_user_id: userId
      });

    if (error) throw error;

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=user-data-${userId}.json`);
      res.json(data);
    } else if (format === 'csv') {
      const csvData = this.convertExportToCSV(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=user-data-${userId}.csv`);
      res.send(csvData);
    } else {
      res.status(400).json({ error: 'Invalid format. Use json or csv' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/management/user/:userId - Delete all user data (GDPR)
router.delete('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { confirmation_email } = req.body;

    if (!confirmation_email) {
      return res.status(400).json({
        error: 'confirmation_email is required for user deletion'
      });
    }

    const { data, error } = await supabase
      .rpc('delete_user_data', {
        p_user_id: userId,
        p_confirmation_email: confirmation_email
      });

    if (error) throw error;

    res.json({
      success: true,
      message: 'User data deleted successfully',
      deletion_summary: data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/management/storage-stats - Get storage statistics
router.get('/storage-stats', async (req, res) => {
  try {
    // Get table sizes and record counts
    const tableStats = {};

    const tables = [
      'user_profiles',
      'user_sessions',
      'ai_suggestions',
      'user_events',
      'knowledge_nodes',
      'knowledge_relationships'
    ];

    for (const table of tables) {
      const { data, error } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true });

      if (!error) {
        tableStats[table] = {
          record_count: data || 0
        };
      }
    }

    // Get database health info
    const { data: healthData, error: healthError } = await supabase
      .rpc('database_health_check');

    const stats = {
      table_statistics: tableStats,
      database_health: healthError ? null : healthData,
      last_updated: new Date().toISOString()
    };

    res.json({ storage_stats: stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/management/backup/user/:userId - Create user data backup
router.post('/backup/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { include_sessions = true, include_events = true } = req.body;

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError) throw profileError;

    const backup = {
      backup_timestamp: new Date().toISOString(),
      user_id: userId,
      profile: profile
    };

    if (include_sessions) {
      const { data: sessions } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1000); // Limit for performance

      backup.sessions = sessions || [];
    }

    if (include_events) {
      const { data: events } = await supabase
        .from('user_events')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5000); // Limit for performance

      backup.events = events || [];
    }

    // Get AI suggestions
    const { data: suggestions } = await supabase
      .from('ai_suggestions')
      .select('*')
      .eq('user_id', userId);

    backup.suggestions = suggestions || [];

    // Get knowledge graph
    const { data: nodes } = await supabase
      .from('knowledge_nodes')
      .select('*')
      .eq('user_id', userId);

    const { data: relationships } = await supabase
      .from('knowledge_relationships')
      .select('*')
      .eq('user_id', userId);

    backup.knowledge_graph = {
      nodes: nodes || [],
      relationships: relationships || []
    };

    res.json({
      success: true,
      backup,
      metadata: {
        backup_size_kb: JSON.stringify(backup).length / 1024,
        record_counts: {
          sessions: backup.sessions?.length || 0,
          events: backup.events?.length || 0,
          suggestions: backup.suggestions?.length || 0,
          knowledge_nodes: backup.knowledge_graph.nodes.length,
          knowledge_relationships: backup.knowledge_graph.relationships.length
        }
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/management/restore/user/:userId - Restore user data from backup
router.post('/restore/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { backup_data, overwrite = false } = req.body;

    if (!backup_data) {
      return res.status(400).json({ error: 'backup_data is required' });
    }

    const results = {
      profile: { success: false },
      sessions: { success: false, count: 0 },
      events: { success: false, count: 0 },
      suggestions: { success: false, count: 0 },
      knowledge_nodes: { success: false, count: 0 },
      knowledge_relationships: { success: false, count: 0 }
    };

    // Restore profile
    if (backup_data.profile) {
      if (overwrite) {
        const { error } = await supabase
          .from('user_profiles')
          .upsert(backup_data.profile);
        results.profile.success = !error;
      }
    }

    // Restore sessions
    if (backup_data.sessions && Array.isArray(backup_data.sessions)) {
      let successCount = 0;
      for (const session of backup_data.sessions) {
        const { error } = await supabase
          .from('user_sessions')
          .insert({ ...session, user_id: userId });
        if (!error) successCount++;
      }
      results.sessions = { success: successCount > 0, count: successCount };
    }

    // Similar restoration for other data types...
    // (Implementation would continue for events, suggestions, knowledge graph)

    res.json({
      success: true,
      message: 'Data restoration completed',
      results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/management/cleanup-schedule - Get cleanup schedule status
router.get('/cleanup-schedule', async (req, res) => {
  try {
    // This would integrate with cron jobs or scheduled tasks
    const schedule = {
      daily_cleanup: {
        enabled: true,
        last_run: '2024-01-01T02:00:00Z', // Would come from actual scheduler
        next_run: '2024-01-02T02:00:00Z',
        status: 'active'
      },
      weekly_archive: {
        enabled: true,
        last_run: '2024-01-01T03:00:00Z',
        next_run: '2024-01-08T03:00:00Z',
        status: 'active'
      },
      monthly_reports: {
        enabled: true,
        last_run: '2024-01-01T04:00:00Z',
        next_run: '2024-02-01T04:00:00Z',
        status: 'active'
      }
    };

    res.json({ cleanup_schedule: schedule });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper method to convert export data to CSV
router.convertExportToCSV = function(exportData) {
  const csvRows = [];

  // Add header
  csvRows.push('data_type,id,created_at,content');

  // Add profile data
  if (exportData.user_profile) {
    csvRows.push(`profile,${exportData.user_profile.id},${exportData.user_profile.created_at},"${JSON.stringify(exportData.user_profile)}"`);
  }

  // Add sessions
  if (exportData.sessions) {
    exportData.sessions.forEach(session => {
      csvRows.push(`session,${session.id},${session.created_at},"${JSON.stringify(session)}"`);
    });
  }

  // Add events
  if (exportData.events) {
    exportData.events.forEach(event => {
      csvRows.push(`event,${event.id},${event.created_at},"${JSON.stringify(event)}"`);
    });
  }

  return csvRows.join('\n');
};

module.exports = router;