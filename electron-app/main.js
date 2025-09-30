// main.js
const { app, BrowserWindow, screen, ipcMain, Menu, dialog } = require("electron");
const path = require("path");

const OCRManager = require("./ocr-manager");
const ActiveAppTracker = require("./app-tracker"); // ✅ now uses @paymoapp/active-window
const ComprehensiveActivityTracker = require("./activity-tracker");
const AIAssistant = require("./ai-assistant");
const EfficientKeystrokeCollector = require("./keystroke-collector");

let mainWindow;
let debugWindow;
let suggestionsWindow;
let ocrManager;
let appTracker;
let activityTracker;
let aiAssistant;
let keystrokeCollector;
let recentActivityData = null;
let skipNextOCR = false; // For user-initiated focus handling
let smartOCRScheduler = null; // For smart OCR scheduling
let ocrBatchManager = null; // For OCR result batching

let currentUserId = "550e8400-e29b-41d4-a716-446655440000";
let currentSessionId = null;

// ----- Helper Functions -----
function sendToDebug(channel, data) {
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.webContents.send(channel, data);
  }
}

function sendToSuggestions(channel, data) {
  if (suggestionsWindow && !suggestionsWindow.isDestroyed()) {
    suggestionsWindow.webContents.send(channel, data);
  }
}

// ----- Smart OCR Scheduler -----
class SmartOCRScheduler {
  constructor(delay = 500) {
    this.delay = delay;
    this.timeout = null;
    this.fallbackTimeout = null;
    this.pendingApp = null;
    this.processCallback = null;
    this.lastOCRTime = 0;
    this.minTimeBetweenOCR = 5000; // 5 seconds minimum
    this.fallbackInterval = 30000; // 30 seconds fallback
    this.lastAppInfo = null;

    // Start fallback timer
    this.startFallbackTimer();
  }

  setProcessCallback(callback) {
    this.processCallback = callback;
  }

  scheduleOCR(appInfo, reason = "app_switch") {
    // Cancel previous pending OCR
    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    // Check if we should skip due to time constraints
    const now = Date.now();
    if (now - this.lastOCRTime < this.minTimeBetweenOCR) {
      // OCR rate limiting
      this.pendingApp = appInfo;
      this.timeout = setTimeout(() => {
        this.executeOCR(appInfo, reason);
      }, this.minTimeBetweenOCR - (now - this.lastOCRTime));
      return;
    }

    this.pendingApp = appInfo;
    // Smart OCR scheduling

    // Schedule OCR after delay
    this.timeout = setTimeout(() => {
      this.executeOCR(appInfo, reason);
    }, this.delay);
  }

  executeOCR(appInfo, reason) {
    if (this.pendingApp && this.processCallback) {
      // Execute OCR
      this.lastOCRTime = Date.now();
      this.lastAppInfo = appInfo;
      this.processCallback(appInfo, reason);
    }
  }

  startFallbackTimer() {
    // Fallback timer to ensure we don't miss long periods without OCR
    this.fallbackTimeout = setInterval(() => {
      const now = Date.now();
      if (now - this.lastOCRTime > this.fallbackInterval && this.lastAppInfo) {
        // Fallback OCR trigger
        this.executeOCR(this.lastAppInfo, 'fallback_timer');
      }
    }, this.fallbackInterval);
  }

  // Called by activity tracker for immediate OCR triggers
  triggerImmediateOCR(appInfo, reason) {
    const now = Date.now();
    if (now - this.lastOCRTime < 3000) { // 3 second immediate minimum
      // OCR blocked
      return;
    }

    // Immediate OCR
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    this.executeOCR(appInfo, reason);
  }

  cancel() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
      this.pendingApp = null;
    }
  }

  stop() {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    if (this.fallbackTimeout) {
      clearInterval(this.fallbackTimeout);
    }
  }
}

// ----- OCR Batch Manager -----
class OCRBatchManager {
  constructor() {
    this.pendingBatch = [];
    this.batchTimeout = null;
    this.batchWindow = 10000; // 10 seconds to wait for OCR completion
    this.maxBatchSize = 5; // Max 5 apps per batch
    this.currentSequenceId = null;
    this.pendingOCRJobs = new Map(); // Track pending OCR jobs by job_id
  }

  async queueOCRJob(jobId, appContext, reason = "unknown") {
    const now = Date.now();

    // Generate sequence ID if this is a new batch
    if (this.pendingBatch.length === 0) {
      this.currentSequenceId = `seq_${now}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Create batch item placeholder - will be populated when OCR completes
    const batchItem = {
      timestamp: now,
      appName: appContext.appName,
      windowTitle: appContext.windowTitle,
      bundleId: appContext.bundleId,
      ocrText: [], // Will be populated from WebSocket completion
      meaningful_context: "", // Will be populated from WebSocket completion
      sequence: this.pendingBatch.length,
      trigger_reason: reason,
      duration_in_app: this.calculateAppDuration(appContext.appName),
      jobId: jobId, // Track the OCR job ID
      ocrCompleted: false // Track completion status
    };

    this.pendingBatch.push(batchItem);
    this.pendingOCRJobs.set(jobId, batchItem);

    console.log(`📦 Queued OCR job ${jobId} for batch: ${appContext.appName} (${this.pendingBatch.length}/${this.maxBatchSize})`);

    // Reset batch timer
    if (this.batchTimeout) clearTimeout(this.batchTimeout);

    // Check if we should process batch (when all OCR jobs complete or timeout)
    this.checkBatchReadiness();
  }

  onOCRJobComplete(jobId, ocrText, meaningfulContext) {
    const batchItem = this.pendingOCRJobs.get(jobId);
    if (batchItem) {
      // Update batch item with OCR results
      batchItem.ocrText = ocrText || [];
      batchItem.meaningful_context = meaningfulContext || "";
      batchItem.ocrCompleted = true;

      console.log(`✅ OCR job ${jobId} completed for ${batchItem.appName} (${ocrText?.length || 0} lines)`);

      // Remove from pending jobs
      this.pendingOCRJobs.delete(jobId);

      // Check if batch is ready for processing
      this.checkBatchReadiness();
    }
  }

  checkBatchReadiness() {
    if (this.pendingBatch.length === 0) return;

    const allCompleted = this.pendingBatch.every(item => item.ocrCompleted);
    const batchFull = this.pendingBatch.length >= this.maxBatchSize;

    if (allCompleted || batchFull) {
      console.log(`📦 Batch ready: ${allCompleted ? 'all OCR completed' : 'batch full'} (${this.pendingBatch.length}/${this.maxBatchSize})`);
      this.processBatch();
      return;
    }

    // Set timeout for batch processing if not already set
    if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => {
        console.log(`⏰ Batch timeout reached, processing ${this.pendingBatch.length} items`);
        this.processBatch();
      }, this.batchWindow);
    }
  }

  calculateAppDuration(appName) {
    // Simple duration tracking - could be enhanced
    if (!this.lastAppSwitch) return 0;
    return Date.now() - this.lastAppSwitch;
  }

  async processBatch() {
    if (this.pendingBatch.length === 0) return;

    const batch = [...this.pendingBatch];
    const sequenceId = this.currentSequenceId;

    // Clear current batch and pending jobs
    this.pendingBatch = [];
    this.pendingOCRJobs.clear();
    this.currentSequenceId = null;
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📦 PROCESSING OCR BATCH`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Sequence ID: ${sequenceId}`);
    console.log(`Apps in sequence: ${batch.map(b => b.appName).join(' → ')}`);
    console.log(`Total duration: ${batch[batch.length - 1]?.timestamp - batch[0]?.timestamp}ms`);
    console.log(`${'='.repeat(80)}\n`);

    try {
      await this.sendBatchToLLM(batch, sequenceId);
    } catch (error) {
      console.error('❌ Error processing batch:', error);
    }
  }

  async sendBatchToLLM(batch, sequenceId) {
    // Prepare sequence metadata
    const sequenceMetadata = {
      sequence_id: sequenceId,
      total_apps: batch.length,
      sequence_duration: batch[batch.length - 1]?.timestamp - batch[0]?.timestamp,
      rapid_switching: batch.length > 2 && (batch[batch.length - 1]?.timestamp - batch[0]?.timestamp) < 10000,
      unique_apps: new Set(batch.map(b => b.appName)).size,
      trigger_reasons: batch.map(b => b.trigger_reason),
      workflow_pattern: this.analyzeWorkflowPattern(batch)
    };

    // Build enhanced request with sequence context
    const batchRequest = {
      user_id: currentUserId,
      session_id: currentSessionId,
      sequence_metadata: sequenceMetadata,
      app_sequence: batch,
      request_type: "batch_analysis",
      context_signals: {
        time_of_day: new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening',
        day_of_week: new Date().getDay() === 0 || new Date().getDay() === 6 ? 'weekend' : 'weekday',
        rapid_switching: sequenceMetadata.rapid_switching,
        multi_domain: sequenceMetadata.unique_apps > 2
      }
    };

    // Send to AI assistant for LLM processing
    if (aiAssistant) {
      // Send batch request to backend - results will come via SSE
      const result = await aiAssistant.processBatchRequest(batchRequest);

      // The batch results will be received via SSE connection
      // and processed in aiAssistant.handleSSEEvent()
      console.log(`📦 Batch submitted for sequence ${sequenceId} - awaiting SSE results`);
    }
  }

  analyzeWorkflowPattern(batch) {
    const apps = batch.map(b => b.appName);

    // Detect common patterns
    if (apps.includes('Code') || apps.includes('VS Code')) {
      if (apps.includes('Chrome') || apps.includes('Safari')) {
        return 'development_research';
      }
      return 'coding';
    }

    if (apps.includes('Terminal') && (apps.includes('Code') || apps.includes('VS Code'))) {
      return 'development_workflow';
    }

    if (apps.filter(app => app.includes('Chrome') || app.includes('Safari')).length > 1) {
      return 'research_browsing';
    }

    return 'general_workflow';
  }

  // Force process current batch (useful for app shutdown)
  forceProcessBatch() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }
    this.processBatch();
  }
}

// ----- Window Creation -----
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,           // Start hidden
    skipTaskbar: false,    // DO show in taskbar/dock
    focusable: true,       // CAN be focused when user clicks
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Load a simple status page
  mainWindow.loadFile(path.join(__dirname, "debug.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

function createDebugWindow() {
  debugWindow = new BrowserWindow({
    width: 300,
    height: 200,
    x: 20,
    y: 20,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    skipTaskbar: true,
    focusable: false,      // Can't steal focus
    visibleOnAllWorkspaces: true,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  debugWindow.loadFile("debug.html");

  // Stay on top, even fullscreen
  debugWindow.setAlwaysOnTop(true, "screen-saver");
  debugWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  });

  // Default click-through
  debugWindow.setIgnoreMouseEvents(true, { forward: true });

  // Allow interaction on hover
  debugWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "mouseMove") {
      debugWindow.setIgnoreMouseEvents(false);
    }
  });
  debugWindow.on("blur", () => {
    if (debugWindow) debugWindow.setIgnoreMouseEvents(true, { forward: true });
  });

  debugWindow.on("closed", () => {
    debugWindow = null;
  });

  // User-initiated focus handling for debug window
  debugWindow.webContents.on('did-finish-load', () => {
    debugWindow.webContents.executeJavaScript(`
      document.addEventListener('click', () => {
        require('electron').ipcRenderer.send('overlay-clicked', 'debug');
      });
    `);
  });



  return debugWindow;
}

function createSuggestionsWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  suggestionsWindow = new BrowserWindow({
    width: 400,
    height: 500,
    x: width - 420,
    y: 20,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    skipTaskbar: true,
    focusable: false,      // Can't steal focus
    visibleOnAllWorkspaces: true,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  suggestionsWindow.loadFile("suggestions.html");

  // Stay on top, even fullscreen
  suggestionsWindow.setAlwaysOnTop(true, "screen-saver");
  suggestionsWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  });
  // Default click-through
  suggestionsWindow.setIgnoreMouseEvents(true, { forward: true });

  // Allow interaction on hover
  suggestionsWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "mouseMove") {
      suggestionsWindow.setIgnoreMouseEvents(false);
    }
  });
  suggestionsWindow.on("blur", () => {
    if (suggestionsWindow) suggestionsWindow.setIgnoreMouseEvents(true, { forward: true });
  });

  suggestionsWindow.on("closed", () => {
    suggestionsWindow = null;
  });

  // User-initiated focus handling for suggestions window
  suggestionsWindow.webContents.on('did-finish-load', () => {
    suggestionsWindow.webContents.executeJavaScript(`
      document.addEventListener('click', () => {
        require('electron').ipcRenderer.send('overlay-clicked', 'suggestions');
      });
    `);
  });





  return suggestionsWindow;
}

// ----- OCR / AI / Tracking -----
// Process OCR results and add to batch (called by scheduler)
async function processAppOCR(appInfo, reason = "app_switch") {
  try {
    sendToDebug("debug-update", {
      appName: appInfo.appName,
      windowTitle: appInfo.windowTitle,
      ocrLines: 0,
      backendStatus: "Queuing OCR job…",
      statusType: "waiting",
    });

    // Queue OCR job and wait for WebSocket completion
    try {
      const jobId = await ocrManager.captureAndQueueOCR({
        appName: appInfo.appName,
        windowTitle: appInfo.windowTitle,
        bundleId: appInfo.bundleId || appInfo.execName,
        session_id: currentSessionId
      }, currentUserId);

      if (jobId && ocrBatchManager) {
        // Queue the job in batch manager
        ocrBatchManager.queueOCRJob(jobId, {
          appName: appInfo.appName,
          windowTitle: appInfo.windowTitle,
          bundleId: appInfo.bundleId || appInfo.execName
        }, reason);

        sendToDebug("debug-update", {
          backendStatus: `OCR job ${jobId} queued for batch processing`,
          statusType: "waiting",
        });
      } else {
        sendToDebug("debug-update", {
          backendStatus: "No text detected",
          statusType: "waiting",
        });
      }
    } catch (ocrErr) {
      // OCR error
      sendToDebug("debug-update", {
        backendStatus: `OCR Error: ${ocrErr?.message || "OCR failure"}`,
        statusType: "error",
      });
    }
  } catch (err) {
    // Processing error
  }
}

// Process keystroke sequences and send to backend
async function processKeystrokeSequence(sequenceData) {
  try {
    // Process keystrokes

    // Send keystroke data to backend for analysis
    const response = await fetch('http://127.0.0.1:8000/api/ai/keystroke-analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: currentUserId,
        sequence_data: sequenceData,
        session_context: {
          current_activity: recentActivityData,
          timestamp: Date.now()
        }
      })
    });

    if (response.ok) {
      const result = await response.json();
      // Keystrokes processed

      // Update debug window with keystroke info
      sendToDebug("keystroke-update", {
        sequenceId: sequenceData.sequence_id,
        keystrokeCount: sequenceData.keystroke_count,
        patternsDetected: result.patterns_detected || 0,
        efficiency_score: result.efficiency_score || 'unknown'
      });
    } else {
      // Keystroke error
    }
  } catch (error) {
    // Keystroke processing error
  }
}

async function createUserSession() {
  try {
    // Create session

    // First check if there's already an active session and end it
    try {
      const existingSessionResponse = await fetch(`http://127.0.0.1:8000/api/activity/current-session/${currentUserId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (existingSessionResponse.ok) {
        const existingResult = await existingSessionResponse.json();
        // End existing session

        // End the existing session
        try {
          await fetch(`http://127.0.0.1:8000/api/activity/end-session/${existingResult.session_id}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          });
          // Session ended
        } catch (endError) {
          console.log(`⚠️ Could not end previous session: ${endError.message}`);
        }
      }
    } catch (existingError) {
      console.log("No existing session found, creating new one...");
    }

    // Generate session ID
    currentSessionId = generateUUID();

    // First ensure user profile exists
    try {
      const profileData = {
        id: currentUserId,
        email: `user_${currentUserId.slice(0, 8)}@example.com`,
        full_name: `User ${currentUserId.slice(0, 8)}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
        subscription_tier: "free",
        timezone: "UTC"
      };

      const profileResponse = await fetch("http://127.0.0.1:8000/api/activity/profiles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(profileData),
      });

      if (profileResponse.ok) {
        const profileResult = await profileResponse.json();
        console.log(`✅ Profile creation: ${profileResult.message}`);
      } else {
        console.error(`❌ Profile creation failed: ${profileResponse.status} ${profileResponse.statusText}`);
        const errorText = await profileResponse.text();
        console.error(`❌ Profile error details: ${errorText}`);
      }
    } catch (profileError) {
      // Profile might already exist, continue with session creation
    }

    // Create new session
    const sessionData = {
      id: currentSessionId,
      user_id: currentUserId,
      device_info: {
        platform: "electron",
        source: "main_app",
        app_version: "1.0.0"
      },
      session_start: new Date().toISOString(),
      session_type: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const sessionResponse = await fetch("http://127.0.0.1:8000/api/activity/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionData),
    });

    if (sessionResponse.ok) {
      const sessionResult = await sessionResponse.json();
      currentSessionId = sessionResult.session_id; // Use the session ID returned by backend
      console.log(`✅ Successfully created session ${currentSessionId}`);
    } else {
      console.error(`❌ Failed to create session: ${sessionResponse.status} ${sessionResponse.statusText}`);
    }
  } catch (error) {
    console.error("❌ Error creating session:", error);
  }
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function setupPipelines() {
  ocrManager = new OCRManager(suggestionsWindow);
  ocrBatchManager = new OCRBatchManager();

  // Set up WebSocket handler for OCR completion to trigger batch processing
  ocrManager.wsManager.onOCRJobComplete((data) => {
    if (ocrBatchManager) {
      const meaningfulContext = data.app_context?.meaningful_context || "";
      ocrBatchManager.onOCRJobComplete(data.job_id, data.text_lines, meaningfulContext);
    }
  });

  // Initialize OCR WebSocket connection
  if (currentUserId && currentSessionId) {
    ocrManager.connectWebSocket(currentUserId, currentSessionId).then((connected) => {
      if (connected) {
        console.log('✅ OCR Manager WebSocket connected');
      } else {
        console.log('❌ Failed to connect OCR Manager WebSocket');
      }
    });
  }

  aiAssistant = new AIAssistant();

  // Initialize keystroke collector
  keystrokeCollector = new EfficientKeystrokeCollector(processKeystrokeSequence);

  // Initialize smart OCR scheduler
  smartOCRScheduler = new SmartOCRScheduler(500);
  smartOCRScheduler.setProcessCallback(processAppOCR);

  // Make scheduler globally available for activity tracker
  global.smartOCRScheduler = smartOCRScheduler;

  activityTracker = new ComprehensiveActivityTracker((activityData) => {
    try {
      console.log("📊 Activity data received:", {
        eventsCount: activityData?.events?.length || 0,
        sessionStats: activityData?.sessionStats || {},
      });
      recentActivityData = activityData;
    } catch (e) {
      console.error("Activity tracker callback error:", e);
    }
  }, currentUserId, currentSessionId);

  // Set OCR manager reference for smart triggering
  activityTracker.ocrManager = ocrManager;

  appTracker = new ActiveAppTracker(ocrManager, async (appInfo) => {
    try {
      // Prevent self-detection feedback loops (immediate check)
      const SQUIRE_APP_IDENTIFIERS = [
        'Squire',
        'squire-electron',
        'squire',
      ];

      const isSquireApp = SQUIRE_APP_IDENTIFIERS.some(identifier =>
        appInfo.appName?.includes(identifier) ||
        appInfo.execName?.includes(identifier) ||
        appInfo.windowTitle?.includes('Squire')
      );

      if (isSquireApp) {
        // Check if this is user-initiated focus
        if (skipNextOCR) {
          console.log('🚫 Skipping OCR due to user-initiated focus of Squire');
          skipNextOCR = false; // Reset for next time
          return;
        }
        console.log('🚫 Ignoring self-focus, staying with previous app:', appInfo.appName);
        return; // Skip processing our own app
      }

      // Update keystroke collector context
      if (keystrokeCollector) {
        keystrokeCollector.updateContext({
          app_name: appInfo.appName,
          window_title: appInfo.windowTitle,
          bundle_id: appInfo.bundleId || appInfo.execName,
          timestamp: Date.now()
        });
      }

      // Schedule smart OCR processing for valid apps
      smartOCRScheduler.scheduleOCR(appInfo, "app_switch");

    } catch (err) {
      console.error("Error in appTracker callback:", err);
    }
  });

  setTimeout(async () => {
    console.log("🚀 Starting trackers…");
    try {
      appTracker.startTracking();
    } catch (e) {
      console.error("App tracker failed to start:", e);
      if (process.platform === "darwin") {
        dialog.showMessageBox({
          type: "warning",
          title: "Permissions Required",
          message:
            "Squire needs Accessibility and Screen Recording permissions.\n\n" +
            "Open System Settings → Privacy & Security:\n" +
            "• Accessibility → enable Squire\n" +
            "• Screen Recording → enable Squire\n\n" +
            "Then quit and relaunch Squire.",
          buttons: ["OK"],
        });
      }
    }
    try {
      await activityTracker.startTracking();
    } catch (e) {
      console.error("Activity tracker failed to start:", e);
    }
    try {
      keystrokeCollector.startTracking();
    } catch (e) {
      console.error("Keystroke collector failed to start:", e);
    }
  }, 800);
}

// ----- App Event Handlers -----
app.whenReady().then(async () => {
  createMainWindow();
  createDebugWindow();
  createSuggestionsWindow();

  // Create session first, then setup pipelines
  await createUserSession();
  setupPipelines();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createDebugWindow();
      createSuggestionsWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  console.log("🛑 App shutting down, cleaning up...");

  // Clean up keystroke collector
  if (keystrokeCollector) {
    keystrokeCollector.stopTracking();
  }

  // Clean up other trackers
  if (appTracker) {
    appTracker.stopTracking();
  }

  if (activityTracker) {
    activityTracker.stopTracking();
  }
});

// ----- IPC Handlers -----
ipcMain.handle("get-screen-info", () => {
  const displays = screen.getAllDisplays();
  return displays.map((display) => ({
    id: display.id,
    bounds: display.bounds,
    workArea: display.workArea,
  }));
});

ipcMain.on("debug-set-ignore-mouse-events", (event, ignore, options) => {
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.setIgnoreMouseEvents(ignore, options);
  }
});

ipcMain.on("suggestions-set-ignore-mouse-events", (event, ignore, options) => {
  if (suggestionsWindow && !suggestionsWindow.isDestroyed()) {
    suggestionsWindow.setIgnoreMouseEvents(ignore, options);
  }
});

// Handle overlay clicks - user wants to focus the app
ipcMain.on("overlay-clicked", (event, overlayType) => {
  console.log(`🖱️ User clicked ${overlayType} overlay - focusing main window`);

  // Show and focus the main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }

  // Skip the next OCR when Squire comes into focus
  skipNextOCR = true;
});

