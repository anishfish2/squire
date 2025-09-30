const { globalShortcut, screen } = require('electron');
const activeWin = require('active-win');
// Use Node.js 18+ built-in fetch if available, otherwise use node-fetch
let fetch;
try {
  fetch = globalThis.fetch;
  if (!fetch) {
    fetch = require("node-fetch");
  }
} catch (e) {
  try {
    fetch = require("node-fetch");
  } catch (e2) {
    // Fetch not available
    fetch = () => Promise.reject(new Error("fetch not available"));
  }
}

class ComprehensiveActivityTracker {
  constructor(onActivity, userId, sessionId) {
    this.onActivity = onActivity;
    this.isTracking = false;
    this.eventBuffer = [];
    this.bufferFlushInterval = null;

    // Backend configuration
    this.backendUrl = "http://127.0.0.1:8000";
    this.userId = userId || "550e8400-e29b-41d4-a716-446655440000";
    this.sessionId = sessionId;

    // Tracking state
    this.currentApp = null;
    this.currentWindow = null;
    this.lastMousePosition = { x: 0, y: 0 };
    this.mouseMovementBuffer = [];
    this.lastActivityTime = Date.now();

    // Smart OCR Triggering State
    this.pauseDetection = {
      isInPause: false,
      pauseThreshold: 3000, // 3 seconds
      lastActivityTime: Date.now(),
      wasActiveBeforePause: false
    };

    // OCR Manager reference (set externally)
    this.ocrManager = null;

    // Intervals
    this.appCheckInterval = null;
    this.mouseTrackingInterval = null;
    this.mouseSummaryInterval = null;
    this.idleCheckInterval = null;

    // Event counters for session stats
    this.sessionStats = {
      keystrokes: 0,
      mouseClicks: 0,
      mouseMoves: 0,
      appSwitches: 0,
      windowSwitches: 0,
      sessionStart: Date.now(),
    };
  }

  async startTracking() {
    if (this.isTracking) return;

    this.isTracking = true;
    // Starting tracking

    // Start various tracking components
    this.startAppTracking();
    this.startMouseTracking();
    this.startKeystrokeTracking();
    this.startIdleDetection();
    this.startEventBufferFlush();

    // Session ID should already be provided from main.js
    if (this.sessionId) {
      // Session ID set
    } else {
      // No session ID
    }

    this.addEvent("session_start", {
      timestamp: Date.now(),
      sessionId: this.sessionId,
    });
  }

  async stopTracking() {
    if (!this.isTracking) return;

    this.isTracking = false;
    // Stopping tracking

    // Clear all intervals
    if (this.appCheckInterval) clearInterval(this.appCheckInterval);
    if (this.mouseTrackingInterval) clearInterval(this.mouseTrackingInterval);
    if (this.mouseSummaryInterval) clearInterval(this.mouseSummaryInterval); // ✅ fixed
    if (this.idleCheckInterval) clearInterval(this.idleCheckInterval);
    if (this.bufferFlushInterval) clearInterval(this.bufferFlushInterval);

    // Unregister global shortcuts
    globalShortcut.unregisterAll();

    // Final event flush
    this.addEvent("session_end", {
      timestamp: Date.now(),
      sessionDuration: Date.now() - this.sessionStats.sessionStart,
      sessionStats: { ...this.sessionStats },
    });

    await this.flushEventBuffer();

    // Send final session stats to backend
    await this.sendSessionStatsToBackend();
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
      if (activeWindow.owner && activeWindow.owner.name === "Electron") {
        return;
      }

      const newAppName = activeWindow.owner ? activeWindow.owner.name : "Unknown";
      const newWindowTitle = activeWindow.title || "No Title";
      const processId = activeWindow.owner ? activeWindow.owner.processId : null;

      // Detect app switch
      if (this.currentApp !== newAppName) {
        this.addEvent("app_switch", {
          timestamp: Date.now(),
          fromApp: this.currentApp,
          toApp: newAppName,
          processId: processId,
        });

        this.currentApp = newAppName;
        this.sessionStats.appSwitches++;
        this.updateActivityForPauseDetection();
      }

      // Detect window switch within same app
      if (this.currentWindow !== newWindowTitle) {
        this.addEvent("window_switch", {
          timestamp: Date.now(),
          app: newAppName,
          fromWindow: this.currentWindow,
          toWindow: newWindowTitle,
          processId: processId,
        });

        this.currentWindow = newWindowTitle;
        this.sessionStats.windowSwitches++;
      }
    } catch (error) {
      // App check error
    }
  }

  // Mouse Tracking
  startMouseTracking() {
    // Track raw points but only flush every 5 seconds as a summary
    this.mouseTrackingInterval = setInterval(() => {
      this.trackMousePosition();
    }, 100); // still sample often

    // New: summary flush every 5s
    this.mouseSummaryInterval = setInterval(() => {
      this.flushMouseMovementSummary();
    }, 5000);
  }

  trackMousePosition() {
    try {
      const currentPos = screen.getCursorScreenPoint();

      const deltaX = currentPos.x - this.lastMousePosition.x;
      const deltaY = currentPos.y - this.lastMousePosition.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      if (distance > 5) {
        this.mouseMovementBuffer.push({
          timestamp: Date.now(),
          x: currentPos.x,
          y: currentPos.y,
          distance: distance,
          velocity: distance / 0.1, // pixels per second
        });

        this.lastActivityTime = Date.now();
        this.updateActivityForPauseDetection();

        // Keep buffer from growing unbounded
        if (this.mouseMovementBuffer.length > 200) {
          this.mouseMovementBuffer.shift();
        }
      }

      this.lastMousePosition = currentPos;
    } catch (error) {
      // ignore tracking errors
    }
  }

  flushMouseMovementSummary() {
    if (this.mouseMovementBuffer.length === 0) return;

    const recent = [...this.mouseMovementBuffer];
    this.mouseMovementBuffer = []; // clear for next batch

    const avgVelocity =
      recent.reduce((sum, m) => sum + m.velocity, 0) / recent.length;
    const totalDistance = recent.reduce((sum, m) => sum + m.distance, 0);

    // Calculate bounding box for the movement
    const minX = Math.min(...recent.map((m) => m.x));
    const maxX = Math.max(...recent.map((m) => m.x));
    const minY = Math.min(...recent.map((m) => m.y));
    const maxY = Math.max(...recent.map((m) => m.y));

    // ✅ increment stats here instead of per movement
    this.sessionStats.mouseMoves += recent.length;

    this.addEvent("mouse_movement_summary", {
      timestamp: Date.now(),
      movementCount: recent.length,
      averageVelocity: Math.round(avgVelocity),
      totalDistance: Math.round(totalDistance),
      bounds: { minX, maxX, minY, maxY },
      pattern: this.analyzeMovementPattern(recent),
      // Optional: keep path for debugging/replay
      path: recent.map((m) => ({ x: m.x, y: m.y, t: m.timestamp })),
    });
  }

  analyzeMovementPattern(movements) {
    if (movements.length < 3) return "minimal";

    const velocities = movements.map((m) => m.velocity);
    const avgVel = velocities.reduce((a, b) => a + b, 0) / velocities.length;

    if (avgVel > 500) return "rapid";
    if (avgVel > 200) return "moderate";
    return "slow";
  }

  // Keystroke Tracking
  startKeystrokeTracking() {
    const keyToTrack = [
      "CommandOrControl+C",
      "CommandOrControl+V",
      "CommandOrControl+X",
      "CommandOrControl+Z",
      "CommandOrControl+Y",
      "CommandOrControl+S",
      "CommandOrControl+Tab",
      "CommandOrControl+W",
      "CommandOrControl+T",
      "CommandOrControl+N",
      "CommandOrControl+O",
      "CommandOrControl+F",
      "Alt+Tab",
      "Escape",
    ];

    keyToTrack.forEach((key) => {
      try {
        globalShortcut.register(key, () => {
          this.addEvent("keystroke", {
            timestamp: Date.now(),
            key: key,
            app: this.currentApp,
            window: this.currentWindow,
          });

          this.sessionStats.keystrokes++;
          this.lastActivityTime = Date.now();
          this.updateActivityForPauseDetection();
        });
      } catch (error) {
        // Shortcut registration failed
      }
    });
  }

  // Smart OCR Triggering - Pause Detection
  updateActivityForPauseDetection() {
    const now = Date.now();

    // If we were in a pause and now have activity, trigger OCR
    if (this.pauseDetection.isInPause && this.pauseDetection.wasActiveBeforePause) {
      // Activity resumed
      this.triggerSmartOCR("activity_resumed");
      this.pauseDetection.isInPause = false;
    }

    this.pauseDetection.lastActivityTime = now;
    this.pauseDetection.wasActiveBeforePause = true;
  }

  checkForPause() {
    const now = Date.now();
    const timeSinceActivity = now - this.pauseDetection.lastActivityTime;

    // If we've been inactive for the threshold and weren't already in pause
    if (timeSinceActivity >= this.pauseDetection.pauseThreshold &&
        !this.pauseDetection.isInPause &&
        this.pauseDetection.wasActiveBeforePause) {

      // Pause detected
      this.pauseDetection.isInPause = true;
    }
  }

  triggerSmartOCR(reason) {
    // Use the smart scheduler if available, otherwise fall back to direct OCR
    if (global.smartOCRScheduler && global.smartOCRScheduler.triggerImmediateOCR) {
      // Smart OCR scheduled
      global.smartOCRScheduler.triggerImmediateOCR({
        appName: this.currentApp,
        windowTitle: this.currentWindow,
        session_id: this.sessionId
      }, reason);
    } else if (this.ocrManager && this.ocrManager.triggerSmartOCR) {
      // Fallback OCR triggered
      this.ocrManager.triggerSmartOCR(reason, {
        appName: this.currentApp,
        windowTitle: this.currentWindow,
        session_id: this.sessionId
      }, this.userId);
    }
  }

  // Idle Detection
  startIdleDetection() {
    this.idleCheckInterval = setInterval(() => {
      const timeSinceActivity = Date.now() - this.lastActivityTime;

      // Check for pause detection
      this.checkForPause();

      if (timeSinceActivity > 30000) {
        this.addEvent("idle_detected", {
          timestamp: Date.now(),
          idleDuration: timeSinceActivity,
          lastActivity: this.lastActivityTime,
        });

        this.lastActivityTime = Date.now();
      }
    }, 10000);
  }

  // Event Management
  addEvent(type, data) {
    const event = {
      type: type,
      timestamp: data.timestamp || Date.now(),
      app: this.currentApp,
      window: this.currentWindow,
      data: data,
    };

    this.eventBuffer.push(event);

    if (this.eventBuffer.length > 100) {
      this.flushEventBuffer();
    }
  }

  startEventBufferFlush() {
    this.bufferFlushInterval = setInterval(() => {
      this.flushEventBuffer();
    }, 5000);
  }

  async flushEventBuffer() {
    if (this.eventBuffer.length === 0) return;

    const events = [...this.eventBuffer];
    this.eventBuffer = [];

    if (this.onActivity) {
      this.onActivity({
        events: events,
        sessionStats: { ...this.sessionStats },
        mouseMovementSummary: this.getMouseMovementSummary(),
        currentContext: {
          app: this.currentApp,
          window: this.currentWindow,
          timestamp: Date.now(),
        },
      });
    }

    await this.sendEventsToBackend(events);
  }

  async sendEventsToBackend(events) {
    if (!events || events.length === 0) return;

    try {
      const transformedEvents = events.map((event) => ({
        action: event.type,
        app_name: event.app || "Unknown",
        window_title: event.window || "No Title",
        timestamp: event.timestamp,
        details: {
          ...event.data,
          originalType: event.type,
        },
      }));

      const response = await fetch(
        `${this.backendUrl}/api/activity/activity-batch`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: this.userId,
            session_id: this.sessionId,
            events: transformedEvents,
          }),
        }
      );

      if (response.ok) {
        const result = await response.json();
        console.log(
          `📊 Successfully sent ${transformedEvents.length} activity events to backend`
        );
      } else {
        console.error(
          `❌ Failed to send activity events: ${response.status} ${response.statusText}`
        );
      }
    } catch (error) {
      console.error("❌ Error sending activity events to backend:", error);
    }
  }


  async sendSessionStatsToBackend() {
    try {
      const response = await fetch(`${this.backendUrl}/api/activity/session-stats`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: this.userId,
          session_id: this.sessionId,
          stats: {
            ...this.sessionStats,
            sessionDuration: Date.now() - this.sessionStats.sessionStart,
            mouseMovementSummary: this.getMouseMovementSummary(),
            timestamp: Date.now(),
          },
        }),
      });

      if (response.ok) {
        console.log("📈 Successfully sent session stats to backend");
      } else {
        console.error(
          `❌ Failed to send session stats: ${response.status} ${response.statusText}`
        );
      }
    } catch (error) {
      console.error("❌ Error sending session stats to backend:", error);
    }
  }

  getMouseMovementSummary() {
    if (this.mouseMovementBuffer.length === 0) return null;

    const recent = this.mouseMovementBuffer.slice(-20);
    const avgVelocity =
      recent.reduce((sum, move) => sum + move.velocity, 0) / recent.length;
    const totalDistance = recent.reduce((sum, move) => sum + move.distance, 0);

    return {
      averageVelocity: Math.round(avgVelocity),
      totalRecentDistance: Math.round(totalDistance),
      movementPattern: this.analyzeMovementPattern(recent),
      sampleCount: recent.length,
    };
  }

  getCurrentState() {
    return {
      isTracking: this.isTracking,
      currentApp: this.currentApp,
      currentWindow: this.currentWindow,
      sessionStats: { ...this.sessionStats },
      eventBufferSize: this.eventBuffer.length,
      lastActivity: this.lastActivityTime,
    };
  }
}

module.exports = ComprehensiveActivityTracker;

