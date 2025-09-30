class AIAssistant {
  constructor() {
    this.backendUrl = 'http://127.0.0.1:8000';
    this.userContext = {
      preferences: {},
      recentApps: new Map(),
      sessionData: {
        startTime: Date.now(),
        appSwitches: 0,
        ocrEvents: []
      }
    };

    // Suggestion cooldown system
    this.suggestionCooldown = {
      lastSuggestionTime: 0,
      minCooldownMs: 15000, // 15 seconds minimum between suggestions
      recentSuggestions: [], // Track recent suggestions for duplicate detection
      maxRecentSuggestions: 5
    };

    // Set up logging
    this.setupLogging();

    // AI Assistant initialized
    // Backend URL set

    // Test backend connectivity
    this.testBackendConnection();

    // Initialize SSE connection
    this.eventSource = null;
    this.sessionId = null;
  }

  initializeSSE(sessionId) {
    this.sessionId = sessionId;

    if (this.eventSource) {
      this.eventSource.close();
    }

    try {
      this.eventSource = new EventSource(`${this.backendUrl}/api/ai/batch-progress/${sessionId}`);

      this.eventSource.onopen = () => {
        this.log('🔗 SSE connection opened for real-time batch updates');
      };

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleSSEEvent(data);
        } catch (e) {
          this.log('❌ Failed to parse SSE event:', e);
        }
      };

      this.eventSource.onerror = (error) => {
        this.log('❌ SSE connection error:', error);
        // Attempt to reconnect after a delay
        setTimeout(() => {
          if (this.sessionId) {
            this.initializeSSE(this.sessionId);
          }
        }, 5000);
      };

    } catch (error) {
      this.log('❌ Failed to initialize SSE:', error);
    }
  }

  handleSSEEvent(data) {
    this.log('📡 SSE Event received:', data.type);

    switch (data.type) {
      case 'connected':
        this.log('✅ Connected to batch progress stream');
        break;

      case 'batch_progress':
        this.log(`📊 Batch progress: ${data.apps_processed}/${data.total_apps} apps processed`);
        this.log(`📱 Current: ${data.current_app}`);

        if (data.status === 'completed' && data.suggestions) {
          this.log('🎉 Batch analysis completed with suggestions');
          this.processBatchSuggestions(data.suggestions, data.sequence_metadata);
        }
        break;

      case 'error':
        this.log('❌ Batch processing error:', data.error);
        break;

      default:
        this.log('📡 Unknown SSE event type:', data.type);
    }
  }

  processBatchSuggestions(suggestions, sequenceMetadata) {
    this.log(`🤖 Processing ${suggestions.length} batch suggestions`);

    // Display suggestions using existing notification system
    suggestions.forEach((suggestion, index) => {
      setTimeout(() => {
        if (global.aiOverlayManager && global.aiOverlayManager.showSuggestion) {
          global.aiOverlayManager.showSuggestion({
            type: suggestion.type || 'workflow',
            title: suggestion.title || 'Workflow Suggestion',
            content: suggestion.content || suggestion.description || 'No description available',
            confidence_score: suggestion.confidence_score || 0.8,
            priority: suggestion.priority || 3,
            context_data: {
              sequence_id: sequenceMetadata?.sequence_id,
              batch_processed: true,
              ...suggestion.context_data
            }
          });
        }
      }, index * 1000); // Stagger suggestions by 1 second
    });
  }

  closeSSE() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.log('🔌 SSE connection closed');
    }
  }

  setupLogging() {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    this.logFile = path.join(os.homedir(), 'squire-debug.log');
    // Logging configured
  }

  log(...args) {
    // Logging disabled for cleaner output
  }

  async testBackendConnection() {
    try {
      // Test backend
      const response = await this.makeHttpRequest(`${this.backendUrl}/api/ai/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      // Backend connected
    } catch (error) {
      // Backend connection failed
      // Check backend
    }
  }

  updateUserContext(appInfo) {
    // Track app usage
    if (appInfo.appName) {
      const now = Date.now();
      const appData = this.userContext.recentApps.get(appInfo.appName) || {
        timeSpent: 0,
        switches: 0,
        lastSeen: now
      };

      // Calculate time spent if we have a previous timestamp
      if (appData.lastSeen) {
        appData.timeSpent += now - appData.lastSeen;
      }
      appData.switches += 1;
      appData.lastSeen = now;

      this.userContext.recentApps.set(appInfo.appName, appData);
      this.userContext.sessionData.appSwitches += 1;
    }
  }

  buildContextForOpenAI(appInfo, ocrResults) {
    const now = new Date();
    const sessionDuration = Date.now() - this.userContext.sessionData.startTime;

    // Convert app usage map to object
    const appUsage = {};
    this.userContext.recentApps.forEach((data, appName) => {
      appUsage[appName] = {
        time_spent: Math.round(data.timeSpent / 1000), // seconds
        switches: data.switches
      };
    });

    // Determine time of day and focus state
    const hour = now.getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    const dayOfWeek = now.getDay() === 0 || now.getDay() === 6 ? 'weekend' : 'weekday';

    // Analyze stress indicators
    const recentSwitches = this.userContext.sessionData.appSwitches;
    const sessionMinutes = sessionDuration / (1000 * 60);
    const switchRate = sessionMinutes > 0 ? recentSwitches / sessionMinutes : 0;

    const user_context = {
      subscription_tier: 'free',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      preferences: {
        notification_frequency: 'medium',
        suggestion_types: ['productivity', 'workflow', 'automation'],
        work_hours: '9-17'
      }
    };

    const current_session = {
      session_start: new Date(this.userContext.sessionData.startTime).toISOString(),
      current_app: appInfo.appName || 'Unknown',
      window_title: appInfo.windowTitle || '',
      recent_ocr_text: ocrResults.slice(0, 20), // Last 20 lines
      app_usage: appUsage,
      session_duration_minutes: Math.round(sessionMinutes)
    };

    const context_signals = {
      time_of_day: timeOfDay,
      day_of_week: dayOfWeek,
      stress_indicators: {
        rapid_app_switching: switchRate > 2, // More than 2 switches per minute
        session_length: sessionMinutes,
      },
    };

    const recent_ocr_context = {
      text_lines: ocrResults, // Send all OCR lines, backend will handle truncation
      workflow_indicators: this.analyzeWorkflowSignals(ocrResults)
    };

    return {
      user_context,
      current_session,
      context_signals,
      recent_ocr_context
    };
  }

  buildEnhancedContextForOpenAI(appInfo, ocrResults) {
    // Start with base context
    const baseContext = this.buildContextForOpenAI(appInfo, ocrResults);

    // Add comprehensive activity data if available
    const activityContext = this.buildActivityContext(appInfo.recentActivity);

    return {
      ...baseContext,
      activity_context: activityContext
    };
  }

  buildActivityContext(recentActivity) {
    if (!recentActivity) {
      return {
        hasData: false,
        summary: 'No recent activity data available'
      };
    }

    const { events = [], sessionStats = {}, mouseMovementSummary = null } = recentActivity;

    // Analyze event patterns
    const eventsByType = {};
    const recentEvents = events.slice(-20); // Last 20 events

    recentEvents.forEach(event => {
      if (!eventsByType[event.type]) {
        eventsByType[event.type] = [];
      }
      eventsByType[event.type].push(event);
    });

    // Build habit patterns
    const habitPatterns = this.analyzeHabitPatterns(recentEvents);

    // Mouse activity analysis
    const mouseActivity = mouseMovementSummary ? {
      pattern: mouseMovementSummary.movementPattern,
      velocity: mouseMovementSummary.averageVelocity,
      activity_level: this.categorizeMouseActivity(mouseMovementSummary.averageVelocity)
    } : null;

    // Keystroke patterns
    const keystrokeEvents = eventsByType['keystroke'] || [];
    const keystrokePatterns = this.analyzeKeystrokePatterns(keystrokeEvents);

    return {
      hasData: true,
      sessionStats: {
        duration_minutes: Math.round((Date.now() - sessionStats.sessionStart) / (1000 * 60)),
        total_keystrokes: sessionStats.keystrokes || 0,
        total_mouse_clicks: sessionStats.mouseClicks || 0,
        total_mouse_moves: sessionStats.mouseMoves || 0,
        app_switches: sessionStats.appSwitches || 0,
        window_switches: sessionStats.windowSwitches || 0
      },
      recentEvents: recentEvents.map(event => ({
        type: event.type,
        timestamp: event.timestamp,
        app: event.app,
        timeSinceEvent: Date.now() - event.timestamp
      })),
      habitPatterns: habitPatterns,
      mouseActivity: mouseActivity,
      keystrokePatterns: keystrokePatterns,
      activitySummary: this.generateActivitySummary(recentEvents, sessionStats)
    };
  }

  analyzeHabitPatterns(events) {
    const patterns = {
      app_switching_frequency: 'normal',
      work_intensity: 'moderate',
      multitasking_level: 'low'
    };

    const appSwitches = events.filter(e => e.type === 'app_switch');
    const keystrokes = events.filter(e => e.type === 'keystroke');

    // App switching frequency
    if (appSwitches.length > 5) {
      patterns.app_switching_frequency = 'high';
    } else if (appSwitches.length < 2) {
      patterns.app_switching_frequency = 'low';
    }

    // Work intensity based on keystroke frequency
    if (keystrokes.length > 10) {
      patterns.work_intensity = 'high';
    } else if (keystrokes.length < 3) {
      patterns.work_intensity = 'low';
    }

    // Multitasking level
    const uniqueApps = new Set(appSwitches.map(e => e.data?.toApp)).size;
    if (uniqueApps > 3) {
      patterns.multitasking_level = 'high';
    } else if (uniqueApps > 1) {
      patterns.multitasking_level = 'moderate';
    }

    return patterns;
  }

  categorizeMouseActivity(averageVelocity) {
    if (averageVelocity > 400) return 'very_active';
    if (averageVelocity > 200) return 'active';
    if (averageVelocity > 50) return 'moderate';
    return 'low';
  }

  analyzeKeystrokePatterns(keystrokeEvents) {
    const shortcuts = keystrokeEvents.map(e => e.data?.key || 'unknown');
    const shortcutCounts = {};

    shortcuts.forEach(shortcut => {
      shortcutCounts[shortcut] = (shortcutCounts[shortcut] || 0) + 1;
    });

    // Find most used shortcuts
    const topShortcuts = Object.entries(shortcutCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([shortcut, count]) => ({ shortcut, count }));

    return {
      total_shortcuts: keystrokeEvents.length,
      top_shortcuts: topShortcuts,
      productivity_shortcuts: this.categorizeProductivityShortcuts(topShortcuts)
    };
  }

  categorizeProductivityShortcuts(shortcuts) {
    const productivityKeys = [
      'CommandOrControl+C', 'CommandOrControl+V', 'CommandOrControl+Z',
      'CommandOrControl+S', 'CommandOrControl+F', 'Alt+Tab'
    ];

    return shortcuts.filter(({ shortcut }) =>
      productivityKeys.includes(shortcut)
    ).length;
  }

  generateActivitySummary(events, sessionStats) {
    const recentMinutes = 5;
    const cutoffTime = Date.now() - (recentMinutes * 60 * 1000);
    const recentEvents = events.filter(e => e.timestamp > cutoffTime);

    return {
      recent_activity_level: recentEvents.length > 5 ? 'high' : recentEvents.length > 2 ? 'moderate' : 'low',
      dominant_activity: this.getDominantActivity(recentEvents),
      session_phase: this.determineSessionPhase(sessionStats)
    };
  }

  getDominantActivity(events) {
    const eventCounts = {};
    events.forEach(event => {
      eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
    });

    return Object.entries(eventCounts)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || 'idle';
  }

  determineSessionPhase(sessionStats) {
    const sessionMinutes = (Date.now() - sessionStats.sessionStart) / (1000 * 60);

    if (sessionMinutes < 15) return 'startup';
    if (sessionMinutes < 60) return 'active';
    if (sessionMinutes < 120) return 'deep_work';
    return 'extended';
  }

  determineFocusState(appName, ocrResults, switchRate) {
    if (switchRate > 3) return 'distracted';

    // Return focused state and let the AI figure out the context
    return 'focused';
  }


  analyzeWorkflowSignals(ocrResults) {
    // Just detect basic content characteristics, let AI determine meaning
    const text = ocrResults.join(' ').toLowerCase();

    return {
      has_structured_content: /•|\*|-|\d+\./.test(text), // bullets, lists, numbers
      has_questions: /\?/.test(text),
      has_numbers_data: /\d+%|\$\d+|\d+,\d+/.test(text), // percentages, money, large numbers
      has_dates_times: /\d{1,2}\/\d{1,2}|\d{4}|:\d{2}/.test(text),
      has_long_content: text.length > 500,
      has_many_lines: ocrResults.length > 10
    };
  }

  // Suggestion Cooldown System
  shouldGenerateSuggestion(ocrResults) {
    const now = Date.now();

    // Check time-based cooldown
    if (now - this.suggestionCooldown.lastSuggestionTime < this.suggestionCooldown.minCooldownMs) {
      // Cooldown active
      return false;
    }

    // Check for similar content to avoid duplicate suggestions
    if (this.isSimilarToRecentContent(ocrResults)) {
      this.log('🔄 Content too similar to recent OCR, skipping suggestion');
      return false;
    }

    return true;
  }

  isSimilarToRecentContent(currentContent) {
    if (this.suggestionCooldown.recentSuggestions.length === 0) {
      return false;
    }

    // Check if current content is similar to any recent suggestion context
    for (const recent of this.suggestionCooldown.recentSuggestions) {
      const similarity = this.calculateContentSimilarity(recent.ocrContent, currentContent);
      if (similarity > 0.7) { // 70% similarity threshold
        return true;
      }
    }

    return false;
  }

  calculateContentSimilarity(content1, content2) {
    if (!content1 || !content2 || content1.length === 0 || content2.length === 0) {
      return 0;
    }

    // Simple similarity based on shared lines
    const set1 = new Set(content1.map(line => line.trim().toLowerCase()));
    const set2 = new Set(content2.map(line => line.trim().toLowerCase()));

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    if (union.size === 0) return 1;

    return intersection.size / union.size;
  }

  trackSuggestion(suggestions, ocrContent) {
    const now = Date.now();

    // Update last suggestion time
    this.suggestionCooldown.lastSuggestionTime = now;

    // Add to recent suggestions
    const suggestionRecord = {
      timestamp: now,
      suggestions: suggestions.map(s => ({ type: s.type, title: s.title })),
      ocrContent: [...ocrContent] // Copy content for similarity checking
    };

    this.suggestionCooldown.recentSuggestions.push(suggestionRecord);

    // Keep only recent suggestions
    if (this.suggestionCooldown.recentSuggestions.length > this.suggestionCooldown.maxRecentSuggestions) {
      this.suggestionCooldown.recentSuggestions.shift();
    }

    // Track suggestion
  }

  async processBatchRequest(batchRequest) {
    console.log("\n" + "="*80);
    console.log("🔄 PROCESSING BATCH REQUEST");
    console.log("="*80);
    console.log(`Sequence ID: ${batchRequest.sequence_metadata.sequence_id}`);
    console.log(`Apps: ${batchRequest.app_sequence.map(a => a.appName).join(' → ')}`);
    console.log(`Pattern: ${batchRequest.sequence_metadata.workflow_pattern}`);
    console.log("="*80 + "\n");

    try {
      const response = await this.makeHttpRequest(`${this.backendUrl}/api/ai/batch-context`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batchRequest)
      });

      const suggestions = response.suggestions || [];

      // Track suggestions for cooldown system
      if (suggestions.length > 0) {
        // Use combined OCR content from all apps in batch
        const combinedOCR = batchRequest.app_sequence.flatMap(app => app.ocrText || []);
        this.trackSuggestion(suggestions, combinedOCR);
      }

      return suggestions;

    } catch (error) {
      console.error('❌ Error processing batch request:', error.message);
      return [];
    }
  }

  async generateSuggestions(appInfo, ocrResults) {
    // Generate suggestions

    // Check cooldown
    if (!this.shouldGenerateSuggestion(ocrResults)) {
      // Suggestion skipped
      return [];
    }

    try {
      this.updateUserContext(appInfo);
      const context = this.buildEnhancedContextForOpenAI(appInfo, ocrResults);

      // Generate a static user ID for now (in production, this would come from authentication)
      const userId = "550e8400-e29b-41d4-a716-446655440000";

      this.log("user_id" + userId);

      const requestData = {
        user_id: userId,
        app_name: appInfo.appName || 'Unknown',
        window_title: appInfo.windowTitle || '',
        ocr_text: ocrResults,
        user_context: context.user_context,
        current_session: context.current_session,
        context_signals: context.context_signals,
        recent_ocr_context: context.recent_ocr_context,
        activity_context: context.activity_context
      };

      // Request AI suggestions
      this.log('📊 Context:', JSON.stringify({
        app: appInfo.appName,
        ocrLines: ocrResults.length,
        focusState: context.context_signals.focus_state,
        backendUrl: this.backendUrl
      }));
      this.log('📤 Request payload size:', JSON.stringify(requestData).length, 'bytes');

      // Make HTTP request to backend using the new context endpoint
      this.log('📡 Making HTTP request to:', `${this.backendUrl}/api/ai/context`);
      this.log("requestData userid" + requestData.user_id);
      const response = await this.makeHttpRequest(`${this.backendUrl}/api/ai/context`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData)
      });

      console.log(`✅ Saved data and received ${response.suggestions?.length || 0} AI suggestions from backend`);
      console.log(`📊 Session ID: ${response.session_id}, OCR Event ID: ${response.ocr_event_id}`);
      if (response.suggestions && response.suggestions.length > 0) {
        console.log('📋 Suggestions:', response.suggestions.map(s => `${s.type}: ${s.title}`));
      }

      const suggestions = response.suggestions || [];

      // Track suggestions for cooldown system
      if (suggestions.length > 0) {
        this.trackSuggestion(suggestions, ocrResults);
      }

      return suggestions;

    } catch (error) {
      console.error('❌ Error requesting AI suggestions from backend:', error.message);
      return [];
    }
  }

  async makeHttpRequest(url, options) {
    this.log('🌐 Starting HTTP request to:', url);
    return new Promise((resolve, reject) => {
      const https = require('https');
      const http = require('http');
      const urlParts = new URL(url);
      const client = urlParts.protocol === 'https:' ? https : http;

      const requestOptions = {
        hostname: urlParts.hostname,
        port: urlParts.port || (urlParts.protocol === 'https:' ? 443 : 80),
        path: urlParts.pathname + urlParts.search,
        method: options.method || 'GET',
        headers: options.headers || {}
      };

      this.log('🔧 Request options:', JSON.stringify({
        hostname: requestOptions.hostname,
        port: requestOptions.port,
        path: requestOptions.path,
        method: requestOptions.method,
        headers: requestOptions.headers
      }));

      const req = client.request(requestOptions, (res) => {
        this.log('📥 Response started, status:', res.statusCode);
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          this.log(`📨 Backend response: ${res.statusCode} (${data.length} bytes)`);
          try {
            const jsonData = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              this.log('✅ Successful response:', JSON.stringify(jsonData));
              resolve(jsonData);
            } else {
              this.log(`❌ Backend error ${res.statusCode}:`, JSON.stringify(jsonData));
              reject(new Error(`HTTP ${res.statusCode}: ${jsonData.error || 'Unknown error'}`));
            }
          } catch (e) {
            this.log('❌ Failed to parse backend response:', data.substring(0, 200));
            reject(new Error(`Failed to parse response: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        this.log('❌ HTTP request error:', error.message);
        this.log('   Error code:', error.code);
        this.log('   URL:', url);
        reject(error);
      });

      if (options.body) {
        this.log('📤 Writing body, length:', options.body.length);
        req.write(options.body);
      }

      // No timeout - let requests complete naturally

      req.end();
    });
  }

  cleanup() {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000;
    this.userContext.recentApps.forEach((data, appName) => {
      if (now - data.lastSeen > maxAge) {
        this.userContext.recentApps.delete(appName);
      }
    });
  }
}

module.exports = AIAssistant;
