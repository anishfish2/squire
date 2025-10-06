import screenshot from 'screenshot-desktop'
import FormData from 'form-data'
import WebSocketManager from './websocket-manager.js'

class OCRManager {
  constructor(overlayWindow = null) {
    this.isProcessing = false;
    this.overlayWindow = overlayWindow;
    this.backendUrl = 'http://127.0.0.1:8000';

    this.lastOCRContent = [];
    this.lastOCRTimestamp = 0;
    this.contentSimilarityThreshold = 0.8;
    this.minTimeBetweenOCR = 5000;

    this.wsManager = new WebSocketManager();
    this.pendingJobs = new Map();
    this.userId = null;

    this._setupWebSocketHandlers();

  }

  _setupWebSocketHandlers() {
    this.wsManager.onOCRJobComplete((data) => {
      const jobId = data.job_id;

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

    this.wsManager.onError((error) => {
    });
  }

  async connectWebSocket(userId, sessionId = null) {
    try {
      this.userId = userId;
      await this.wsManager.connect(userId, sessionId);
      return true;
    } catch (error) {
      return false;
    }
  }

  async captureAndRecognize(appContext = {}, userId = null) {
    if (this.isProcessing) {
      return [];
    }

    this.isProcessing = true;
    let wasVisible = false;
    try {


      if (this.overlayWindow && this.overlayWindow.isVisible()) {
        wasVisible = true;
        this.overlayWindow.hide();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const imgBuffer = await screenshot({ format: 'png' });
      if (imgBuffer.length === 0) {
        console.warn("⚠️ Screenshot buffer is empty!");
      }


      if (wasVisible && this.overlayWindow) {
        this.overlayWindow.showInactive();
      }

      const jobId = await this.queueOCRJob(imgBuffer, appContext, userId);

      if (jobId) {

        const result = await this.waitForJobCompletionWebSocket(jobId);
        const textLines = result.text_lines || [];

        this.lastOCRContent = textLines;
        this.lastOCRTimestamp = Date.now();

        return textLines;
      } else {
        return [];
      }

    } catch (error) {
      if (wasVisible && this.overlayWindow && !this.overlayWindow.isVisible()) {
        this.overlayWindow.showInactive();
      }

      if (error.message && error.message.includes('screen recording')) {
        return [];
      }

      return [];
    } finally {
      this.isProcessing = false;
    }
  }

  async captureAndQueueOCR(appContext = {}, userId = null) {
    if (this.isProcessing) {
      return null;
    }

    this.isProcessing = true;
    let wasVisible = false;
    try {
      if (this.overlayWindow && this.overlayWindow.isVisible()) {
        wasVisible = true;
        this.overlayWindow.hide();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const imgBuffer = await screenshot({ format: 'png' });

      if (wasVisible && this.overlayWindow) {
        this.overlayWindow.showInactive();
      }

      const jobId = await this.queueOCRJob(imgBuffer, appContext, userId);

      if (jobId) {
        return jobId;
      } else {
        return null;
      }

    } catch (error) {
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


      const response = await this.makeHttpRequest(`${this.backendUrl}/api/ai/ocr/queue/context`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders()
      });

      return response.job_id;

    } catch (error) {
      return null;
    }
  }

  async waitForJobCompletionWebSocket(jobId, maxWaitTime = 30000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingJobs.delete(jobId);
        reject(new Error('OCR job timeout'));
      }, maxWaitTime);

      this.pendingJobs.set(jobId, { resolve, reject, timeout });

      if (!this.wsManager.connected) {

        clearTimeout(timeout);
        this.pendingJobs.delete(jobId);
        this.waitForJobCompletionPolling(jobId, maxWaitTime).then(resolve).catch(reject);
      } else {
      }
    });
  }

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

  shouldTriggerOCR(reason = "unknown") {
    const now = Date.now();

    if (now - this.lastOCRTimestamp < this.minTimeBetweenOCR) {
      return false;
    }

    if (this.isProcessing) {
      return false;
    }

    return true;
  }

  async shouldTriggerBasedOnContent(newContent) {
    if (!this.lastOCRContent || this.lastOCRContent.length === 0) {
      return true;
    }

    const similarity = this.calculateContentSimilarity(this.lastOCRContent, newContent);

    if (similarity < this.contentSimilarityThreshold) {
      return true;
    }

    return false;
  }

  calculateContentSimilarity(content1, content2) {
    if (!content1 || !content2 || content1.length === 0 || content2.length === 0) {
      return 0;
    }

    const set1 = new Set(content1.map(line => line.trim().toLowerCase()));
    const set2 = new Set(content2.map(line => line.trim().toLowerCase()));

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    if (union.size === 0) return 1;

    return intersection.size / union.size;
  }

  async triggerSmartOCR(reason, appContext = {}, userId = null) {
    if (!this.shouldTriggerOCR(reason)) {
      return [];
    }

    return await this.captureAndRecognize(appContext, userId);
  }

  async terminate() {

    for (const [jobId, { timeout }] of this.pendingJobs) {
      clearTimeout(timeout);
    }
    this.pendingJobs.clear();

    if (this.wsManager) {
      this.wsManager.disconnect();
    }

  }
}

export default OCRManager
