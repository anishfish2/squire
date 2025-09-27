// debug.js
const { ipcRenderer } = require('electron');

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', () => {
  // Get debug panel elements
  window.debugApp = document.getElementById('debug-app');
  window.debugWindow = document.getElementById('debug-window');
  window.debugOcrLines = document.getElementById('debug-ocr-lines');
  window.debugBackendStatus = document.getElementById('debug-backend-status');
  window.debugSuggestions = document.getElementById('debug-suggestions');

  // Initialize debug display
  updateDebugStatus('Waiting for app switch...');

  // Set up mouse event handling for click-through
  const debugPanel = document.querySelector('.debug-panel');
  if (debugPanel) {
    debugPanel.addEventListener('mouseenter', () => {
      ipcRenderer.send('debug-set-ignore-mouse-events', false);
    });

    debugPanel.addEventListener('mouseleave', () => {
      ipcRenderer.send('debug-set-ignore-mouse-events', true, { forward: true });
    });
  }
});

// Listen for debug updates from main process
ipcRenderer.on('debug-update', (event, data) => {
  updateDebugDisplay(data);
});

// Debug display functions
function updateDebugDisplay(data) {
  if (data.appName && window.debugApp) {
    window.debugApp.textContent = data.appName;
    window.debugApp.className = 'debug-value';
  }
  if (data.windowTitle && window.debugWindow) {
    window.debugWindow.textContent = data.windowTitle || 'No Title';
    window.debugWindow.className = 'debug-value';
  }
  if (data.ocrLines !== undefined && window.debugOcrLines) {
    window.debugOcrLines.textContent = data.ocrLines;
    window.debugOcrLines.className = 'debug-value';
  }
  if (data.backendStatus) {
    updateDebugStatus(data.backendStatus, data.statusType);
  }
  if (data.suggestions !== undefined && window.debugSuggestions) {
    window.debugSuggestions.textContent = data.suggestions;
    window.debugSuggestions.className = 'debug-value';
  }
}

function updateDebugStatus(status, type = 'waiting') {
  if (window.debugBackendStatus) {
    window.debugBackendStatus.textContent = status;
    window.debugBackendStatus.className = `debug-value status-${type}`;
  }
}