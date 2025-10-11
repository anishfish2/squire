// vision-scheduler.js
import { desktopCapturer, screen, app } from 'electron'
import FormData from 'form-data'
import axios from 'axios'
import authStore from './auth-store.js'
import preferencesManager from './preferences-manager.js'
import fs from 'fs'
import path from 'path'

class VisionScheduler {
  constructor(backendUrl, userId, sessionId) {
    this.backendUrl = backendUrl;
    this.userId = userId;
    this.sessionId = sessionId;
    this.captureInterval = null;
    this.focusedCaptureInterval = null;  // For frequent focused captures
    this.isCapturing = false;
    this.currentApp = null;
    this.appPreferences = new Map();
    this.statePath = path.join(app.getPath('userData'), 'vision-state.json');
    this.activityTracker = null;  // Will be set for mouse-based captures

    // ALWAYS start disabled (do not persist across sessions)
    this.globalVisionEnabled = false;
    console.log('📸 [VisionScheduler] Vision starts DISABLED by default (no persistence)');

    // Default intervals (in milliseconds) - for FULL screen captures
    this.intervals = {
      'low': 120000,     // 2 minutes - for passive apps (reduced frequency)
      'normal': 60000,   // 1 minute - standard apps (reduced frequency)
      'high': 30000      // 30 seconds - for actionable apps (reduced frequency)
    };

    // Focused capture intervals - much more frequent around mouse activity
    this.focusedIntervals = {
      'low': 30000,      // 30 seconds
      'normal': 10000,   // 10 seconds
      'high': 3000       // 3 seconds - very frequent for actionable apps
    };

    // Actionable apps that need high-frequency vision
    this.actionableApps = [
      'gmail',
      'mail',
      'outlook',
      'calendar',
      'google chrome', // For Gmail web
      'safari',
      'firefox',
      'microsoft edge',
      'slack',
      'discord',
      'notion'
    ];

  }

  /**
   * Load vision state from disk
   * NOTE: This function is no longer used - vision always starts disabled
   */
  loadVisionState() {
    // DEPRECATED: Vision no longer persists across sessions
    // Always starts disabled for privacy/performance
    return false;
  }

  /**
   * Save vision state to disk
   * NOTE: State is NOT loaded on startup - vision always starts disabled
   */
  saveVisionState() {
    // We still save for debugging purposes, but don't load it on startup
    try {
      fs.writeFileSync(this.statePath, JSON.stringify({ enabled: this.globalVisionEnabled }, null, 2));
      console.log(`📸 [VisionScheduler] Saved vision state: ${this.globalVisionEnabled} (for debugging only - not loaded on startup)`);
    } catch (error) {
      console.error('📸 [VisionScheduler] Failed to save vision state:', error);
    }
  }

  /**
   * Start vision capture scheduling
   */
  async startScheduling() {
    console.log('📸 [VisionScheduler] Starting vision scheduler...');

    // Load app preferences from backend
    await this.loadAppPreferences();

    console.log(`📸 [VisionScheduler] Loaded ${this.appPreferences.size} app preferences`);
    console.log(`📸 [VisionScheduler] Global vision enabled: ${this.globalVisionEnabled}`);

    // Only start capture loop if vision is enabled
    if (this.globalVisionEnabled) {
      console.log('📸 [VisionScheduler] Vision is enabled, starting capture loop');
      this.scheduleNextCapture();
    } else {
      console.log('📸 [VisionScheduler] Vision is disabled, NOT starting capture loop');
    }
  }

  /**
   * Stop vision capture scheduling
   */
  stopScheduling() {

    if (this.captureInterval) {
      clearTimeout(this.captureInterval);
      this.captureInterval = null;
    }

    this.isCapturing = false;
  }

  /**
   * Update current app context
   */
  updateCurrentApp(appName) {
    if (this.currentApp !== appName) {
      this.currentApp = appName;

      // Reschedule based on new app's preferences
      this.reschedule();
    }
  }

  /**
   * Set global vision feature toggle
   */
  setGlobalVisionEnabled(enabled) {
    console.log(`📸 [VisionScheduler] setGlobalVisionEnabled called: ${enabled}`);
    this.globalVisionEnabled = enabled;
    console.log(`📸 [VisionScheduler] globalVisionEnabled is now: ${this.globalVisionEnabled}`);

    // Save state to disk
    this.saveVisionState();

    if (!enabled) {
      // Stop all capture loops when disabled
      console.log('📸 [VisionScheduler] Stopping all capture loops because vision is disabled');
      this.stopScheduling();
      this.stopFocusedCaptures();
    } else {
      // Start both capture loops when enabled
      console.log('📸 [VisionScheduler] Starting all capture loops because vision is enabled');
      if (!this.captureInterval) {
        this.scheduleNextCapture();
      }
      if (!this.focusedCaptureInterval) {
        this.startFocusedCaptures();
      }
    }
  }

  /**
   * Load app preferences from local storage (FAST!)
   */
  async loadAppPreferences() {
    try {
      // Get all preferences from local storage
      const prefs = preferencesManager.getAllPreferences();

      // Store in Map for fast lookup
      this.appPreferences.clear();
      prefs.forEach(pref => {
        this.appPreferences.set(pref.app_name.toLowerCase(), pref);
      });

      console.log(`📸 [VisionScheduler] Loaded ${prefs.length} local app preferences`);
    } catch (error) {
      console.error('📸 [VisionScheduler] ❌ Error loading app preferences:', error);
    }
  }

  /**
   * Refresh preferences for a specific app from local storage
   */
  async refreshAppPreference(appName) {
    try {
      const pref = preferencesManager.getAppPreference(appName);

      if (pref) {
        this.appPreferences.set(appName.toLowerCase(), pref);

        // If this is the current app, reschedule based on new settings
        if (this.currentApp === appName) {
          this.reschedule();
        }

        console.log(`📸 [VisionScheduler] Refreshed preference for ${appName}`);
      }
    } catch (error) {
      console.error(`📸 [VisionScheduler] ❌ Error refreshing preference for ${appName}:`, error);
    }
  }

  /**
   * Check if we should capture for the current app
   */
  shouldCapture() {
    if (!this.globalVisionEnabled) {
      return false;
    }

    if (!this.currentApp) {
      return false;
    }

    // Get preference (will return defaults if not set)
    let pref = this.appPreferences.get(this.currentApp.toLowerCase());

    if (!pref) {
      // Get default from preferences manager
      pref = preferencesManager.getAppPreference(this.currentApp);
      // Cache it for next time
      this.appPreferences.set(this.currentApp.toLowerCase(), pref);
    }

    const shouldCapture = pref.allow_vision === true;

    return shouldCapture;
  }

  /**
   * Get capture interval for current app
   */
  getCaptureInterval() {
    if (!this.currentApp) {
      return this.intervals.normal;
    }

    // Check if this is an actionable app - auto-set to high frequency
    const isActionableApp = this.actionableApps.some(app =>
      this.currentApp.toLowerCase().includes(app)
    );

    if (isActionableApp) {
      console.log(`📸 [VisionScheduler] Actionable app detected: ${this.currentApp} - using HIGH frequency (${this.intervals.high}ms)`);
      return this.intervals.high; // 5 seconds for actionable apps
    }

    // Otherwise use preferences from backend
    const pref = this.appPreferences.get(this.currentApp);

    if (!pref || !pref.vision_frequency) {
      return this.intervals.normal;
    }

    return this.intervals[pref.vision_frequency] || this.intervals.normal;
  }

  /**
   * Schedule next capture based on current app's frequency
   */
  scheduleNextCapture() {
    // Clear existing interval
    if (this.captureInterval) {
      clearTimeout(this.captureInterval);
    }

    const interval = this.getCaptureInterval();

    this.captureInterval = setTimeout(async () => {
      await this.performCapture();
      this.scheduleNextCapture(); // Reschedule for next capture
    }, interval);

    const currentApp = this.currentApp || 'unknown';
    const shouldCapture = this.shouldCapture();
  }

  /**
   * Reschedule capture (called when app changes)
   */
  reschedule() {
    if (this.globalVisionEnabled) {
      this.scheduleNextCapture();
    }
  }

  /**
   * Perform screenshot capture and queue vision job
   */
  async performCapture() {
    if (this.isCapturing) {
      return;
    }

    if (!this.shouldCapture()) {
      return;
    }

    this.isCapturing = true;

    try {

      // Get primary display
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;

      // Capture screenshot
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width, height }
      });

      if (sources.length === 0) {
        console.error('📸 [VisionScheduler] ❌ No screen sources available');
        return;
      }


      // Get the first screen (primary display)
      const source = sources[0];
      const screenshot = source.thumbnail;

      // Convert to PNG buffer
      const screenshotBuffer = screenshot.toPNG();


      // Queue vision job
      await this.queueVisionJob(screenshotBuffer);

    } catch (error) {
      console.error('📸 [VisionScheduler] ❌ Error capturing screenshot:', error);
    } finally {
      this.isCapturing = false;
    }
  }

  /**
   * Queue vision job with backend
   */
  async queueVisionJob(screenshotBuffer) {
    try {
      const pref = this.appPreferences.get(this.currentApp);
      const allowScreenshots = pref?.allow_screenshots || false;


      // Create form data for multipart upload (Node.js form-data package)
      const formData = new FormData();

      // Append the screenshot buffer directly
      formData.append('file', screenshotBuffer, {
        filename: `screenshot-${Date.now()}.png`,
        contentType: 'image/png'
      });
      formData.append('app_name', this.currentApp);
      formData.append('session_id', this.sessionId);
      formData.append('allow_screenshots', String(allowScreenshots));

      // userId is no longer needed in URL - comes from auth token
      const uploadUrl = `${this.backendUrl}/api/vision/jobs`;

      console.log(`📸 [VisionScheduler] Capturing for: ${this.currentApp}`);

      // Get auth token for API call
      const token = authStore.getAccessToken();
      const headers = formData.getHeaders();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Send to backend using axios (handles FormData properly)
      const startTime = Date.now();
      const response = await axios.post(uploadUrl, formData, {
        headers: headers,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      const uploadTime = Date.now() - startTime;
      const result = response.data;

      console.log(`📸 [VisionScheduler] ✅ Vision job queued (${uploadTime}ms)`);
      console.log(`   - Job ID: ${result.job_id || 'N/A'}`);
      console.log(`   - App: ${this.currentApp}`);

    } catch (error) {
      if (error.response) {
        // Server responded with error status
        console.error(`📸 [VisionScheduler] ❌ Failed to queue vision job`);
        console.error(`   - Status: ${error.response.status}`);
        console.error(`   - Error: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        // Request made but no response
        console.error('📸 [VisionScheduler] ❌ No response from backend');
        console.error(`   - Error: ${error.message}`);
      } else {
        // Error setting up request
        console.error('📸 [VisionScheduler] ❌ Error queuing vision job:', error.message);
      }
    }
  }

  /**
   * Set activity tracker for mouse-based focused captures
   */
  setActivityTracker(activityTracker) {
    this.activityTracker = activityTracker;
  }

  /**
   * Start focused vision captures around mouse activity
   */
  startFocusedCaptures() {
    if (this.focusedCaptureInterval) {
      clearTimeout(this.focusedCaptureInterval);
    }

    // Only start if vision is enabled
    if (!this.globalVisionEnabled) {
      console.log('📸 [VisionScheduler] Vision is disabled, NOT starting focused captures');
      return;
    }

    const interval = this.getFocusedCaptureInterval();

    this.focusedCaptureInterval = setTimeout(async () => {
      await this.performFocusedCapture();
      this.startFocusedCaptures(); // Reschedule
    }, interval);

    console.log(`📸 [VisionScheduler] Started focused captures (${interval}ms interval)`);
  }

  /**
   * Stop focused vision captures
   */
  stopFocusedCaptures() {
    if (this.focusedCaptureInterval) {
      clearTimeout(this.focusedCaptureInterval);
      this.focusedCaptureInterval = null;
    }
  }

  /**
   * Get interval for focused captures based on current app
   */
  getFocusedCaptureInterval() {
    if (!this.currentApp) {
      return this.focusedIntervals.normal;
    }

    // Check if this is an actionable app - capture more frequently
    const isActionableApp = this.actionableApps.some(app =>
      this.currentApp.toLowerCase().includes(app)
    );

    if (isActionableApp) {
      return this.focusedIntervals.high; // 3 seconds
    }

    const pref = this.appPreferences.get(this.currentApp);
    if (!pref || !pref.vision_frequency) {
      return this.focusedIntervals.normal;
    }

    return this.focusedIntervals[pref.vision_frequency] || this.focusedIntervals.normal;
  }

  /**
   * Perform focused screenshot capture around mouse position
   */
  async performFocusedCapture() {
    if (this.isCapturing || !this.shouldCapture()) {
      return;
    }

    this.isCapturing = true;

    try {
      // Get mouse position from activity tracker
      let region;
      if (this.activityTracker) {
        const mousePos = this.activityTracker.lastMousePosition || { x: 960, y: 540 };
        region = {
          x: Math.max(0, mousePos.x - 400),
          y: Math.max(0, mousePos.y - 300),
          width: 800,
          height: 600
        };
        console.log(`🎯 [VisionScheduler] Focused capture around mouse (${mousePos.x}, ${mousePos.y})`);
      } else {
        // Default center region
        region = { x: 560, y: 240, width: 800, height: 600 };
      }

      // Get primary display
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.size;

      // Ensure region is within bounds
      region.x = Math.max(0, Math.min(region.x, screenWidth - region.width));
      region.y = Math.max(0, Math.min(region.y, screenHeight - region.height));

      // Capture full screen
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: screenWidth, height: screenHeight }
      });

      if (sources.length === 0) {
        console.error('📸 [VisionScheduler] ❌ No screen sources available');
        return;
      }

      const screenshot = sources[0].thumbnail;

      // Crop to focused region
      const croppedImage = screenshot.crop(region);
      const screenshotBuffer = croppedImage.toPNG();

      console.log(`✅ [VisionScheduler] Captured focused ${region.width}x${region.height} (${screenshotBuffer.length} bytes)`);

      // Queue focused vision job
      await this.queueFocusedVisionJob(screenshotBuffer, region);

    } catch (error) {
      console.error('📸 [VisionScheduler] ❌ Error capturing focused screenshot:', error);
    } finally {
      this.isCapturing = false;
    }
  }

  /**
   * Queue focused vision job with region metadata
   */
  async queueFocusedVisionJob(screenshotBuffer, region) {
    try {
      const pref = this.appPreferences.get(this.currentApp);
      const allowScreenshots = pref?.allow_screenshots || false;

      const formData = new FormData();

      formData.append('file', screenshotBuffer, {
        filename: `focused-${Date.now()}.png`,
        contentType: 'image/png'
      });
      formData.append('app_name', this.currentApp);
      formData.append('session_id', this.sessionId);
      formData.append('allow_screenshots', String(allowScreenshots));
      formData.append('capture_type', 'focused');
      formData.append('region', JSON.stringify(region));

      const uploadUrl = `${this.backendUrl}/api/vision/jobs`;

      const token = authStore.getAccessToken();
      const headers = formData.getHeaders();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const startTime = Date.now();
      const response = await axios.post(uploadUrl, formData, {
        headers: headers,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      const uploadTime = Date.now() - startTime;
      const result = response.data;

      console.log(`📸 [VisionScheduler] ✅ Focused vision job queued (${uploadTime}ms)`);
      console.log(`   - Job ID: ${result.job_id || 'N/A'}`);
      console.log(`   - Region: ${region.width}x${region.height}`);

    } catch (error) {
      console.error('📸 [VisionScheduler] ❌ Failed to queue focused vision job:', error.message);
    }
  }
}

export default VisionScheduler
