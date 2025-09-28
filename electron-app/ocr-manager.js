const screenshot = require('screenshot-desktop');
const FormData = require('form-data');

class OCRManager {
  constructor(overlayWindow = null) {
    this.isProcessing = false;
    this.overlayWindow = overlayWindow;
    this.backendUrl = 'http://127.0.0.1:8000';
    console.log('OCR Manager initialized with PaddleOCR backend');
  }

  async captureAndRecognize() {
    if (this.isProcessing) {
      console.log('OCR already in progress, skipping...');
      return [];
    }

    this.isProcessing = true;

    try {
      console.log('Starting screen capture...');

      // Hide overlay during capture
      let wasVisible = false;
      if (this.overlayWindow && this.overlayWindow.isVisible()) {
        wasVisible = true;
        this.overlayWindow.hide();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Capture screenshot
      const imgBuffer = await screenshot({ format: 'png' });
      console.log('Screenshot captured, sending to backend...');

      // Show overlay again without focusing
      if (wasVisible && this.overlayWindow) {
        this.overlayWindow.showInactive();
      }

      // Send to backend for OCR processing
      const form = new FormData();
      form.append('file', imgBuffer, 'screenshot.png');

      const response = await this.makeHttpRequest(`${this.backendUrl}/api/ai/ocr`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders()
      });

      console.log(`PaddleOCR found ${response.text_lines.length} text lines`);
      return response.text_lines || [];

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
