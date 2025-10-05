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
      iconBase64: winInfo.icon
    };

    console.log(`🔄 Focus changed → ${payload.appName} | ${payload.windowTitle}`);

    if (this.onAppChange) {
      this.onAppChange(payload);
    }

  }


  getCurrentApp() {
    if (!this.currentWindow) return null;
    return {
      appName: this.currentWindow.application,
      windowTitle: this.currentWindow.title
    };
  }
}

module.exports = ActiveAppTracker;

