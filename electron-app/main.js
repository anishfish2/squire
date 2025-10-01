const { app, BrowserWindow, screen, ipcMain, Menu, dialog } = require("electron");
const path = require("path");

const OCRManager = require("./ocr-manager");
const ActiveAppTracker = require("./app-tracker");
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
let skipNextOCR = false;
let smartOCRScheduler = null;
let ocrBatchManager = null;

let currentUserId = "550e8400-e29b-41d4-a716-446655440000";
let currentSessionId = null;

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

class SmartOCRScheduler {
  constructor(delay = 500) {
    this.delay = delay;
    this.timeout = null;
    this.fallbackTimeout = null;
    this.pendingApp = null;
    this.processCallback = null;
    this.lastOCRTime = 0;
    this.minTimeBetweenOCR = 5000;
    this.fallbackInterval = 30000;
    this.lastAppInfo = null;

    this.startFallbackTimer();
  }

  setProcessCallback(callback) {
    this.processCallback = callback;
  }

  scheduleOCR(appInfo, reason = "app_switch") {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    const now = Date.now();
    if (now - this.lastOCRTime < this.minTimeBetweenOCR) {
      this.pendingApp = appInfo;
      this.timeout = setTimeout(() => {
        this.executeOCR(appInfo, reason);
      }, this.minTimeBetweenOCR - (now - this.lastOCRTime));
      return;
    }

    this.pendingApp = appInfo;

    this.timeout = setTimeout(() => {
      this.executeOCR(appInfo, reason);
    }, this.delay);
  }

  executeOCR(appInfo, reason) {
    if (this.pendingApp && this.processCallback) {
      this.lastOCRTime = Date.now();
      this.lastAppInfo = appInfo;
      this.processCallback(appInfo, reason);
    }
  }

  startFallbackTimer() {
    this.fallbackTimeout = setInterval(() => {
      const now = Date.now();
      if (now - this.lastOCRTime > this.fallbackInterval && this.lastAppInfo) {
        this.executeOCR(this.lastAppInfo, 'fallback_timer');
      }
    }, this.fallbackInterval);
  }

  triggerImmediateOCR(appInfo, reason) {
    const now = Date.now();
    if (now - this.lastOCRTime < 3000) {
      return;
    }

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

class OCRBatchManager {
  constructor() {
    this.pendingBatch = [];
    this.batchTimeout = null;
    this.batchWindow = 30000;
    this.maxBatchSize = 5;
    this.currentSequenceId = null;
    this.pendingOCRJobs = new Map();
  }

  async queueOCRJob(jobId, appContext, reason = "unknown") {
    const now = Date.now();

    if (this.pendingBatch.length === 0) {
      this.currentSequenceId = `seq_${now}_${Math.random().toString(36).substr(2, 9)}`;
    }

    const batchItem = {
      timestamp: now,
      appName: appContext.appName,
      windowTitle: appContext.windowTitle,
      bundleId: appContext.bundleId,
      ocrText: [],
      meaningful_context: "",
      sequence: this.pendingBatch.length,
      trigger_reason: reason,
      duration_in_app: this.calculateAppDuration(appContext.appName),
      jobId: jobId,
      ocrCompleted: false
    };

    this.pendingBatch.push(batchItem);
    this.pendingOCRJobs.set(jobId, batchItem);

    console.log(`📦 Queued OCR job ${jobId} for batch: ${appContext.appName} (${this.pendingBatch.length}/${this.maxBatchSize})`);

    if (this.batchTimeout) clearTimeout(this.batchTimeout);

    this.checkBatchReadiness();
  }

  onOCRJobComplete(jobId, ocrText, meaningfulContext, appContext, extractedEntities) {
    const batchItem = this.pendingOCRJobs.get(jobId);
    if (batchItem) {
      batchItem.ocrText = ocrText || [];
      batchItem.meaningful_context = meaningfulContext || "";
      batchItem.application_type = appContext?.application_type || "";
      batchItem.interaction_context = appContext?.interaction_context || "";
      batchItem.extracted_entities = extractedEntities || [];
      batchItem.ocrCompleted = true;

      console.log(`✅ OCR job ${jobId} completed for ${batchItem.appName} (${ocrText?.length || 0} lines)`);

      this.pendingOCRJobs.delete(jobId);

      this.checkBatchReadiness();
    }
  }

  checkBatchReadiness() {
    if (this.pendingBatch.length === 0) return;

    const allCompleted = this.pendingBatch.every(item => item.ocrCompleted);
    const batchFull = this.pendingBatch.length >= this.maxBatchSize;

    if (allCompleted) {
      console.log(`📦 Batch ready: all OCR completed (${this.pendingBatch.length}/${this.maxBatchSize})`);
      this.processBatch();
      return;
    }

    if (batchFull) {
      const completedCount = this.pendingBatch.filter(item => item.ocrCompleted).length;
      const completionRate = completedCount / this.pendingBatch.length;

      if (completionRate >= 0.5) {
        console.log(`📦 Batch ready: batch full with ${completionRate * 100}% OCR completed (${completedCount}/${this.pendingBatch.length})`);
        this.processBatch();
        return;
      } else {
        console.log(`⏳ Batch full but waiting for more OCR: ${completedCount}/${this.pendingBatch.length} completed`);
      }
    }

    if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => {
        const completedCount = this.pendingBatch.filter(item => item.ocrCompleted).length;
        console.log(`⏰ Batch timeout reached: ${completedCount}/${this.pendingBatch.length} OCR jobs completed`);

        if (completedCount > 0) {
          this.processBatch();
        } else {
          console.log(`⚠️ No OCR completed yet, extending timeout...`);
          this.batchTimeout = null;
          this.checkBatchReadiness();
        }
      }, this.batchWindow);
    }
  }

  calculateAppDuration(appName) {
    if (!this.lastAppSwitch) return 0;
    return Date.now() - this.lastAppSwitch;
  }

  async processBatch() {
    if (this.pendingBatch.length === 0) return;

    const batch = [...this.pendingBatch];
    const sequenceId = this.currentSequenceId;

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
    const sequenceMetadata = {
      sequence_id: sequenceId,
      total_apps: batch.length,
      sequence_duration: batch[batch.length - 1]?.timestamp - batch[0]?.timestamp,
      rapid_switching: batch.length > 2 && (batch[batch.length - 1]?.timestamp - batch[0]?.timestamp) < 10000,
      unique_apps: new Set(batch.map(b => b.appName)).size,
      trigger_reasons: batch.map(b => b.trigger_reason),
      workflow_pattern: this.analyzeWorkflowPattern(batch)
    };

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

    if (aiAssistant) {
      const result = await aiAssistant.processBatchRequest(batchRequest);

      console.log(`📦 Batch submitted for sequence ${sequenceId} - awaiting SSE results`);
    }
  }

  analyzeWorkflowPattern(batch) {
    const apps = batch.map(b => b.appName);

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

  forceProcessBatch() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }
    this.processBatch();
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
    skipTaskbar: false,
    focusable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

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
    focusable: false,
    visibleOnAllWorkspaces: true,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  debugWindow.loadFile("debug.html");

  debugWindow.setAlwaysOnTop(true, "screen-saver");
  debugWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  });

  debugWindow.setIgnoreMouseEvents(true, { forward: true });

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
    focusable: false,
    visibleOnAllWorkspaces: true,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  suggestionsWindow.loadFile("suggestions.html");

  suggestionsWindow.setAlwaysOnTop(true, "screen-saver");
  suggestionsWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  });
  suggestionsWindow.setIgnoreMouseEvents(true, { forward: true });

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

  suggestionsWindow.webContents.on('did-finish-load', () => {
    suggestionsWindow.webContents.executeJavaScript(`
      document.addEventListener('click', () => {
        require('electron').ipcRenderer.send('overlay-clicked', 'suggestions');
      });
    `);
  });





  return suggestionsWindow;
}

async function processAppOCR(appInfo, reason = "app_switch") {
  try {
    sendToDebug("debug-update", {
      appName: appInfo.appName,
      windowTitle: appInfo.windowTitle,
      ocrLines: 0,
      backendStatus: "Queuing OCR job…",
      statusType: "waiting",
    });

    try {
      const jobId = await ocrManager.captureAndQueueOCR({
        appName: appInfo.appName,
        windowTitle: appInfo.windowTitle,
        bundleId: appInfo.bundleId || appInfo.execName,
        session_id: currentSessionId
      }, currentUserId);

      if (jobId && ocrBatchManager) {
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
      sendToDebug("debug-update", {
        backendStatus: `OCR Error: ${ocrErr?.message || "OCR failure"}`,
        statusType: "error",
      });
    }
  } catch (err) {
  }
}

async function processKeystrokeSequence(sequenceData) {
  try {

    const response = await fetch('http:
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

      sendToDebug("keystroke-update", {
        sequenceId: sequenceData.sequence_id,
        keystrokeCount: sequenceData.keystroke_count,
        patternsDetected: result.patterns_detected || 0,
        efficiency_score: result.efficiency_score || 'unknown'
      });
    } else {
    }
  } catch (error) {
  }
}

async function createUserSession() {
  try {

    try {
      const existingSessionResponse = await fetch(`http:
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (existingSessionResponse.ok) {
        const existingResult = await existingSessionResponse.json();

        try {
          await fetch(`http:
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          });
        } catch (endError) {
          console.log(`⚠️ Could not end previous session: ${endError.message}`);
        }
      }
    } catch (existingError) {
      console.log("No existing session found, creating new one...");
    }

    currentSessionId = generateUUID();

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

      const profileResponse = await fetch("http:
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
    }

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

    const sessionResponse = await fetch("http:
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionData),
    });

    if (sessionResponse.ok) {
      const sessionResult = await sessionResponse.json();
      currentSessionId = sessionResult.session_id;
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

  ocrManager.wsManager.onOCRJobComplete((data) => {
    if (ocrBatchManager) {
      const meaningfulContext = data.app_context?.meaningful_context || "";
      ocrBatchManager.onOCRJobComplete(
        data.job_id,
        data.text_lines,
        meaningfulContext,
        data.app_context,
        data.extracted_entities
      );
    }
  });

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

  keystrokeCollector = new EfficientKeystrokeCollector(processKeystrokeSequence);

  smartOCRScheduler = new SmartOCRScheduler(500);
  smartOCRScheduler.setProcessCallback(processAppOCR);

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

  activityTracker.ocrManager = ocrManager;

  appTracker = new ActiveAppTracker(ocrManager, async (appInfo) => {
    try {
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
        if (skipNextOCR) {
          console.log('🚫 Skipping OCR due to user-initiated focus of Squire');
          skipNextOCR = false;
          return;
        }
        console.log('🚫 Ignoring self-focus, staying with previous app:', appInfo.appName);
        return;
      }

      if (keystrokeCollector) {
        keystrokeCollector.updateContext({
          app_name: appInfo.appName,
          window_title: appInfo.windowTitle,
          bundle_id: appInfo.bundleId || appInfo.execName,
          timestamp: Date.now()
        });
      }

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

app.whenReady().then(async () => {
  createMainWindow();
  createDebugWindow();
  createSuggestionsWindow();

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

  if (keystrokeCollector) {
    keystrokeCollector.stopTracking();
  }

  if (appTracker) {
    appTracker.stopTracking();
  }

  if (activityTracker) {
    activityTracker.stopTracking();
  }
});

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

ipcMain.on("overlay-clicked", (event, overlayType) => {
  console.log(`🖱️ User clicked ${overlayType} overlay - focusing main window`);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }

  skipNextOCR = true;
});

