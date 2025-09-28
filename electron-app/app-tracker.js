// app-tracker.js
const ActiveWindow = require('@paymoapp/active-window').default;

ActiveWindow.initialize();

if (!ActiveWindow.requestPermissions()) {
  console.log('Error: You need to grant screen recording permission in System Preferences > Security & Privacy > Privacy > Screen Recording');
  process.exit(0);
}


class ActiveAppTracker {
  constructor(ocrManager, onAppChange) {
    this.ocrManager = ocrManager;
    this.onAppChange = onAppChange;

    this.currentWindow = null;
    this.watchId = null;
    this.pendingOCR = null;
  }

  async startTracking() {
    try {


      console.log('🔍 Starting active window tracking...');

      // Get the current active window once
      try {
        const win = await ActiveWindow.getActiveWindow();
        console.log('Window title:', win.title);
        console.log('Application:', win.application);
        console.log('Application path:', win.path);
        console.log('Application PID:', win.pid);
        console.log('Application icon:', win.icon);
        if (win) {
          this.currentWindow = win;
          this._handleChange(win);
        }
      } catch (err) {
        console.error('❌ Error getting initial window:', err);
      }

      // Subscribe for changes (real-time notifications)
      this.watchId = ActiveWindow.subscribe((winInfo) => {
        if (!winInfo) return;
        this.currentWindow = winInfo;
        this._handleChange(winInfo);
      });

      console.log('✅ ActiveAppTracker started (@paymoapp/active-window)');
    } catch (err) {
      console.error('❌ Failed to start ActiveAppTracker:', err);
    }
  }

  stopTracking() {
    if (this.watchId !== null) {
      ActiveWindow.unsubscribe(this.watchId);
      this.watchId = null;
    }
    if (this.pendingOCR) {
      clearTimeout(this.pendingOCR);
      this.pendingOCR = null;
    }
    this.currentWindow = null;
    console.log('🛑 ActiveAppTracker stopped');
  }

  _handleChange(winInfo) {
    const payload = {
      appName: winInfo.application,
      windowTitle: winInfo.title,
      processId: winInfo.pid,
      iconBase64: winInfo.icon // @paymoapp/active-window provides base64 PNG
    };

    console.log(`🔄 Focus changed → ${payload.appName} | ${payload.windowTitle}`);

    if (this.onAppChange) {
      this.onAppChange(payload);
    }

    // this._scheduleOCR();
  }

  // _scheduleOCR() {
  //   if (this.pendingOCR) clearTimeout(this.pendingOCR);
  //
  //   this.pendingOCR = setTimeout(async () => {
  //     if (!this.ocrManager) return;
  //     console.log('📸 Running OCR after app change…');
  //
  //     try {
  //       const ocrResults = await this.ocrManager.captureAndRecognize();
  //       if (this.onAppChange && this.currentWindow) {
  //         this.onAppChange({
  //           appName: this.currentWindow.application,
  //           windowTitle: this.currentWindow.title,
  //           ocrResults
  //         });
  //       }
  //     } catch (err) {
  //       console.error('❌ OCR error:', err);
  //     }
  //
  //     this.pendingOCR = null;
  //   }, 500);
  // }

  getCurrentApp() {
    if (!this.currentWindow) return null;
    return {
      appName: this.currentWindow.application,
      windowTitle: this.currentWindow.title
    };
  }
}

module.exports = ActiveAppTracker;

