import { app, BrowserWindow, screen, ipcMain, Menu, dialog, systemPreferences, globalShortcut } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

import process from 'process';
import OCRManager from './ocr-manager.js'
import ActiveAppTracker from './app-tracker.js'
import ComprehensiveActivityTracker from './activity-tracker.js'
import AIAssistant from './ai-assistant.js'
import EfficientKeystrokeCollector from './keystroke-collector.js'
import VisionScheduler from './vision-scheduler.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow;
let debugWindow;
let suggestionsWindow; // Legacy - will be removed
let dotWindow;
let suggestionsBoxWindow;
let forceButtonWindow;
let settingsWindow;
let ocrManager;
let appTracker;
let activityTracker;
let aiAssistant;
let keystrokeCollector;
let visionScheduler;
let recentActivityData = null;
let skipNextOCR = false;
let smartOCRScheduler = null;
let ocrBatchManager = null;

let currentUserId = "550e8400-e29b-41d4-a716-446655440000";
let currentSessionId = null;

// Track detected apps for settings UI
let detectedApps = new Set();
let appPreferences = new Map(); // Cache of app preferences

// For macOS transparency to work:
// - Keep GPU and hardware acceleration ENABLED
// - Use type: 'toolbar' window type
// - Do NOT use disable-gpu, disable-gpu-compositing, or disableHardwareAcceleration()

if (process.platform === 'darwin') {
  app.dock.hide(); // Hide from dock to avoid window manager interference
}


function sendToDebug(channel, data) {
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.webContents.send(channel, data);
  }
}

function sendToSuggestions(channel, data) {
  // Send to suggestions box window
  if (suggestionsBoxWindow && !suggestionsBoxWindow.isDestroyed()) {
    suggestionsBoxWindow.webContents.send(channel, data);
  }

  // Also send to dot window for notification count updates, etc.
  if (dotWindow && !dotWindow.isDestroyed()) {
    dotWindow.webContents.send(channel, data);
  }
}

function sendToSettings(channel, data) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send(channel, data);
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
    this.isProcessing = false;
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


      this.pendingOCRJobs.delete(jobId);

      this.checkBatchReadiness();
    }
  }

  checkBatchReadiness() {
    if (this.pendingBatch.length === 0) return;

    const allCompleted = this.pendingBatch.every(item => item.ocrCompleted);
    const batchFull = this.pendingBatch.length >= this.maxBatchSize;

    // Trigger 1: All OCR jobs completed
    if (allCompleted) {
      this.processBatch();
      return;
    }

    // Log status if batch is full but not all completed
    if (batchFull) {
      const completedCount = this.pendingBatch.filter(item => item.ocrCompleted).length;
    }

    // Trigger 2: Timeout - process if at least 1 job completed
    if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => {
        const completedCount = this.pendingBatch.filter(item => item.ocrCompleted).length;

        if (completedCount > 0) {
          this.processBatch();
        } else {
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


    try {
      await this.sendBatchToLLM(batch, sequenceId);
    } catch (error) {
      console.error('❌ Error processing batch:', error);
    }
  }

  async sendBatchToLLM(batch, sequenceId) {
    console.log(`📊 [Batch] Preparing to send batch with ${batch.length} apps`);

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

    console.log(`📊 [Batch] Sending batch to AI assistant...`);

    if (aiAssistant) {
      const suggestions = await aiAssistant.processBatchRequest(batchRequest);


      if (suggestions && suggestions.length > 0) {
        console.log(`🤖 [AI] Received ${suggestions.length} suggestions`);
        const payload = {
          textLines: [],
          appName: batchRequest.app_sequence[batchRequest.app_sequence.length - 1]?.appName || 'Multiple Apps',
          windowTitle: 'Batch Analysis',
          aiSuggestions: suggestions
        };
        sendToSuggestions('ai-suggestions', payload);

        // Show the suggestions box window
        if (suggestionsBoxWindow && !suggestionsBoxWindow.isDestroyed()) {
          suggestionsBoxWindow.show();
          console.log('📦 [MAIN] Showing suggestions box with AI suggestions');
        }
        // Hide the dot window
        if (dotWindow && !dotWindow.isDestroyed()) {
          dotWindow.hide();
        }
      } else {
        console.log(`🤖 [AI] No suggestions generated`);
      }
    } else {
      console.error('❌ AI assistant not initialized');
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

  async forceBatchSubmission() {
    // Edge Case 1: Empty batch
    if (this.pendingBatch.length === 0) {
      return {
        status: 'empty',
        message: 'No activity to analyze. Switch between apps to collect data.'
      };
    }

    // Edge Case 2: Already processing (check if processBatch is running)
    if (this.isProcessing) {
      return {
        status: 'busy',
        message: 'Already processing suggestions. Please wait.'
      };
    }

    // Edge Case 3: No AI assistant initialized
    if (!aiAssistant) {
      return {
        status: 'error',
        message: 'AI assistant not initialized.'
      };
    }

    // Edge Case 4: Missing user/session ID
    if (!currentUserId || !currentSessionId) {
      return {
        status: 'error',
        message: 'User session not initialized.'
      };
    }

    // Edge Case 5: Wait briefly for pending OCR jobs (simpler approach - submit immediately)
    const incompletejobs = this.pendingBatch.filter(item => !item.ocrCompleted).length;
    if (incompletejobs > 0) {
      console.log(`⚠️ Force submit: ${incompletejobs} OCR jobs still pending, submitting anyway...`);
    }

    // Mark as processing
    this.isProcessing = true;

    // Clear scheduled batch timeout to prevent double submission
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    try {
      // Copy batch for sending (don't clear yet in case of failure)
      const batch = [...this.pendingBatch];
      const sequenceId = this.currentSequenceId;

      // Send to LLM
      await this.sendBatchToLLM(batch, sequenceId);

      // Only clear batch state on success
      this.pendingBatch = [];
      this.pendingOCRJobs.clear();
      this.currentSequenceId = null;

      return {
        status: 'success',
        message: `Analyzed ${batch.length} app(s)`,
        count: batch.length
      };

    } catch (error) {
      console.error('❌ Force batch submission error:', error);

      // On API failure, keep batch intact for retry
      // Re-enable batch timeout for automatic processing
      if (!this.batchTimeout) {
        this.batchTimeout = setTimeout(() => {
          this.checkBatchReadiness();
        }, this.batchWindow);
      }

      return {
        status: 'error',
        message: `Failed to analyze: ${error.message}`,
        canRetry: true
      };
    } finally {
      this.isProcessing = false;
    }
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
    skipTaskbar: false,
    focusable: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}/debug/index.html`);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/debug/index.html'));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}





function createDotWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  dotWindow = new BrowserWindow({
    width: 56,
    height: 56,
    x: width - 82,
    y: 20,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    acceptFirstMouse: true,
    fullscreenable: false,
    alwaysOnTop: true,
    type: 'panel',
    roundedCorners: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    dotWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}/dot/index.html`);
  } else {
    dotWindow.loadFile(path.join(__dirname, '../renderer/dot/index.html'));
  }

  dotWindow.once("ready-to-show", () => {
    dotWindow.setAlwaysOnTop(true, "screen-saver");
    dotWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    dotWindow.show();
  });

  dotWindow.webContents.on('did-finish-load', () => {
    dotWindow.webContents.insertCSS('html, body, * { background: transparent !important; background-color: transparent !important; }');
  });

  return dotWindow;
}

function createSuggestionsBoxWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  suggestionsBoxWindow = new BrowserWindow({
    width: 420,
    height: 520,
    x: width - 435,  // right-[15px]
    y: 20,  // top-5
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    skipTaskbar: true,
    focusable: true,
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,  // Hidden by default
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    suggestionsBoxWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}/suggestions-box/index.html`);
  } else {
    suggestionsBoxWindow.loadFile(path.join(__dirname, '../renderer/suggestions-box/index.html'));
  }

  suggestionsBoxWindow.once("ready-to-show", () => {
    suggestionsBoxWindow.setAlwaysOnTop(true, "screen-saver");
    suggestionsBoxWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  });

  return suggestionsBoxWindow;
}

function createForceButtonWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  forceButtonWindow = new BrowserWindow({
    width: 32,  // 8 * 4 (2rem)
    height: 32,
    x: width - 62,  // right-[30px]
    y: 90,  // top-[90px]
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', // Fully transparent
    resizable: false,
    movable: true,
    skipTaskbar: true,
    focusable: true,
    fullscreenable: false,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    forceButtonWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}/force-button/index.html`);
  } else {
    forceButtonWindow.loadFile(path.join(__dirname, '../renderer/force-button/index.html'));
  }

  forceButtonWindow.once("ready-to-show", () => {
    forceButtonWindow.show();
    forceButtonWindow.setAlwaysOnTop(true, "screen-saver");
    forceButtonWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  });

  return forceButtonWindow;
}

function createSuggestionsWindow() {
  createDotWindow();
  createSuggestionsBoxWindow();
  createForceButtonWindow();

  return dotWindow;
}

function createSettingsWindow() {

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  settingsWindow = new BrowserWindow({
    width: 800,
    height: 600,
    x: Math.round((width - 800) / 2),
    y: Math.round((height - 600) / 2),
    frame: false,
    transparent: false,
    resizable: true,
    movable: true,
    skipTaskbar: false,
    focusable: true,
    fullscreenable: false,
    alwaysOnTop: false,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}/settings/index.html`).then(() => {
    }).catch(err => {
      console.error('❌ Failed to load settings window:', err);
    });
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../renderer/settings/index.html')).then(() => {
    }).catch(err => {
      console.error('❌ Failed to load settings window:', err);
    });
  }

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  settingsWindow.on('ready-to-show', () => {
    settingsWindow.show();
  });

  return settingsWindow;
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
      const existingSessionResponse = await fetch(`http://127.0.0.1:8000/api/activity/current-session/${currentUserId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (existingSessionResponse.ok) {
        const existingResult = await existingSessionResponse.json();

        try {
          await fetch(`http://127.0.0.1:8000/api/activity/end-session/${existingResult.session_id}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          });
        } catch (endError) {
        }
      }
    } catch (existingError) {
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

      const profileResponse = await fetch("http://127.0.0.1:8000/api/activity/profiles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(profileData),
      });

      if (profileResponse.ok) {
        const profileResult = await profileResponse.json();
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

    const sessionResponse = await fetch("http://127.0.0.1:8000/api/activity/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionData),
    });

    if (sessionResponse.ok) {
      const sessionResult = await sessionResponse.json();
      currentSessionId = sessionResult.session_id;
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
      } else {
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
      sendToDebug("activity-update", {
        eventsCount: activityData?.events?.length || 0,
        sessionStats: activityData?.sessionStats || {},
      });
      recentActivityData = activityData;
    } catch (e) {
      console.error("Activity tracker callback error:", e);
    }
  }, currentUserId, currentSessionId);

  activityTracker.ocrManager = ocrManager;

  // Initialize VisionScheduler
  visionScheduler = new VisionScheduler('http://127.0.0.1:8000', currentUserId, currentSessionId);
  visionScheduler.startScheduling();

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
          skipNextOCR = false;
          return;
        }
        return;
      }

      // Track detected app for settings UI
      if (appInfo.appName) {
        const wasNewApp = !detectedApps.has(appInfo.appName);
        detectedApps.add(appInfo.appName);

        // Broadcast to settings window if it's open
        if (wasNewApp) {
          sendToSettings('app-detected', {
            appName: appInfo.appName,
            allApps: Array.from(detectedApps)
          });
        }

        // Update VisionScheduler with current app
        if (visionScheduler) {
          visionScheduler.updateCurrentApp(appInfo.appName);
        }
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
  // createDebugWindow();  // Hidden per user request
  createSuggestionsWindow();

  // Set up application menu
  const template = [
    {
      label: 'Squire',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            createSettingsWindow();
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Register global shortcut for settings
  globalShortcut.register('CmdOrCtrl+Shift+S', () => {
    createSettingsWindow();
  });

  await createUserSession();
  setupPipelines();

  if (process.platform === "darwin") {

    // Log initial state
    setTimeout(() => {
      if (debugWindow && !debugWindow.isDestroyed()) {
        console.log("Debug window state:", {
          isVisible: debugWindow.isVisible(),
          isAlwaysOnTop: debugWindow.isAlwaysOnTop(),
          bounds: debugWindow.getBounds()
        });
      }
      if (suggestionsWindow && !suggestionsWindow.isDestroyed()) {
        console.log("Suggestions window state:", {
          isVisible: suggestionsWindow.isVisible(),
          isAlwaysOnTop: suggestionsWindow.isAlwaysOnTop(),
          bounds: suggestionsWindow.getBounds()
        });
      }
    }, 1000);

    systemPreferences.subscribeNotification(
      "NSWorkspaceActiveSpaceDidChangeNotification",
      () => {

        // Re-apply settings for debug window
        if (debugWindow && !debugWindow.isDestroyed()) {
          debugWindow.setAlwaysOnTop(true, "screen-saver");
          debugWindow.setVisibleOnAllWorkspaces(true, {
            visibleOnFullScreen: true,
            skipTransformProcessType: true,
          });
          debugWindow.show();  // Force show
        }

        // Re-apply settings for suggestions window
        if (suggestionsWindow && !suggestionsWindow.isDestroyed()) {
          suggestionsWindow.setAlwaysOnTop(true, "screen-saver");
          suggestionsWindow.setVisibleOnAllWorkspaces(true, {
            visibleOnFullScreen: true,
            skipTransformProcessType: true,
          });
          suggestionsWindow.show();  // Force show
        }

      }
    );
  }

  // 🚀 Enforce overlay windows persistence across ALL workspace events
  // This catches cases where macOS tries to reset window levels
  app.on("browser-window-created", (event, window) => {
    // Re-enforce settings for suggestions window
    if (suggestionsWindow && !suggestionsWindow.isDestroyed() && window === suggestionsWindow) {
      setTimeout(() => {
        suggestionsWindow.setAlwaysOnTop(true, "screen-saver");
        suggestionsWindow.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
          skipTransformProcessType: true,
        });
      }, 100);
    }

    // Re-enforce settings for debug window
    if (debugWindow && !debugWindow.isDestroyed() && window === debugWindow) {
      setTimeout(() => {
        debugWindow.setAlwaysOnTop(true, "screen-saver");
        debugWindow.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
          skipTransformProcessType: true,
        });
      }, 100);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      // createDebugWindow();  // Hidden per user request
      createSuggestionsWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("browser-window-created", (_, win) => {
  win.on("show", () => {
    win.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setFullScreenable(false);
  });
});

app.on("before-quit", () => {

  if (visionScheduler) {
    visionScheduler.stopScheduling();
  }

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

// Toggle suggestions box visibility
ipcMain.on("toggle-suggestions-box", (event, show) => {
  console.log('🔄 [MAIN] Toggle suggestions box:', show);
  if (suggestionsBoxWindow && !suggestionsBoxWindow.isDestroyed()) {
    if (show) {
      suggestionsBoxWindow.show();
    } else {
      suggestionsBoxWindow.hide();
    }
  }

  // Show/hide dot window (opposite of suggestions box)
  if (dotWindow && !dotWindow.isDestroyed()) {
    if (show) {
      dotWindow.hide();
    } else {
      dotWindow.show();
    }
  }
});

ipcMain.on("move-dot-window", (event, x, y) => {
  if (dotWindow && !dotWindow.isDestroyed()) {
    dotWindow.setPosition(Math.round(x), Math.round(y));
  }
});

ipcMain.on("set-dot-mouse-events", (event, ignore) => {
  if (dotWindow && !dotWindow.isDestroyed()) {
    dotWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

ipcMain.on("move-suggestions-box-window", (event, x, y) => {
  if (suggestionsBoxWindow && !suggestionsBoxWindow.isDestroyed()) {
    suggestionsBoxWindow.setPosition(Math.round(x), Math.round(y));
  }
});

ipcMain.on("move-force-button-window", (event, x, y) => {
  if (forceButtonWindow && !forceButtonWindow.isDestroyed()) {
    forceButtonWindow.setPosition(Math.round(x), Math.round(y));
  }
});

// Force suggestion request handler
ipcMain.handle("force-suggestion-request", async (event) => {
  console.log('🔍 Force suggestion request received');

  if (!ocrBatchManager) {
    return {
      status: 'error',
      message: 'Batch manager not initialized'
    };
  }

  try {
    const result = await ocrBatchManager.forceBatchSubmission();
    console.log('Force suggestion result:', result);
    return result;
  } catch (error) {
    console.error('Error handling force suggestion request:', error);
    return {
      status: 'error',
      message: error.message || 'Unknown error occurred'
    };
  }
});

ipcMain.on("move-renderer-window", (event, x, y) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setPosition(Math.round(x), Math.round(y));
  }
});

ipcMain.on("overlay-clicked", (event, overlayType) => {

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }

  skipNextOCR = true;
});

// Settings window IPC handlers
ipcMain.on("close-settings", () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
});

ipcMain.on("get-detected-apps", (event) => {
  event.reply("detected-apps", Array.from(detectedApps));
});

ipcMain.on("load-app-preferences", async (event) => {
  try {

    const response = await fetch(`http://127.0.0.1:8000/api/vision/preferences/${currentUserId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      const prefs = await response.json();
      event.reply("app-preferences-loaded", prefs);
    } else {
      console.error(`❌ [Main] Failed to load app preferences: ${response.status}`);
      event.reply("app-preferences-loaded", []);
    }
  } catch (error) {
    console.error("❌ [Main] Error loading app preferences:", error);
    event.reply("app-preferences-loaded", []);
  }
});

ipcMain.on("update-app-preference", async (event, { appName, updates }) => {
  try {

    const response = await fetch(`http://127.0.0.1:8000/api/vision/preferences/${currentUserId}/${appName}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    });

    if (response.ok) {
      const result = await response.json();

      // Update local cache
      appPreferences.set(appName, { ...appPreferences.get(appName), ...updates });

      // Refresh VisionScheduler preferences for this app
      if (visionScheduler) {
        visionScheduler.refreshAppPreference(appName);
      }

      // Send confirmation back with full updated preference
      event.reply("preference-updated", { appName, updates: result.data || updates });
    } else {
      const errorText = await response.text();
      console.error(`❌ [Main] Failed to update preference for "${appName}": ${response.status}`, errorText);
    }
  } catch (error) {
    console.error(`❌ [Main] Error updating preference for "${appName}":`, error);
  }
});

ipcMain.on("toggle-global-vision", (event, enabled) => {

  if (visionScheduler) {
    visionScheduler.setGlobalVisionEnabled(enabled);
  }
});

ipcMain.on('dot-drag', (evt, phase) => {
  // Removed - type: 'toolbar' handles transparency correctly
})


