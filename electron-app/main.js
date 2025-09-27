// main.js
const { app, BrowserWindow, screen, ipcMain, Menu, dialog } = require("electron");
const path = require("path");

const OCRManager = require("./ocr-manager");
const ActiveAppTracker = require("./app-tracker"); // ✅ now uses @paymoapp/active-window
const ComprehensiveActivityTracker = require("./activity-tracker");
const AIAssistant = require("./ai-assistant");

let debugWindow;
let suggestionsWindow;
let ocrManager;
let appTracker;
let activityTracker;
let aiAssistant;
let recentActivityData = null;

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

// ----- Window Creation -----
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





  return suggestionsWindow;
}

// ----- OCR / AI / Tracking -----
function setupPipelines() {
  ocrManager = new OCRManager(suggestionsWindow);
  aiAssistant = new AIAssistant();

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
  createDebugWindow();
  createSuggestionsWindow();
  setupPipelines();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
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

