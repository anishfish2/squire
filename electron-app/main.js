// main.js
const { app, BrowserWindow, screen, ipcMain, Menu, dialog } = require("electron");
const path = require("path");

const OCRManager = require("./ocr-manager");
const ActiveAppTracker = require("./app-tracker"); // ✅ now uses @paymoapp/active-window
const ComprehensiveActivityTracker = require("./activity-tracker");
const AIAssistant = require("./ai-assistant");

let mainWindow;
let debugWindow;
let suggestionsWindow;
let ocrManager;
let appTracker;
let activityTracker;
let aiAssistant;
let recentActivityData = null;
let skipNextOCR = false; // For user-initiated focus handling
let appSwitchDebouncer = null; // For debounced OCR processing

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
    width: 350,
    height: 400,
    x: width - 370,
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
      ocrLines: Array.isArray(appInfo.ocrResults) ? appInfo.ocrResults.length : 0,
      backendStatus: appInfo.ocrResults ? "Processing OCR…" : "Waiting for OCR…",
      statusType: "waiting",
    });

    if (Array.isArray(appInfo.ocrResults) && appInfo.ocrResults.length > 0) {
      sendToDebug("debug-update", {
        backendStatus: "Calling backend…",
        statusType: "waiting",
      });

      const enrichedContext = {
        ...appInfo,
        recentActivity: recentActivityData,
        timestamp: Date.now(),
      };

      try {
        const suggestions = await aiAssistant.generateSuggestions(
          enrichedContext,
          appInfo.ocrResults
        );

        sendToDebug("debug-update", {
          backendStatus: "Success",
          statusType: "success",
          suggestions: Array.isArray(suggestions) ? suggestions.length : 0,
        });

        sendToSuggestions("ocr-results", {
          appName: appInfo.appName,
          windowTitle: appInfo.windowTitle,
          textLines: appInfo.ocrResults,
          aiSuggestions: suggestions || [],
        });
      } catch (err) {
        console.error("❌ AI suggestion error:", err);
        sendToDebug("debug-update", {
          backendStatus: `Error: ${err?.message || "AI failure"}`,
          statusType: "error",
        });
      }
    }
  } catch (err) {
    console.error("Error processing app OCR:", err);
  }
}

function setupPipelines() {
  ocrManager = new OCRManager(suggestionsWindow);
  aiAssistant = new AIAssistant();

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
  });

  appTracker = new ActiveAppTracker(ocrManager, async (appInfo) => {
    try {
      // Prevent self-detection feedback loops (immediate check)
      const SQUIRE_APP_IDENTIFIERS = [
        'Squire',
        'squire-electron',
        'Electron Helper',
        'Electron',
        'claude-code'
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

      // Schedule debounced OCR processing for valid apps
      appSwitchDebouncer.scheduleOCR(appInfo);

    } catch (err) {
      console.error("Error in appTracker callback:", err);
    }
  });

  setTimeout(() => {
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
      activityTracker.startTracking();
    } catch (e) {
      console.error("Activity tracker failed to start:", e);
    }
  }, 800);
}

// ----- App Event Handlers -----
app.whenReady().then(() => {
  createMainWindow();
  createDebugWindow();
  createSuggestionsWindow();
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

