import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const ActiveWindow = require('@paymoapp/active-window').default

ActiveWindow.initialize();

if (!ActiveWindow.requestPermissions()) {
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



      try {
        const win = await ActiveWindow.getActiveWindow();
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
  }

  _handleChange(winInfo) {
    const payload = {
      appName: winInfo.application,
      windowTitle: winInfo.title,
      processId: winInfo.pid,
      iconBase64: winInfo.icon
    };


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

export default ActiveAppTracker

