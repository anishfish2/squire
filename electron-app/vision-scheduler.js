// vision-scheduler.js
const { desktopCapturer, screen } = require('electron');

class VisionScheduler {
  constructor(backendUrl, userId, sessionId) {
    this.backendUrl = backendUrl;
    this.userId = userId;
    this.sessionId = sessionId;
    this.captureInterval = null;
    this.isCapturing = false;
    this.currentApp = null;
    this.appPreferences = new Map();
    this.globalVisionEnabled = true;

    // Default intervals (in milliseconds)
    this.intervals = {
      'low': 60000,      // 1 minute
      'normal': 10000,   // 10 seconds (for testing)
      'high': 30000      // 30 seconds
    };

    console.log('📸 VisionScheduler initialized');
  }

  /**
   * Start vision capture scheduling
   */
  async startScheduling() {
    console.log('📸 Starting vision scheduling...');

    // Load app preferences from backend
    await this.loadAppPreferences();

    // Start capture loop
    this.scheduleNextCapture();
  }

  /**
   * Stop vision capture scheduling
   */
  stopScheduling() {
    console.log('📸 Stopping vision scheduling...');

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
      console.log(`📸 App changed: ${this.currentApp} → ${appName}`);
      this.currentApp = appName;

      // Reschedule based on new app's preferences
      this.reschedule();
    }
  }

  /**
   * Set global vision feature toggle
   */
  setGlobalVisionEnabled(enabled) {
    console.log(`📸 Global vision ${enabled ? 'enabled' : 'disabled'}`);
    this.globalVisionEnabled = enabled;

    if (!enabled && this.captureInterval) {
      this.stopScheduling();
    } else if (enabled && !this.captureInterval) {
      this.scheduleNextCapture();
    }
  }

  /**
   * Load app preferences from backend
   */
  async loadAppPreferences() {
    try {
      console.log(`📸 [VisionScheduler] Loading app preferences from backend...`);
      const response = await fetch(`${this.backendUrl}/api/vision/preferences/${this.userId}`);

      if (response.ok) {
        const prefs = await response.json();

        // Store in Map for fast lookup
        this.appPreferences.clear();
        prefs.forEach(pref => {
          this.appPreferences.set(pref.app_name, pref);
        });

        console.log(`📸 [VisionScheduler] ✅ Loaded preferences for ${prefs.length} apps:`);
        prefs.forEach(pref => {
          console.log(`   - ${pref.app_name}: vision=${pref.allow_vision}, screenshots=${pref.allow_screenshots}`);
        });
      } else {
        console.error('📸 [VisionScheduler] ❌ Failed to load app preferences:', response.status);
      }
    } catch (error) {
      console.error('📸 [VisionScheduler] ❌ Error loading app preferences:', error);
    }
  }

  /**
   * Refresh preferences for a specific app
   */
  async refreshAppPreference(appName) {
    try {
      console.log(`📸 [VisionScheduler] Refreshing preference for "${appName}"...`);
      const response = await fetch(`${this.backendUrl}/api/vision/preferences/${this.userId}`);

      if (response.ok) {
        const prefs = await response.json();
        const pref = prefs.find(p => p.app_name === appName);

        if (pref) {
          this.appPreferences.set(appName, pref);
          console.log(`📸 [VisionScheduler] ✅ Refreshed preference for "${appName}": vision=${pref.allow_vision}, screenshots=${pref.allow_screenshots}`);

          // If this is the current app, reschedule based on new settings
          if (this.currentApp === appName) {
            console.log(`📸 [VisionScheduler] Current app preferences updated, rescheduling...`);
            this.reschedule();
          }
        } else {
          console.log(`📸 [VisionScheduler] ⚠️ No preference found for "${appName}" in database`);
        }
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
      console.log(`📸 [VisionScheduler] shouldCapture = false (global vision disabled)`);
      return false;
    }

    if (!this.currentApp) {
      console.log(`📸 [VisionScheduler] shouldCapture = false (no current app)`);
      return false;
    }

    const pref = this.appPreferences.get(this.currentApp);

    if (!pref) {
      console.log(`📸 [VisionScheduler] shouldCapture = false (no preferences found for "${this.currentApp}")`);
      console.log(`   Available apps in preferences:`, Array.from(this.appPreferences.keys()));
      return false;
    }

    const shouldCapture = pref.allow_vision === true;
    console.log(`📸 [VisionScheduler] shouldCapture = ${shouldCapture} for "${this.currentApp}" (allow_vision=${pref.allow_vision})`);

    return shouldCapture;
  }

  /**
   * Get capture interval for current app
   */
  getCaptureInterval() {
    if (!this.currentApp) {
      return this.intervals.normal;
    }

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
    console.log(`📸 [VisionScheduler] Next capture for "${currentApp}" in ${interval / 1000}s (enabled: ${shouldCapture})`);
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
      console.log('📸 [VisionScheduler] Already capturing, skipping...');
      return;
    }

    if (!this.shouldCapture()) {
      console.log(`📸 [VisionScheduler] Skipping capture (vision disabled for ${this.currentApp || 'unknown app'})`);
      return;
    }

    this.isCapturing = true;

    try {
      console.log(`\n========================================`);
      console.log(`📸 [VisionScheduler] STARTING CAPTURE`);
      console.log(`   App: ${this.currentApp}`);
      console.log(`   Time: ${new Date().toISOString()}`);
      console.log(`========================================`);

      // Get primary display
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;
      console.log(`📸 [VisionScheduler] Display size: ${width}x${height}`);

      // Capture screenshot
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width, height }
      });

      if (sources.length === 0) {
        console.error('📸 [VisionScheduler] ❌ No screen sources available');
        return;
      }

      console.log(`📸 [VisionScheduler] Found ${sources.length} screen source(s)`);

      // Get the first screen (primary display)
      const source = sources[0];
      const screenshot = source.thumbnail;

      // Convert to PNG buffer
      const screenshotBuffer = screenshot.toPNG();

      console.log(`📸 [VisionScheduler] ✅ Screenshot captured: ${(screenshotBuffer.length / 1024).toFixed(2)} KB`);

      // Queue vision job
      console.log(`📸 [VisionScheduler] Sending to backend...`);
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

      console.log(`📸 [VisionScheduler] Preferences for ${this.currentApp}:`);
      console.log(`   - allow_screenshots: ${allowScreenshots}`);
      console.log(`   - vision_frequency: ${pref?.vision_frequency || 'normal'}`);

      // Create form data for multipart upload
      // Use native FormData (browser API), not form-data package
      const formData = new FormData();

      // Create a Blob from the buffer
      const blob = new Blob([screenshotBuffer], { type: 'image/png' });

      formData.append('file', blob, `screenshot-${Date.now()}.png`);
      formData.append('app_name', this.currentApp);
      formData.append('session_id', this.sessionId);
      formData.append('allow_screenshots', String(allowScreenshots));

      const uploadUrl = `${this.backendUrl}/api/vision/jobs/${this.userId}`;
      console.log(`📸 [VisionScheduler] Uploading to: ${uploadUrl}`);

      // Send to backend
      const startTime = Date.now();
      const response = await fetch(uploadUrl, {
        method: 'POST',
        body: formData
        // Don't set Content-Type header - fetch will set it automatically with boundary
      });

      const uploadTime = Date.now() - startTime;

      if (response.ok) {
        const result = await response.json();
        console.log(`📸 [VisionScheduler] ✅ Vision job created successfully!`);
        console.log(`   - Job ID: ${result.data?.job_id || 'unknown'}`);
        console.log(`   - Status: ${result.data?.status || 'unknown'}`);
        console.log(`   - S3 stored: ${result.data?.allow_screenshots || false}`);
        console.log(`   - Upload time: ${uploadTime}ms`);
        console.log(`========================================\n`);
      } else {
        const errorText = await response.text();
        console.error(`📸 [VisionScheduler] ❌ Failed to queue vision job`);
        console.error(`   - Status: ${response.status}`);
        console.error(`   - Error: ${errorText}`);
        console.log(`========================================\n`);
      }

    } catch (error) {
      console.error('📸 [VisionScheduler] ❌ Error queuing vision job:', error);
      console.log(`========================================\n`);
    }
  }
}

module.exports = VisionScheduler;
