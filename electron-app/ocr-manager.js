const screenshot = require('screenshot-desktop');
const Tesseract = require('tesseract.js');

class OCRManager {
  constructor(overlayWindow = null) {
    this.isProcessing = false;
    this.worker = null;
    this.overlayWindow = overlayWindow;
    this.initWorker();
  }

  async initWorker() {
    try {
      this.worker = await Tesseract.createWorker('eng');
      console.log('OCR worker initialized');
    } catch (error) {
      console.error('Failed to initialize OCR worker:', error);
    }
  }

  async captureAndRecognize() {
    if (this.isProcessing) {
      console.log('OCR already in progress, skipping...');
      return [];
    }

    if (!this.worker) {
      console.log('OCR worker not ready, skipping...');
      return [];
    }

    this.isProcessing = true;

    try {
      console.log('Starting screen capture...');

      // Temporarily hide overlay to capture clean screen
      let wasVisible = false;
      if (this.overlayWindow && this.overlayWindow.isVisible()) {
        wasVisible = true;
        this.overlayWindow.hide();
        // Wait a moment for the hide to take effect
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Capture screenshot
      const imgBuffer = await screenshot({ format: 'png' });
      console.log('Screenshot captured, running OCR...');

      // Show overlay again if it was visible
      if (wasVisible && this.overlayWindow) {
        this.overlayWindow.show();
      }

      // Run OCR on the captured image
      const { data: { text } } = await this.worker.recognize(imgBuffer);

      // Split text into lines and filter empty lines
      const lines = text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      console.log(`OCR completed, found ${lines.length} text lines`);
      return lines;

    } catch (error) {
      // Make sure overlay is shown again even if error occurs
      if (this.overlayWindow && !this.overlayWindow.isVisible()) {
        this.overlayWindow.show();
      }

      if (error.message && error.message.includes('screen recording')) {
        console.log('⚠️  Screen recording permission required!');
        console.log('Please add this app to System Settings › Privacy & Security › Screen Recording');
        return [];
      }

      console.error('OCR error:', error);
      return [];
    } finally {
      this.isProcessing = false;
    }
  }

  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

module.exports = OCRManager;