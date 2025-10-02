// settings.js
const { ipcRenderer } = require('electron');

// State
let appPreferences = [];
let detectedApps = new Set();

// DOM Elements
let appList, searchInput, totalAppsEl, ocrEnabledEl, visionEnabledEl, lastUpdatedEl;
let closeBtn, enableAllBtn, disableAllBtn, enableVisionAllBtn, refreshAppsBtn, globalVisionToggle;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  // Get DOM elements
  appList = document.getElementById('app-list');
  searchInput = document.getElementById('search-input');
  totalAppsEl = document.getElementById('total-apps');
  ocrEnabledEl = document.getElementById('ocr-enabled');
  visionEnabledEl = document.getElementById('vision-enabled');
  lastUpdatedEl = document.getElementById('last-updated');

  closeBtn = document.getElementById('close-btn');
  enableAllBtn = document.getElementById('enable-all-btn');
  disableAllBtn = document.getElementById('disable-all-btn');
  enableVisionAllBtn = document.getElementById('enable-vision-all-btn');
  refreshAppsBtn = document.getElementById('refresh-apps-btn');
  globalVisionToggle = document.getElementById('global-vision-toggle');

  // Event listeners
  closeBtn.addEventListener('click', () => {
    ipcRenderer.send('close-settings');
  });

  enableAllBtn.addEventListener('click', () => enableAllApps('ocr'));
  disableAllBtn.addEventListener('click', () => disableAllApps());
  enableVisionAllBtn.addEventListener('click', () => enableAllApps('vision'));
  refreshAppsBtn.addEventListener('click', () => refreshApps());

  searchInput.addEventListener('input', (e) => {
    filterApps(e.target.value);
  });

  globalVisionToggle.addEventListener('change', (e) => {
    ipcRenderer.send('toggle-global-vision', e.target.checked);
  });

  // Load initial data
  loadAppPreferences();
  requestDetectedApps();
});

// IPC Listeners
ipcRenderer.on('detected-apps', (event, apps) => {
  console.log('Received detected apps:', apps);
  detectedApps = new Set(apps);
  mergeWithPreferences();
  renderAppList();
});

ipcRenderer.on('app-preferences-loaded', (event, preferences) => {
  console.log('Loaded app preferences:', preferences);
  appPreferences = preferences;
  renderAppList();
});

ipcRenderer.on('preference-updated', (event, { appName, updates }) => {
  console.log('Preference updated:', appName, updates);
  updateLocalPreference(appName, updates);
  renderAppList();
});

ipcRenderer.on('app-detected', (event, { appName, allApps }) => {
  console.log('New app detected:', appName);
  console.log('All detected apps:', allApps);

  // Update detected apps set
  detectedApps = new Set(allApps);

  // Check if this app already has preferences
  const exists = appPreferences.find(p => p.app_name === appName);
  if (!exists) {
    // Add with defaults locally
    const newPref = {
      app_name: appName,
      allow_ocr: true,
      allow_vision: false,
      allow_screenshots: false,
      ocr_frequency: 'normal',
      vision_frequency: 'low'
    };

    appPreferences.push(newPref);

    // Sort alphabetically
    appPreferences.sort((a, b) => a.app_name.localeCompare(b.app_name));

    // Save to database immediately
    updatePreference(appName, newPref);
  }

  // Re-render
  renderAppList();
  updateLastUpdated();
});

// Functions
function loadAppPreferences() {
  ipcRenderer.send('load-app-preferences');
}

function requestDetectedApps() {
  ipcRenderer.send('get-detected-apps');
}

function refreshApps() {
  refreshAppsBtn.textContent = '🔄 Refreshing...';
  refreshAppsBtn.disabled = true;

  requestDetectedApps();
  loadAppPreferences();

  setTimeout(() => {
    refreshAppsBtn.textContent = '🔄 Refresh Apps';
    refreshAppsBtn.disabled = false;
    updateLastUpdated();
  }, 1000);
}

function mergeWithPreferences() {
  // Create preferences for newly detected apps
  detectedApps.forEach(appName => {
    const exists = appPreferences.find(p => p.app_name === appName);
    if (!exists) {
      appPreferences.push({
        app_name: appName,
        allow_ocr: true,
        allow_vision: false,
        allow_screenshots: false,
        ocr_frequency: 'normal',
        vision_frequency: 'low'
      });
    }
  });

  // Sort alphabetically
  appPreferences.sort((a, b) => a.app_name.localeCompare(b.app_name));
}

function renderAppList() {
  if (appPreferences.length === 0) {
    appList.innerHTML = `
      <div class="text-center py-12 text-white/40">
        <div class="text-4xl mb-3">📱</div>
        <p class="text-sm">No apps detected yet</p>
        <p class="text-xs mt-2">Switch between apps to populate this list</p>
      </div>
    `;
    updateStats();
    return;
  }

  appList.innerHTML = appPreferences.map(pref => createAppCard(pref)).join('');

  // Attach event listeners to toggles
  appPreferences.forEach(pref => {
    const ocrToggle = document.getElementById(`ocr-toggle-${pref.app_name}`);
    const visionToggle = document.getElementById(`vision-toggle-${pref.app_name}`);
    const screenshotToggle = document.getElementById(`screenshot-toggle-${pref.app_name}`);

    if (ocrToggle) {
      ocrToggle.addEventListener('change', (e) => {
        updatePreference(pref.app_name, { allow_ocr: e.target.checked });
      });
    }

    if (visionToggle) {
      visionToggle.addEventListener('change', (e) => {
        updatePreference(pref.app_name, { allow_vision: e.target.checked });
      });
    }

    if (screenshotToggle) {
      screenshotToggle.addEventListener('change', (e) => {
        updatePreference(pref.app_name, { allow_screenshots: e.target.checked });
      });
    }
  });

  updateStats();
}

function createAppCard(pref) {
  const isRecentlyActive = detectedApps.has(pref.app_name);

  return `
    <div class="app-card bg-white/[0.06] hover:bg-white/[0.09] rounded-xl p-3 border border-white/10 transition-all" data-app-name="${pref.app_name}">
      <div class="flex items-center justify-between mb-2.5">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 bg-white/10 rounded-lg flex items-center justify-center text-sm border border-white/20">
            📱
          </div>
          <div>
            <h3 class="text-white font-medium text-sm m-0">${pref.app_name}</h3>
            ${isRecentlyActive ? '<span class="text-white/50 text-xs">● Active</span>' : '<span class="text-white/30 text-xs">○</span>'}
          </div>
        </div>
      </div>

      <div class="space-y-2">
        <!-- OCR Toggle -->
        <div class="flex items-center justify-between">
          <span class="text-white/70 text-xs">OCR</span>
          <label class="relative inline-block w-11 h-6 cursor-pointer">
            <input type="checkbox" id="ocr-toggle-${pref.app_name}" ${pref.allow_ocr ? 'checked' : ''} class="sr-only peer">
            <div class="w-full h-full bg-white/10 peer-checked:bg-white/20 rounded-full transition-all border border-white/20"></div>
            <div class="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
          </label>
        </div>

        <!-- Vision Toggle -->
        <div class="flex items-center justify-between">
          <span class="text-white/70 text-xs">Vision</span>
          <label class="relative inline-block w-11 h-6 cursor-pointer">
            <input type="checkbox" id="vision-toggle-${pref.app_name}" ${pref.allow_vision ? 'checked' : ''} class="sr-only peer">
            <div class="w-full h-full bg-white/10 peer-checked:bg-white/20 rounded-full transition-all border border-white/20"></div>
            <div class="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
          </label>
        </div>

        <!-- Screenshot Storage Toggle -->
        <div class="flex items-center justify-between">
          <span class="text-white/70 text-xs">Screenshots</span>
          <label class="relative inline-block w-11 h-6 cursor-pointer">
            <input type="checkbox" id="screenshot-toggle-${pref.app_name}" ${pref.allow_screenshots ? 'checked' : ''} class="sr-only peer">
            <div class="w-full h-full bg-white/10 peer-checked:bg-white/20 rounded-full transition-all border border-white/20"></div>
            <div class="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
          </label>
        </div>
      </div>

      ${pref.allow_vision ? `
        <div class="mt-2 pt-2 border-t border-white/10 text-xs text-white/40">
          Vision costs: ~$0.01-0.03/image
        </div>
      ` : ''}
    </div>
  `;
}

function filterApps(searchTerm) {
  const cards = document.querySelectorAll('.app-card');
  const term = searchTerm.toLowerCase();

  cards.forEach(card => {
    const appName = card.getAttribute('data-app-name').toLowerCase();
    if (appName.includes(term)) {
      card.style.display = 'block';
    } else {
      card.style.display = 'none';
    }
  });
}

function enableAllApps(feature = 'ocr') {
  appPreferences.forEach(pref => {
    if (feature === 'ocr') {
      updatePreference(pref.app_name, { allow_ocr: true });
    } else if (feature === 'vision') {
      updatePreference(pref.app_name, { allow_vision: true, allow_screenshots: true });
    }
  });
}

function disableAllApps() {
  appPreferences.forEach(pref => {
    updatePreference(pref.app_name, { allow_ocr: false, allow_vision: false, allow_screenshots: false });
  });
}

function updatePreference(appName, updates) {
  ipcRenderer.send('update-app-preference', { appName, updates });
}

function updateLocalPreference(appName, updates) {
  const pref = appPreferences.find(p => p.app_name === appName);
  if (pref) {
    Object.assign(pref, updates);
  }
}

function updateStats() {
  totalAppsEl.textContent = appPreferences.length;
  ocrEnabledEl.textContent = appPreferences.filter(p => p.allow_ocr).length;
  visionEnabledEl.textContent = appPreferences.filter(p => p.allow_vision).length;
}

function updateLastUpdated() {
  const now = new Date();
  lastUpdatedEl.textContent = `Last updated: ${now.toLocaleTimeString()}`;
}
