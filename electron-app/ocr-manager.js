const screenshot = require('screenshot-desktop');
const FormData = require('form-data');
const WebSocketManager = require('./websocket-manager');

class OCRManager {
  constructor(overlayWindow = null) {
    this.isProcessing = false;
    this.overlayWindow = overlayWindow;
    this.backendUrl = 'http://127.0.0.1:8000';

    // Content similarity tracking
    this.lastOCRContent = [];
    this.lastOCRTimestamp = 0;
    this.contentSimilarityThreshold = 0.8; // 80% similarity threshold
    this.minTimeBetweenOCR = 5000; // 5 seconds minimum

    // WebSocket for real-time job completion
    this.wsManager = new WebSocketManager();
    this.pendingJobs = new Map(); // job_id -> {resolve, reject, timeout}
    this.userId = null;

    // Set up WebSocket event handlers
    this._setupWebSocketHandlers();

    console.log('🔌 OCR Manager initialized with WebSocket support');
  }

  _setupWebSocketHandlers() {
    // Handle OCR job completion
    this.wsManager.onOCRJobComplete((data) => {
      const jobId = data.job_id;
      console.log(`🎉 OCR job completed via WebSocket: ${jobId}`);

      if (this.pendingJobs.has(jobId)) {
        const { resolve, timeout } = this.pendingJobs.get(jobId);
        clearTimeout(timeout);
        this.pendingJobs.delete(jobId);

        resolve({
          text_lines: data.text_lines || [],
          app_context: data.app_context
        });
      }
    });

    // Handle WebSocket errors
    this.wsManager.onError((error) => {
      console.log('❌ WebSocket error in OCR Manager:', error);
    });
  }

  async connectWebSocket(userId, sessionId = null) {
    try {
      this.userId = userId;
      await this.wsManager.connect(userId, sessionId);
      console.log('✅ OCR Manager WebSocket connected');
      return true;
    } catch (error) {
      console.log('❌ Failed to connect OCR Manager WebSocket:', error);
      return false;
    }
  }

  async captureAndRecognize(appContext = {}, userId = null) {
    if (this.isProcessing) {
      // OCR in progress
      return [];
    }

    this.isProcessing = true;
    let wasVisible = false;
    try {
      // Start capture

      // Hide overlay during capture

      if (this.overlayWindow && this.overlayWindow.isVisible()) {
        wasVisible = true;
        this.overlayWindow.hide();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Capture screenshot
      const imgBuffer = await screenshot({ format: 'png' });
      // Screenshot captured

      // Show overlay again without focusing
      if (wasVisible && this.overlayWindow) {
        this.overlayWindow.showInactive();
      }

      // Queue OCR job with context
      const jobId = await this.queueOCRJob(imgBuffer, appContext, userId);

      if (jobId) {
        console.log(`📋 OCR job queued: ${jobId}`);

        // Wait for job completion via WebSocket
        const result = await this.waitForJobCompletionWebSocket(jobId);
        const textLines = result.text_lines || [];

        // Update content tracking
        this.lastOCRContent = textLines;
        this.lastOCRTimestamp = Date.now();

        return textLines;
      } else {
        console.log('❌ Failed to queue OCR job');
        return [];
      }

    } catch (error) {
      // Only restore overlay if it was visible before we hid it (without focusing)
      if (wasVisible && this.overlayWindow && !this.overlayWindow.isVisible()) {
        this.overlayWindow.showInactive();
      }

      if (error.message && error.message.includes('screen recording')) {
        // Permission required
        return [];
      }

      // OCR error
      return [];
    } finally {
      this.isProcessing = false;
    }
  }

  async captureAndQueueOCR(appContext = {}, userId = null) {
    if (this.isProcessing) {
      // OCR in progress
      return null;
    }

    this.isProcessing = true;
    let wasVisible = false;
    try {
      // Hide overlay during capture
      if (this.overlayWindow && this.overlayWindow.isVisible()) {
        wasVisible = true;
        this.overlayWindow.hide();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Capture screenshot
      const imgBuffer = await screenshot({ format: 'png' });

      // Show overlay again without focusing
      if (wasVisible && this.overlayWindow) {
        this.overlayWindow.showInactive();
      }

      // Queue OCR job with context and return job ID immediately
      const jobId = await this.queueOCRJob(imgBuffer, appContext, userId);

      if (jobId) {
        console.log(`📋 OCR job queued: ${jobId}`);
        return jobId;
      } else {
        console.log('❌ Failed to queue OCR job');
        return null;
      }

    } catch (error) {
      // Only restore overlay if it was visible before we hid it (without focusing)
      if (wasVisible && this.overlayWindow && !this.overlayWindow.isVisible()) {
        this.overlayWindow.showInactive();
      }

      if (error.message && error.message.includes('screen recording')) {
        return null;
      }

      return null;
    } finally {
      this.isProcessing = false;
    }
  }

  async queueOCRJob(imageBuffer, appContext, userId) {
    // Queue OCR job
    try {
      const form = new FormData();
      form.append('file', imageBuffer, 'screenshot.png');
      form.append('app_name', appContext.appName || 'Unknown');
      form.append('window_title', appContext.windowTitle || '');
      form.append('bundle_id', appContext.bundleId || '');
      form.append('user_id', userId);
      form.append('session_id', appContext.session_id || '');
      form.append('priority', 'normal');
      form.append('session_context', JSON.stringify({
        timestamp: Date.now(),
        user_initiated: false,
        capture_method: 'auto'
      }));

      // User ID set

      const response = await this.makeHttpRequest(`${this.backendUrl}/api/ai/ocr/queue/context`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders()
      });

      return response.job_id;

    } catch (error) {
      // Queue error
      return null;
    }
  }

  async waitForJobCompletionWebSocket(jobId, maxWaitTime = 30000) {
    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingJobs.delete(jobId);
        reject(new Error('OCR job timeout'));
      }, maxWaitTime);

      // Store the pending job for WebSocket handling
      this.pendingJobs.set(jobId, { resolve, reject, timeout });

      // Check WebSocket connection
      if (!this.wsManager.connected) {
        console.log('⚠️ WebSocket not connected, falling back to polling for job', jobId);

        // Fall back to polling if WebSocket is not available
        clearTimeout(timeout);
        this.pendingJobs.delete(jobId);
        this.waitForJobCompletionPolling(jobId, maxWaitTime).then(resolve).catch(reject);
      } else {
        console.log(`✅ WebSocket connected, waiting for job completion via WebSocket for job ${jobId}`);
      }
    });
  }

  // Keep polling as fallback method
  async waitForJobCompletionPolling(jobId, maxWaitTime = 30000, pollInterval = 1000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const jobStatus = await this.getJobStatus(jobId);

        if (jobStatus.status === 'completed') {
          return {
            text_lines: jobStatus.text_lines || [],
            app_context: jobStatus.app_context
          };
        } else if (jobStatus.status === 'failed') {
          return { text_lines: [] };
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));

      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    return { text_lines: [] };
  }

  async getJobStatus(jobId) {
    try {
      const response = await this.makeHttpRequest(`${this.backendUrl}/api/ai/ocr/job/${jobId}`, {
        method: 'GET'
      });

      return response;

    } catch (error) {
      // Status error
      throw error;
    }
  }

  async getQueueStats() {
    try {
      const response = await this.makeHttpRequest(`${this.backendUrl}/api/ai/ocr/queue/stats`, {
        method: 'GET'
      });

      return response.queue_stats;

    } catch (error) {
      // Queue stats error
      return null;
    }
  }

  async makeHttpRequest(url, options) {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const http = require('http');
      const urlParts = new URL(url);
      const client = urlParts.protocol === 'https:' ? https : http;

      const requestOptions = {
        hostname: urlParts.hostname,
        port: urlParts.port || (urlParts.protocol === 'https:' ? 443 : 80),
        path: urlParts.pathname + urlParts.search,
        method: options.method || 'GET',
        headers: options.headers || {}
      };

      const req = client.request(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(jsonData);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${jsonData.error || 'Unknown error'}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse response: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      if (options.body) {
        if (options.body instanceof FormData) {
          options.body.pipe(req);
        } else {
          req.write(options.body);
          req.end();
        }
      } else {
        req.end();
      }
    });
  }

  // Smart OCR Triggering
  shouldTriggerOCR(reason = "unknown") {
    const now = Date.now();

    // Check minimum time between OCR calls
    if (now - this.lastOCRTimestamp < this.minTimeBetweenOCR) {
      // OCR too recent
      return false;
    }

    // If we're already processing, skip
    if (this.isProcessing) {
      // OCR in progress
      return false;
    }

    // OCR approved
    return true;
  }

  async shouldTriggerBasedOnContent(newContent) {
    if (!this.lastOCRContent || this.lastOCRContent.length === 0) {
      // No previous content
      return true;
    }

    const similarity = this.calculateContentSimilarity(this.lastOCRContent, newContent);

    if (similarity < this.contentSimilarityThreshold) {
      // Content changed
      return true;
    }

    // Content similar
    return false;
  }

  calculateContentSimilarity(content1, content2) {
    if (!content1 || !content2 || content1.length === 0 || content2.length === 0) {
      return 0;
    }

    // Simple text similarity based on shared lines
    const set1 = new Set(content1.map(line => line.trim().toLowerCase()));
    const set2 = new Set(content2.map(line => line.trim().toLowerCase()));

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    if (union.size === 0) return 1; // Both empty

    return intersection.size / union.size;
  }

  async triggerSmartOCR(reason, appContext = {}, userId = null) {
    if (!this.shouldTriggerOCR(reason)) {
      return [];
    }

    // Smart OCR triggered
    return await this.captureAndRecognize(appContext, userId);
  }

  async terminate() {
    console.log('🛑 Terminating OCR Manager...');

    // Clear any pending jobs
    for (const [jobId, { timeout }] of this.pendingJobs) {
      clearTimeout(timeout);
    }
    this.pendingJobs.clear();

    // Disconnect WebSocket
    if (this.wsManager) {
      this.wsManager.disconnect();
    }

    console.log('✅ OCR Manager terminated');
  }
}

module.exports = OCRManager;
