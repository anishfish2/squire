const screenshot = require('screenshot-desktop');
const Tesseract = require('tesseract.js');
const sharp = require('sharp'); // npm install sharp

class OCRManager {
  constructor(overlayWindow = null) {
    this.isProcessing = false;
    this.worker = null;
    this.overlayWindow = overlayWindow;
    this.initWorker();
  }

  async initWorker() {
    try {
      // 2. CRITICAL TESSERACT CONFIGURATION
      this.worker = await Tesseract.createWorker('eng', 1, {
        // Page segmentation - treat image as single text block
        tessedit_pageseg_mode: '6',
        
        // Use LSTM engine only (faster, better for screen text)
        tesseract_ocr_engine_mode: '1',
        
        // Character whitelist - only allow expected characters
        tesseract_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?-()[]{}:;/@#$%&*+=<>',
        
        // Disable dictionaries for speed
        load_system_dawg: '0',
        load_freq_dawg: '0', 
        load_punc_dawg: '0',
        load_number_dawg: '0',
        load_unambig_dawg: '0',
        load_bigram_dawg: '0',
        load_fixed_length_dawgs: '0',
        
        // Text detection optimizations
        textord_really_old_xheight: '0',
        textord_min_xheight: '5',
        preserve_interword_spaces: '1',
        
        // Improve recognition for screen text
        tessedit_create_hocr: '0',
        tessedit_create_pdf: '0'
      });
      
      console.log('OCR worker initialized with optimized settings');
    } catch (error) {
      console.error('Failed to initialize OCR worker:', error);
    }
  }

  // 3. IMAGE PREPROCESSING
  async preprocessImage(imgBuffer) {
    try {
      // Get original image info
      const metadata = await sharp(imgBuffer).metadata();
      console.log(`Original image: ${metadata.width}x${metadata.height}`);
      
      // 4. RESOLUTION/DPI OPTIMIZATION
      // Target around 300 DPI equivalent for OCR
      const targetWidth = Math.min(2400, metadata.width); // Cap at reasonable size
      const scaleFactor = targetWidth / metadata.width;
      
      const processedBuffer = await sharp(imgBuffer)
        // Resize if needed
        .resize(Math.round(metadata.width * scaleFactor), Math.round(metadata.height * scaleFactor), {
          kernel: sharp.kernel.lanczos3,
          fit: 'contain'
        })
        // Convert to grayscale
        .grayscale()
        // Increase contrast - critical for screen text
        .normalise({
          lower: 1,  // Darken dark areas (text)
          upper: 99  // Brighten light areas (background)
        })
        // Apply moderate sharpening
        .sharpen({
          sigma: 1.0,
          m1: 1.0,
          m2: 2.0,
          x1: 2.0,
          y2: 10.0,
          y3: 20.0
        })
        // Ensure high quality
        .png({
          quality: 100,
          compressionLevel: 0
        })
        .toBuffer();
        
      console.log('Image preprocessing completed');
      return processedBuffer;
      
    } catch (error) {
      console.error('Image preprocessing failed:', error);
      // Return original buffer if preprocessing fails
      return imgBuffer;
    }
  }

  // 5. IMPROVED TEXT FILTERING
  filterAndCleanText(rawText) {
    if (!rawText || typeof rawText !== 'string') {
      return [];
    }

    const lines = rawText.split('\n')
      .map(line => line.trim())
      .filter(line => {
        // Remove empty lines
        if (line.length === 0) return false;
        
        // Remove lines that are mostly symbols/punctuation
        const alphanumericCount = (line.match(/[a-zA-Z0-9]/g) || []).length;
        const symbolCount = (line.match(/[^\w\s]/g) || []).length;
        if (symbolCount > alphanumericCount) return false;
        
        // Remove very short lines (likely UI artifacts)
        if (line.length < 3) return false;
        
        // Remove lines with excessive repeating characters
        if (/(.)\1{4,}/.test(line)) return false;
        
        // Remove lines that are mostly numbers/dates without context
        if (/^\d+[\d\s\-\/\:\.]*$/.test(line) && line.length < 15) return false;
        
        // Keep lines that have at least one real word (3+ letters)
        if (!/[a-zA-Z]{3,}/.test(line)) return false;
        
        return true;
      })
      .map(line => {
        // Clean up common OCR artifacts
        return line
          // Remove common UI symbols
          .replace(/[®©™°§¶†‡•◊]/g, '')
          // Fix common OCR mistakes for screen text
          .replace(/\s+/g, ' ')  // Multiple spaces to single
          .replace(/['']/g, "'") // Smart quotes to regular
          .replace(/[""]/g, '"') // Smart quotes to regular
          .replace(/[–—]/g, '-') // Em/en dashes to hyphens
          .trim();
      })
      .filter(line => line.length > 0);

    // Additional filtering: remove duplicate or very similar lines
    const uniqueLines = [];
    for (const line of lines) {
      const isDuplicate = uniqueLines.some(existing => 
        this.calculateSimilarity(line.toLowerCase(), existing.toLowerCase()) > 0.85
      );
      if (!isDuplicate) {
        uniqueLines.push(line);
      }
    }

    return uniqueLines;
  }

  // Helper function for similarity calculation
  calculateSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    if (str1.length === 0 || str2.length === 0) return 0;
    
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  levenshteinDistance(str1, str2) {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }
    
    return matrix[str2.length][str1.length];
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
      
      // Temporarily hide overlay
      let wasVisible = false;
      if (this.overlayWindow && this.overlayWindow.isVisible()) {
        wasVisible = true;
        this.overlayWindow.hide();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Capture screenshot
      const imgBuffer = await screenshot({ format: 'png' });
      console.log('Screenshot captured, preprocessing image...');

      // Show overlay again
      if (wasVisible && this.overlayWindow) {
        this.overlayWindow.show();
      }

      // 3. PREPROCESS THE IMAGE
      const processedBuffer = await this.preprocessImage(imgBuffer);
      console.log('Image preprocessed, running OCR...');

      // Run OCR with optimized settings
      const { data: { text, confidence } } = await this.worker.recognize(processedBuffer);
      console.log(`OCR completed with confidence: ${confidence}%`);

      // 5. APPLY IMPROVED TEXT FILTERING
      const cleanedLines = this.filterAndCleanText(text);
      
      console.log(`OCR found ${cleanedLines.length} meaningful text lines`);
      return cleanedLines;

    } catch (error) {
      // Ensure overlay is shown again
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
