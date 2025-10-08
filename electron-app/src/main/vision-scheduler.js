// vision-scheduler.js
import { desktopCapturer, screen, app } from 'electron'
import FormData from 'form-data'
import axios from 'axios'
import authStore from './auth-store.js'
import fs from 'fs'
import path from 'path'

class VisionScheduler {
  constructor(backendUrl, userId, sessionId) {
    this.backendUrl = backendUrl;
    this.userId = userId;
    this.sessionId = sessionId;
    this.captureInterval = null;
    this.isCapturing = false;
    this.currentApp = null;
    this.appPreferences = new Map();
    this.statePath = path.join(app.getPath('userData'), 'vision-state.json');

    // Load saved state or default to true (vision enabled by default)
    this.globalVisionEnabled = this.loadVisionState();

    // Default intervals (in milliseconds)
    this.intervals = {
      'low': 60000,      // 1 minute
      'normal': 10000,   // 10 seconds (for testing)
      'high': 30000      // 30 seconds
    };

  }

  /**
   * Load vision state from disk
   */
  loadVisionState() {
    try {
      if (fs.existsSync(this.statePath)) {
        const data = fs.readFileSync(this.statePath, 'utf8');
        const state = JSON.parse(data);
        console.log(`📸 [VisionScheduler] Loaded vision state from disk: ${state.enabled}`);
        return state.enabled !== undefined ? state.enabled : false;
      }
    } catch (error) {
      console.error('📸 [VisionScheduler] Failed to load vision state:', error);
    }
    // Default to false (vision disabled)
    console.log('📸 [VisionScheduler] No saved state, defaulting to disabled');
    return false;
  }

  /**
   * Save vision state to disk
   */
  saveVisionState() {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify({ enabled: this.globalVisionEnabled }, null, 2));
      console.log(`📸 [VisionScheduler] Saved vision state: ${this.globalVisionEnabled}`);
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

    // Start capture loop
    this.scheduleNextCapture();
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

    if (!enabled && this.captureInterval) {
      console.log('📸 [VisionScheduler] Stopping scheduling because vision is disabled');
      this.stopScheduling();
    } else if (enabled && !this.captureInterval) {
      console.log('📸 [VisionScheduler] Starting scheduling because vision is enabled');
      this.scheduleNextCapture();
    }
  }

  /**
   * Load app preferences from backend
   */
  async loadAppPreferences() {
    try {
      // Get auth token and user for API call
      const token = authStore.getAccessToken();
      const user = authStore.getUser();
      if (!user?.id) {
        console.error('📸 [VisionScheduler] ❌ No user ID available');
        return;
      }

      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${this.backendUrl}/api/vision/preferences/${user.id}`, {
        headers: headers
      });

      if (response.ok) {
        const prefs = await response.json();

        // Store in Map for fast lookup
        this.appPreferences.clear();
        prefs.forEach(pref => {
          this.appPreferences.set(pref.app_name, pref);
        });

        prefs.forEach(pref => {
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
      // Get auth token and user for API call
      const token = authStore.getAccessToken();
      const user = authStore.getUser();
      if (!user?.id) {
        console.error('📸 [VisionScheduler] ❌ No user ID available');
        return;
      }

      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${this.backendUrl}/api/vision/preferences/${user.id}`, {
        headers: headers
      });

      if (response.ok) {
        const prefs = await response.json();
        const pref = prefs.find(p => p.app_name === appName);

        if (pref) {
          this.appPreferences.set(appName, pref);

          // If this is the current app, reschedule based on new settings
          if (this.currentApp === appName) {
            this.reschedule();
          }
        } else {
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
      return false;
    }

    if (!this.currentApp) {
      return false;
    }

    const pref = this.appPreferences.get(this.currentApp);

    if (!pref) {
      return false;
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
}

export default VisionScheduler
