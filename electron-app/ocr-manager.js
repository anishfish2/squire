const screenshot = require('screenshot-desktop');
const FormData = require('form-data');

class OCRManager {
  constructor(overlayWindow = null) {
    this.isProcessing = false;
    this.overlayWindow = overlayWindow;
    this.backendUrl = 'http://127.0.0.1:8000';
    console.log('OCR Manager initialized with PaddleOCR backend');
  }

  async captureAndRecognize(appContext = {}, userId = null) {
    if (this.isProcessing) {
      console.log('OCR already in progress, skipping...');
      return [];
    }

    this.isProcessing = true;
    let wasVisible = false;
    try {
      console.log('Starting screen capture for job queue...');

      // Hide overlay during capture
      
      if (this.overlayWindow && this.overlayWindow.isVisible()) {
        wasVisible = true;
        this.overlayWindow.hide();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Capture screenshot
      const imgBuffer = await screenshot({ format: 'png' });
      console.log('Screenshot captured, queuing OCR job...');

      // Show overlay again without focusing
      if (wasVisible && this.overlayWindow) {
        this.overlayWindow.showInactive();
      }

      // Queue OCR job with context
      const jobId = await this.queueOCRJob(imgBuffer, appContext, userId);

      if (jobId) {
        console.log(`📋 OCR job queued: ${jobId}`);

        // Poll for job completion
        const result = await this.waitForJobCompletion(jobId);
        return result.text_lines || [];
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
        console.log('⚠️  Screen recording permission required!');
        return [];
      }

      console.error('OCR error:', error);
      return [];
    } finally {
      this.isProcessing = false;
    }
  }

  async queueOCRJob(imageBuffer, appContext, userId) {
    console.log('📋 Queueing OCR job with context for user:', userId);
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

      console.log("form.user_id ", userId);

      const response = await this.makeHttpRequest(`${this.backendUrl}/api/ai/ocr/queue/context`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders()
      });

      return response.job_id;

    } catch (error) {
      console.error('Failed to queue OCR job:', error);
      return null;
    }
  }

  async waitForJobCompletion(jobId, maxWaitTime = 30000, pollInterval = 1000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const jobStatus = await this.getJobStatus(jobId);

        if (jobStatus.status === 'completed') {
          console.log(`✅ OCR job ${jobId} completed`);
          return {
            text_lines: jobStatus.text_lines || [],
            app_context: jobStatus.app_context
          };
        } else if (jobStatus.status === 'failed') {
          console.log(`❌ OCR job ${jobId} failed: ${jobStatus.error_message}`);
          return { text_lines: [] };
        }

        // Job still processing, wait and poll again
        await new Promise(resolve => setTimeout(resolve, pollInterval));

      } catch (error) {
        console.error(`Error checking job ${jobId} status:`, error);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    console.log(`⏰ OCR job ${jobId} timed out after ${maxWaitTime}ms`);
    return { text_lines: [] };
  }

  async getJobStatus(jobId) {
    try {
      const response = await this.makeHttpRequest(`${this.backendUrl}/api/ai/ocr/job/${jobId}`, {
        method: 'GET'
      });

      return response;

    } catch (error) {
      console.error(`Failed to get job status for ${jobId}:`, error);
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
      console.error('Failed to get queue stats:', error);
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

  async terminate() {
    // Nothing to clean up anymore
    console.log('OCR Manager terminated');
  }
}

module.exports = OCRManager;
