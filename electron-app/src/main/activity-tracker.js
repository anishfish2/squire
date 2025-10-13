import { globalShortcut, screen } from 'electron'
import activeWin from 'active-win'
import authStore from './auth-store.js'

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
    fetch = () => Promise.reject(new Error("fetch not available"));
  }
}

class ComprehensiveActivityTracker {
  constructor(onActivity, userId, sessionId) {
    this.onActivity = onActivity;
    this.isTracking = false;
    this.eventBuffer = [];
    this.bufferFlushInterval = null;

    this.backendUrl = "http://127.0.0.1:8000";
    this.userId = userId || null;
    this.sessionId = sessionId;

    this.currentApp = null;
    this.currentWindow = null;
    this.lastMousePosition = { x: 0, y: 0 };
    this.mouseMovementBuffer = [];
    this.lastActivityTime = Date.now();
    this.visionScheduler = null; // Will be set after construction

    this.pauseDetection = {
      isInPause: false,
      pauseThreshold: 3000,
      lastActivityTime: Date.now(),
      wasActiveBeforePause: false
    };

    this.ocrManager = null;

    this.appCheckInterval = null;
    this.mouseTrackingInterval = null;
    this.mouseSummaryInterval = null;
    this.idleCheckInterval = null;

    this.sessionStats = {
      keystrokes: 0,
      mouseClicks: 0,
      mouseMoves: 0,
      appSwitches: 0,
      windowSwitches: 0,
      sessionStart: Date.now(),
    };
  }

  setVisionScheduler(visionScheduler) {
    this.visionScheduler = visionScheduler;
  }

  async startTracking() {
    if (this.isTracking) return;

    this.isTracking = true;

    this.startAppTracking();
    this.startMouseTracking();
    this.startKeystrokeTracking();
    this.startIdleDetection();
    this.startEventBufferFlush();

    if (this.sessionId) {
    } else {
    }

    this.addEvent("session_start", {
      timestamp: Date.now(),
      sessionId: this.sessionId,
    });
  }

  async stopTracking() {
    if (!this.isTracking) return;

    this.isTracking = false;

    if (this.appCheckInterval) clearInterval(this.appCheckInterval);
    if (this.mouseTrackingInterval) clearInterval(this.mouseTrackingInterval);
    if (this.mouseSummaryInterval) clearInterval(this.mouseSummaryInterval);
    if (this.idleCheckInterval) clearInterval(this.idleCheckInterval);
    if (this.bufferFlushInterval) clearInterval(this.bufferFlushInterval);

    globalShortcut.unregisterAll();

    this.addEvent("session_end", {
      timestamp: Date.now(),
      sessionDuration: Date.now() - this.sessionStats.sessionStart,
      sessionStats: { ...this.sessionStats },
    });

    await this.flushEventBuffer();

    await this.sendSessionStatsToBackend();
  }

  startAppTracking() {
    this.appCheckInterval = setInterval(() => {
      this.checkActiveApp();
    }, 300);

    this.checkActiveApp();
  }

  async checkActiveApp() {
    // Skip if vision pipeline is disabled
    if (this.visionScheduler && !this.visionScheduler.globalVisionEnabled) {
      return;
    }

    try {
      const activeWindow = await activeWin();
      if (!activeWindow) return;

      if (activeWindow.owner && activeWindow.owner.name === "Electron") {
        return;
      }

      const newAppName = activeWindow.owner ? activeWindow.owner.name : "Unknown";
      const newWindowTitle = activeWindow.title || "No Title";
      const processId = activeWindow.owner ? activeWindow.owner.processId : null;

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
    }
  }

  startMouseTracking() {
    this.mouseTrackingInterval = setInterval(() => {
      this.trackMousePosition();
    }, 100);

    this.mouseSummaryInterval = setInterval(() => {
      this.flushMouseMovementSummary();
    }, 5000);
  }

  trackMousePosition() {
    // Skip if vision pipeline is disabled
    if (this.visionScheduler && !this.visionScheduler.globalVisionEnabled) {
      return;
    }

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
          velocity: distance / 0.1,
        });

        this.lastActivityTime = Date.now();
        this.updateActivityForPauseDetection();

        if (this.mouseMovementBuffer.length > 200) {
          this.mouseMovementBuffer.shift();
        }
      }

      this.lastMousePosition = currentPos;
    } catch (error) {
    }
  }

  flushMouseMovementSummary() {
    if (this.mouseMovementBuffer.length === 0) return;

    const recent = [...this.mouseMovementBuffer];
    this.mouseMovementBuffer = [];

    const avgVelocity =
      recent.reduce((sum, m) => sum + m.velocity, 0) / recent.length;
    const totalDistance = recent.reduce((sum, m) => sum + m.distance, 0);

    const minX = Math.min(...recent.map((m) => m.x));
    const maxX = Math.max(...recent.map((m) => m.x));
    const minY = Math.min(...recent.map((m) => m.y));
    const maxY = Math.max(...recent.map((m) => m.y));

    this.sessionStats.mouseMoves += recent.length;

    this.addEvent("mouse_movement_summary", {
      timestamp: Date.now(),
      movementCount: recent.length,
      averageVelocity: Math.round(avgVelocity),
      totalDistance: Math.round(totalDistance),
      bounds: { minX, maxX, minY, maxY },
      pattern: this.analyzeMovementPattern(recent),
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

  startKeystrokeTracking() {
    // DISABLED: This was blocking critical system shortcuts (Cmd+C, Cmd+V, etc.)
    // Keystroke tracking is now handled by keystroke-collector.js which listens
    // passively without intercepting shortcuts. That collector already updates
    // activity stats, so this globalShortcut registration is redundant and harmful.

    // The keystroke-collector.js handles:
    // - All keystroke detection (without blocking)
    // - Activity tracking
    // - Sending events to /api/ai/keystroke-analysis endpoint

    // If you need to track specific shortcuts without blocking them, use the
    // keystroke-collector.js events instead of globalShortcut.register()

    /* COMMENTED OUT - THIS BLOCKS SYSTEM SHORTCUTS
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
          this.sessionStats.keystrokes++;
          this.lastActivityTime = Date.now();
          this.updateActivityForPauseDetection();
        });
      } catch (error) {
      }
    });
    */
  }

  updateActivityForPauseDetection() {
    const now = Date.now();

    if (this.pauseDetection.isInPause && this.pauseDetection.wasActiveBeforePause) {
      this.triggerSmartOCR("activity_resumed");
      this.pauseDetection.isInPause = false;
    }

    this.pauseDetection.lastActivityTime = now;
    this.pauseDetection.wasActiveBeforePause = true;
  }

  checkForPause() {
    const now = Date.now();
    const timeSinceActivity = now - this.pauseDetection.lastActivityTime;

    if (timeSinceActivity >= this.pauseDetection.pauseThreshold &&
        !this.pauseDetection.isInPause &&
        this.pauseDetection.wasActiveBeforePause) {

      this.pauseDetection.isInPause = true;
    }
  }

  triggerSmartOCR(reason) {
    // Check if vision is globally enabled before triggering OCR
    if (this.visionScheduler && !this.visionScheduler.globalVisionEnabled) {
      console.log('🚫 [ActivityTracker] Vision pipeline disabled, skipping OCR trigger');
      return;
    }

    if (global.smartOCRScheduler && global.smartOCRScheduler.triggerImmediateOCR) {
      global.smartOCRScheduler.triggerImmediateOCR({
        appName: this.currentApp,
        windowTitle: this.currentWindow,
        session_id: this.sessionId
      }, reason);
    } else if (this.ocrManager && this.ocrManager.triggerSmartOCR) {
      this.ocrManager.triggerSmartOCR(reason, {
        appName: this.currentApp,
        windowTitle: this.currentWindow,
        session_id: this.sessionId
      }, this.userId);
    }
  }

  startIdleDetection() {
    this.idleCheckInterval = setInterval(() => {
      const timeSinceActivity = Date.now() - this.lastActivityTime;

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

  addEvent(type, data) {
    // Skip adding events if vision pipeline is disabled
    if (this.visionScheduler && !this.visionScheduler.globalVisionEnabled) {
      return;
    }

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

    // Check if vision is globally enabled before sending activity data
    if (this.visionScheduler && !this.visionScheduler.globalVisionEnabled) {
      console.log('🚫 [ActivityTracker] Vision pipeline disabled, clearing activity buffer without sending');
      this.eventBuffer = [];
      return;
    }

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

    // Double-check vision state before sending
    if (!this.visionScheduler) {
      console.log('🚫 [ActivityTracker.sendEventsToBackend] visionScheduler not initialized, not sending events');
      return;
    }

    if (!this.visionScheduler.globalVisionEnabled) {
      console.log('🚫 [ActivityTracker.sendEventsToBackend] Vision disabled, not sending events');
      return;
    }

    console.log(`📤 [ActivityTracker.sendEventsToBackend] Sending ${events.length} events (Vision: true)`);

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

      // Get auth token for API call
      const token = authStore.getAccessToken();
      console.log('🔑 [ActivityTracker] Token available:', !!token);
      const headers = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      } else {
        console.error('❌ [ActivityTracker] No auth token available!');
      }

      const response = await fetch(
        `${this.backendUrl}/api/activity/activity-batch`,
        {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            // user_id is no longer needed - comes from auth token
            session_id: this.sessionId,
            events: transformedEvents,
          }),
        }
      );

      if (response.ok) {
        const result = await response.json();
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
      // Get auth token for API call
      const token = authStore.getAccessToken();
      const headers = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const statsPayload = {
        session_id: this.sessionId,
        stats: {
          ...this.sessionStats,
          sessionDuration: Date.now() - this.sessionStats.sessionStart,
          mouseMovementSummary: this.getMouseMovementSummary(),
          timestamp: Date.now()
        }
      };

      if (this.userId) {
        statsPayload.user_id = this.userId;
      }

      const response = await fetch(`${this.backendUrl}/api/activity/session-stats`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(statsPayload),
      });

      if (response.ok) {
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

export default ComprehensiveActivityTracker
