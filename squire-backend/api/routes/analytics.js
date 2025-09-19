// Analytics and Insights Routes
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// GET /api/analytics/dashboard/:userId - Get comprehensive dashboard data
router.get('/dashboard/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { days = 30 } = req.query;

    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Get all data in parallel
    const [
      { data: sessions },
      { data: suggestions },
      { data: events },
      { data: nodes },
      { data: relationships }
    ] = await Promise.all([
      supabase.from('user_sessions').select('*').eq('user_id', userId).gte('created_at', startDate),
      supabase.from('ai_suggestions').select('*').eq('user_id', userId).gte('created_at', startDate),
      supabase.from('user_events').select('*').eq('user_id', userId).gte('created_at', startDate),
      supabase.from('knowledge_nodes').select('*').eq('user_id', userId),
      supabase.from('knowledge_relationships').select('*').eq('user_id', userId)
    ]);

    const dashboard = {
      overview: {
        total_sessions: sessions?.length || 0,
        active_sessions: sessions?.filter(s => !s.session_end).length || 0,
        total_suggestions: suggestions?.length || 0,
        pending_suggestions: suggestions?.filter(s => s.status === 'pending').length || 0,
        total_events: events?.length || 0,
        knowledge_nodes: nodes?.length || 0,
        knowledge_relationships: relationships?.length || 0
      },
      trends: {
        daily_sessions: this.getDailyCounts(sessions || [], days),
        daily_events: this.getDailyCounts(events || [], days),
        suggestion_response_rate: suggestions?.length ?
          suggestions.filter(s => s.status !== 'pending').length / suggestions.length : 0
      },
      productivity: {
        avg_session_duration: this.calculateAvgSessionDuration(sessions || []),
        most_active_hours: this.getMostActiveHours(sessions || []),
        top_event_types: this.getTopEventTypes(events || []),
        knowledge_growth: this.calculateKnowledgeGrowth(nodes || [])
      },
      ai_insights: {
        suggestion_accuracy: this.calculateSuggestionAccuracy(suggestions || []),
        top_suggestion_types: this.getTopSuggestionTypes(suggestions || []),
        confidence_distribution: this.getConfidenceDistribution(suggestions || [])
      }
    };

    res.json({ dashboard });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/session-insights/:sessionId - Get detailed session insights
router.get('/session-insights/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Get session and user info
    const { data: session, error: sessionError } = await supabase
      .from('user_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionError) throw sessionError;
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { data, error } = await supabase
      .rpc('generate_session_insights', {
        p_user_id: session.user_id,
        p_session_id: sessionId
      });

    if (error) throw error;

    // Add additional analytics
    const insights = {
      ...data,
      ocr_analysis: this.analyzeOCRData(session.ocr_logs || []),
      click_patterns: this.analyzeClickPatterns(session.clicks || []),
      mouse_patterns: this.analyzeMousePatterns(session.mouse_movements || []),
      productivity_score: this.calculateProductivityScore(session)
    };

    res.json({ insights });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/behavior-patterns/:userId - Get behavioral patterns
router.get('/behavior-patterns/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { days = 30, pattern_type } = req.query;

    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Get events for pattern analysis
    const { data: events, error } = await supabase
      .from('user_events')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', startDate)
      .order('created_at');

    if (error) throw error;

    const patterns = {
      temporal: this.analyzeTemporalPatterns(events || []),
      frequency: this.analyzeFrequencyPatterns(events || []),
      sequences: this.analyzeSequencePatterns(events || []),
      triggers: this.analyzeTriggerPatterns(events || [])
    };

    if (pattern_type && patterns[pattern_type]) {
      res.json({ patterns: { [pattern_type]: patterns[pattern_type] } });
    } else {
      res.json({ patterns });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/knowledge-insights/:userId - Get knowledge graph insights
router.get('/knowledge-insights/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const [
      { data: nodes },
      { data: relationships }
    ] = await Promise.all([
      supabase.from('knowledge_nodes').select('*').eq('user_id', userId),
      supabase.from('knowledge_relationships').select('*').eq('user_id', userId)
    ]);

    const insights = {
      graph_metrics: this.calculateGraphMetrics(nodes || [], relationships || []),
      learning_progress: this.analyzeLearningProgress(nodes || []),
      knowledge_clusters: this.identifyKnowledgeClusters(nodes || [], relationships || []),
      growth_trends: this.analyzeKnowledgeGrowth(nodes || []),
      connection_strength: this.analyzeConnectionStrength(relationships || [])
    };

    res.json({ insights });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/reports/:userId/:reportType - Generate specific reports
router.get('/reports/:userId/:reportType', async (req, res) => {
  try {
    const { userId, reportType } = req.params;
    const { startDate, endDate, format = 'json' } = req.query;

    let report;
    switch (reportType) {
      case 'productivity':
        report = await this.generateProductivityReport(userId, startDate, endDate);
        break;
      case 'learning':
        report = await this.generateLearningReport(userId, startDate, endDate);
        break;
      case 'usage':
        report = await this.generateUsageReport(userId, startDate, endDate);
        break;
      case 'ai-performance':
        report = await this.generateAIPerformanceReport(userId, startDate, endDate);
        break;
      default:
        return res.status(400).json({ error: 'Invalid report type' });
    }

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${reportType}-report.csv`);
      res.send(this.convertToCSV(report));
    } else {
      res.json({ report });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/health-check - Database health check
router.get('/health-check', async (req, res) => {
  try {
    const { data, error } = await supabase
      .rpc('database_health_check');

    if (error) throw error;

    res.json({ health: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper methods (would typically be in a separate utility file)
router.getDailyCounts = function(items, days) {
  const counts = {};
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    counts[date] = 0;
  }

  items.forEach(item => {
    const date = new Date(item.created_at).toISOString().split('T')[0];
    if (counts.hasOwnProperty(date)) {
      counts[date]++;
    }
  });

  return counts;
};

router.calculateAvgSessionDuration = function(sessions) {
  const completedSessions = sessions.filter(s => s.session_end);
  if (completedSessions.length === 0) return 0;

  const totalDuration = completedSessions.reduce((sum, s) => {
    const duration = new Date(s.session_end) - new Date(s.session_start);
    return sum + duration;
  }, 0);

  return totalDuration / completedSessions.length / (1000 * 60); // Return in minutes
};

router.getMostActiveHours = function(sessions) {
  const hourCounts = new Array(24).fill(0);
  sessions.forEach(session => {
    const hour = new Date(session.session_start).getHours();
    hourCounts[hour]++;
  });
  return hourCounts;
};

router.getTopEventTypes = function(events) {
  const typeCounts = {};
  events.forEach(event => {
    typeCounts[event.event_type] = (typeCounts[event.event_type] || 0) + 1;
  });
  return Object.entries(typeCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([type, count]) => ({ type, count }));
};

router.calculateKnowledgeGrowth = function(nodes) {
  const nodesByDate = {};
  nodes.forEach(node => {
    const date = new Date(node.created_at).toISOString().split('T')[0];
    nodesByDate[date] = (nodesByDate[date] || 0) + 1;
  });
  return nodesByDate;
};

router.calculateSuggestionAccuracy = function(suggestions) {
  const responded = suggestions.filter(s => s.status !== 'pending');
  if (responded.length === 0) return 0;

  const accepted = responded.filter(s => s.status === 'accepted').length;
  return accepted / responded.length;
};

router.getTopSuggestionTypes = function(suggestions) {
  const typeCounts = {};
  suggestions.forEach(suggestion => {
    typeCounts[suggestion.suggestion_type] = (typeCounts[suggestion.suggestion_type] || 0) + 1;
  });
  return Object.entries(typeCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([type, count]) => ({ type, count }));
};

router.getConfidenceDistribution = function(suggestions) {
  const distribution = { low: 0, medium: 0, high: 0 };
  suggestions.forEach(suggestion => {
    const confidence = suggestion.confidence_score || 0;
    if (confidence < 0.5) distribution.low++;
    else if (confidence < 0.8) distribution.medium++;
    else distribution.high++;
  });
  return distribution;
};

router.analyzeOCRData = function(ocrLogs) {
  return {
    total_recognitions: ocrLogs.length,
    avg_confidence: ocrLogs.length ?
      ocrLogs.reduce((sum, log) => sum + (log.confidence || 0), 0) / ocrLogs.length : 0,
    text_length_stats: this.calculateTextLengthStats(ocrLogs)
  };
};

router.analyzeClickPatterns = function(clicks) {
  return {
    total_clicks: clicks.length,
    click_distribution: this.getClickDistribution(clicks),
    avg_click_frequency: this.calculateClickFrequency(clicks)
  };
};

router.analyzeMousePatterns = function(movements) {
  return {
    total_movements: movements.length,
    movement_velocity: this.calculateMovementVelocity(movements),
    movement_patterns: this.identifyMovementPatterns(movements)
  };
};

router.calculateProductivityScore = function(session) {
  const duration = session.session_end ?
    (new Date(session.session_end) - new Date(session.session_start)) / (1000 * 60) : 0;
  const ocrCount = session.ocr_logs?.length || 0;
  const clickCount = session.clicks?.length || 0;

  // Simple productivity score algorithm
  let score = 0;
  if (duration > 30) score += 30; // Active session bonus
  if (ocrCount > 10) score += 20; // OCR activity bonus
  if (clickCount > 50) score += 20; // Click activity bonus

  return Math.min(score, 100);
};

// Additional helper methods would be implemented here...

module.exports = router;