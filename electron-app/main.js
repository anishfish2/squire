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
let appSwitchDebouncer = null; // For debounced OCR processing

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

// ----- App Switch Debouncer -----
class AppSwitchDebouncer {
  constructor(delay = 500) {
    this.delay = delay;
    this.pendingApp = null;
    this.timeout = null;
    this.processCallback = null;
  }

  setProcessCallback(callback) {
    this.processCallback = callback;
  }

  scheduleOCR(appInfo) {
    // Cancel previous pending OCR
    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    // Store the latest app
    this.pendingApp = appInfo;

    console.log(`⏱️ Debouncing app switch to: ${appInfo.appName} (${this.delay}ms)`);

    // Schedule OCR after delay
    this.timeout = setTimeout(() => {
      if (this.pendingApp && this.processCallback) {
        console.log(`🎯 Processing settled app: ${this.pendingApp.appName}`);
        this.processCallback(this.pendingApp);
      }
      this.pendingApp = null;
      this.timeout = null;
    }, this.delay);
  }

  cancel() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
      this.pendingApp = null;
    }
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
// Process OCR results and generate AI suggestions (called by debouncer)
async function processAppOCR(appInfo) {
  try {
    sendToDebug("debug-update", {
      appName: appInfo.appName,
      windowTitle: appInfo.windowTitle,
      ocrLines: 0,
      backendStatus: "Queuing OCR job…",
      statusType: "waiting",
    });

    // Process OCR with job queue system
    try {
      const ocrResults = await ocrManager.captureAndRecognize({
        appName: appInfo.appName,
        windowTitle: appInfo.windowTitle,
        bundleId: appInfo.bundleId || appInfo.execName,
        session_id: currentSessionId
      }, currentUserId);

      sendToDebug("debug-update", {
        ocrLines: Array.isArray(ocrResults) ? ocrResults.length : 0,
        backendStatus: "OCR completed, generating suggestions…",
        statusType: "waiting",
      });

      if (Array.isArray(ocrResults) && ocrResults.length > 0) {
        const enrichedContext = {
          ...appInfo,
          userId: currentUserId,
          ocrResults,
          recentActivity: recentActivityData,
          timestamp: Date.now(),
        };

        try {
          const suggestions = await aiAssistant.generateSuggestions(
            enrichedContext,
            ocrResults
          );

          sendToDebug("debug-update", {
            backendStatus: "Success",
            statusType: "success",
            suggestions: Array.isArray(suggestions) ? suggestions.length : 0,
          });

          sendToSuggestions("ocr-results", {
            appName: appInfo.appName,
            windowTitle: appInfo.windowTitle,
            textLines: ocrResults,
            aiSuggestions: suggestions || [],
          });
        } catch (err) {
          console.error("❌ AI suggestion error:", err);
          sendToDebug("debug-update", {
            backendStatus: `Error: ${err?.message || "AI failure"}`,
            statusType: "error",
          });
        }
      } else {
        sendToDebug("debug-update", {
          backendStatus: "No text detected",
          statusType: "waiting",
        });
      }
    } catch (ocrErr) {
      console.error("❌ OCR processing error:", ocrErr);
      sendToDebug("debug-update", {
        backendStatus: `OCR Error: ${ocrErr?.message || "OCR failure"}`,
        statusType: "error",
      });
    }
  } catch (err) {
    console.error("Error processing app OCR:", err);
  }
}

// Process keystroke sequences and send to backend
async function processKeystrokeSequence(sequenceData) {
  try {
    console.log(`🎹 Processing keystroke sequence: ${sequenceData.keystroke_count} keystrokes over ${sequenceData.sequence_duration}ms`);

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
      console.log(`✅ Keystroke sequence processed: ${result.patterns_detected || 0} patterns detected`);

      // Update debug window with keystroke info
      sendToDebug("keystroke-update", {
        sequenceId: sequenceData.sequence_id,
        keystrokeCount: sequenceData.keystroke_count,
        patternsDetected: result.patterns_detected || 0,
        efficiency_score: result.efficiency_score || 'unknown'
      });
    } else {
      console.error('❌ Failed to process keystroke sequence:', response.statusText);
    }
  } catch (error) {
    console.error('❌ Error processing keystroke sequence:', error);
  }
}

async function createUserSession() {
  try {
    console.log("🔄 Creating user session...");

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
        console.log(`📋 Found existing active session ${existingResult.session_id}, ending it...`);

        // End the existing session
        try {
          await fetch(`http://127.0.0.1:8000/api/activity/end-session/${existingResult.session_id}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
          });
          console.log(`✅ Ended previous session ${existingResult.session_id}`);
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
  aiAssistant = new AIAssistant();

  // Initialize keystroke collector
  keystrokeCollector = new EfficientKeystrokeCollector(processKeystrokeSequence);

  // Initialize debouncer
  appSwitchDebouncer = new AppSwitchDebouncer(500);
  appSwitchDebouncer.setProcessCallback(processAppOCR);

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

      // Schedule debounced OCR processing for valid apps
      appSwitchDebouncer.scheduleOCR(appInfo);

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

