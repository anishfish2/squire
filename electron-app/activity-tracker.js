const { globalShortcut, screen } = require('electron');
const activeWin = require('active-win');

class ComprehensiveActivityTracker {
  constructor(onActivity) {
    this.onActivity = onActivity;
    this.isTracking = false;
    this.eventBuffer = [];
    this.bufferFlushInterval = null;

    // Tracking state
    this.currentApp = null;
    this.currentWindow = null;
    this.lastMousePosition = { x: 0, y: 0 };
    this.mouseMovementBuffer = [];
    this.lastActivityTime = Date.now();

    // Intervals
    this.appCheckInterval = null;
    this.mouseTrackingInterval = null;
    this.idleCheckInterval = null;

    // Event counters for session stats
    this.sessionStats = {
      keystrokes: 0,
      mouseClicks: 0,
      mouseMoves: 0,
      appSwitches: 0,
      windowSwitches: 0,
      sessionStart: Date.now()
    };
  }

  startTracking() {
    if (this.isTracking) return;

    this.isTracking = true;
    console.log('🔍 Starting comprehensive activity tracking...');

    // Start various tracking components
    this.startAppTracking();
    this.startMouseTracking();
    this.startKeystrokeTracking();
    this.startIdleDetection();
    this.startEventBufferFlush();

    this.addEvent('session_start', {
      timestamp: Date.now(),
      sessionId: this.generateSessionId()
    });
  }

  stopTracking() {
    if (!this.isTracking) return;

    this.isTracking = false;
    console.log('🛑 Stopping comprehensive activity tracking...');

    // Clear all intervals
    if (this.appCheckInterval) clearInterval(this.appCheckInterval);
    if (this.mouseTrackingInterval) clearInterval(this.mouseTrackingInterval);
    if (this.idleCheckInterval) clearInterval(this.idleCheckInterval);
    if (this.bufferFlushInterval) clearInterval(this.bufferFlushInterval);

    // Unregister global shortcuts
    globalShortcut.unregisterAll();

    // Final event flush
    this.addEvent('session_end', {
      timestamp: Date.now(),
      sessionDuration: Date.now() - this.sessionStats.sessionStart,
      sessionStats: { ...this.sessionStats }
    });

    this.flushEventBuffer();
  }

  // App and Window Tracking
  startAppTracking() {
    this.appCheckInterval = setInterval(() => {
      this.checkActiveApp();
    }, 300); // Check every 300ms for responsive detection

    this.checkActiveApp(); // Initial check
  }

  async checkActiveApp() {
    try {
      const activeWindow = await activeWin();
      if (!activeWindow) return;

      // Skip our own app
      if (activeWindow.owner && activeWindow.owner.name === 'Electron') {
        return;
      }

      const newAppName = activeWindow.owner ? activeWindow.owner.name : 'Unknown';
      const newWindowTitle = activeWindow.title || 'No Title';
      const processId = activeWindow.owner ? activeWindow.owner.processId : null;

      // Detect app switch
      if (this.currentApp !== newAppName) {
        this.addEvent('app_switch', {
          timestamp: Date.now(),
          fromApp: this.currentApp,
          toApp: newAppName,
          processId: processId
        });

        this.currentApp = newAppName;
        this.sessionStats.appSwitches++;
      }

      // Detect window switch within same app
      if (this.currentWindow !== newWindowTitle) {
        this.addEvent('window_switch', {
          timestamp: Date.now(),
          app: newAppName,
          fromWindow: this.currentWindow,
          toWindow: newWindowTitle,
          processId: processId
        });

        this.currentWindow = newWindowTitle;
        this.sessionStats.windowSwitches++;
      }

    } catch (error) {
      console.error('Error checking active app:', error);
    }
  }

  // Mouse Tracking
  startMouseTracking() {
    this.mouseTrackingInterval = setInterval(() => {
      this.trackMousePosition();
    }, 100); // Track every 100ms for movement patterns
  }

  trackMousePosition() {
    try {
      const currentPos = screen.getCursorScreenPoint();

      // Calculate movement distance
      const deltaX = currentPos.x - this.lastMousePosition.x;
      const deltaY = currentPos.y - this.lastMousePosition.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      // Only track if there's significant movement (reduce noise)
      if (distance > 5) {
        this.mouseMovementBuffer.push({
          timestamp: Date.now(),
          x: currentPos.x,
          y: currentPos.y,
          distance: distance,
          velocity: distance / 0.1 // pixels per second
        });

        this.sessionStats.mouseMoves++;
        this.lastActivityTime = Date.now();

        // Keep buffer size manageable (last 50 moves)
        if (this.mouseMovementBuffer.length > 50) {
          this.mouseMovementBuffer.shift();
        }

        // Add periodic movement summary events
        if (this.mouseMovementBuffer.length % 10 === 0) {
          this.addMovementSummaryEvent();
        }
      }

      this.lastMousePosition = currentPos;

    } catch (error) {
      // Silently fail - cursor tracking can be finnicky
    }
  }

  addMovementSummaryEvent() {
    const recent = this.mouseMovementBuffer.slice(-10);
    const avgVelocity = recent.reduce((sum, move) => sum + move.velocity, 0) / recent.length;
    const totalDistance = recent.reduce((sum, move) => sum + move.distance, 0);

    this.addEvent('mouse_movement_pattern', {
      timestamp: Date.now(),
      averageVelocity: Math.round(avgVelocity),
      totalDistance: Math.round(totalDistance),
      movementCount: recent.length,
      pattern: this.analyzeMovementPattern(recent)
    });
  }

  analyzeMovementPattern(movements) {
    if (movements.length < 3) return 'minimal';

    const velocities = movements.map(m => m.velocity);
    const avgVel = velocities.reduce((a, b) => a + b, 0) / velocities.length;

    if (avgVel > 500) return 'rapid';
    if (avgVel > 200) return 'moderate';
    return 'slow';
  }

  // Keystroke Tracking (Global)
  startKeystrokeTracking() {
    // Register global shortcuts for common key combinations
    const keyToTrack = [
      'CommandOrControl+C', 'CommandOrControl+V', 'CommandOrControl+X',
      'CommandOrControl+Z', 'CommandOrControl+Y', 'CommandOrControl+S',
      'CommandOrControl+Tab', 'CommandOrControl+W', 'CommandOrControl+T',
      'CommandOrControl+N', 'CommandOrControl+O', 'CommandOrControl+F',
      'Alt+Tab', 'Escape'
    ];

    keyToTrack.forEach(key => {
      try {
        globalShortcut.register(key, () => {
          this.addEvent('keystroke', {
            timestamp: Date.now(),
            key: key,
            app: this.currentApp,
            window: this.currentWindow
          });

          this.sessionStats.keystrokes++;
          this.lastActivityTime = Date.now();
        });
      } catch (error) {
        console.warn(`Could not register shortcut: ${key}`);
      }
    });
  }

  // Idle Detection
  startIdleDetection() {
    this.idleCheckInterval = setInterval(() => {
      const timeSinceActivity = Date.now() - this.lastActivityTime;

      // Mark as idle after 30 seconds of no activity
      if (timeSinceActivity > 30000) {
        this.addEvent('idle_detected', {
          timestamp: Date.now(),
          idleDuration: timeSinceActivity,
          lastActivity: this.lastActivityTime
        });

        // Reset to prevent spam
        this.lastActivityTime = Date.now();
      }
    }, 10000); // Check every 10 seconds
  }

  // Event Management
  addEvent(type, data) {
    const event = {
      type: type,
      timestamp: data.timestamp || Date.now(),
      app: this.currentApp,
      window: this.currentWindow,
      data: data
    };

    this.eventBuffer.push(event);

    // Auto-flush if buffer gets large
    if (this.eventBuffer.length > 100) {
      this.flushEventBuffer();
    }
  }

  startEventBufferFlush() {
    // Flush events every 5 seconds to backend
    this.bufferFlushInterval = setInterval(() => {
      this.flushEventBuffer();
    }, 5000);
  }

  flushEventBuffer() {
    if (this.eventBuffer.length === 0) return;

    const events = [...this.eventBuffer];
    this.eventBuffer = [];

    // Send to callback with enriched context
    if (this.onActivity) {
      this.onActivity({
        events: events,
        sessionStats: { ...this.sessionStats },
        mouseMovementSummary: this.getMouseMovementSummary(),
        currentContext: {
          app: this.currentApp,
          window: this.currentWindow,
          timestamp: Date.now()
        }
      });
    }
  }

  getMouseMovementSummary() {
    if (this.mouseMovementBuffer.length === 0) return null;

    const recent = this.mouseMovementBuffer.slice(-20);
    const avgVelocity = recent.reduce((sum, move) => sum + move.velocity, 0) / recent.length;
    const totalDistance = recent.reduce((sum, move) => sum + move.distance, 0);

    return {
      averageVelocity: Math.round(avgVelocity),
      totalRecentDistance: Math.round(totalDistance),
      movementPattern: this.analyzeMovementPattern(recent),
      sampleCount: recent.length
    };
  }

  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Simulate mouse clicks (since we can't capture system-wide clicks easily on macOS)
  simulateMouseClick(button = 'left') {
    this.addEvent('mouse_click', {
      timestamp: Date.now(),
      button: button,
      position: { ...this.lastMousePosition },
      app: this.currentApp,
      window: this.currentWindow
    });

    this.sessionStats.mouseClicks++;
    this.lastActivityTime = Date.now();
  }

  getCurrentState() {
    return {
      isTracking: this.isTracking,
      currentApp: this.currentApp,
      currentWindow: this.currentWindow,
      sessionStats: { ...this.sessionStats },
      eventBufferSize: this.eventBuffer.length,
      lastActivity: this.lastActivityTime
    };
  }
}

module.exports = ComprehensiveActivityTracker;