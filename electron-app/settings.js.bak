// settings.js
const { ipcRenderer } = require('electron');

// State
let appPreferences = [];
let detectedApps = new Set();
let preferencesLoaded = false;
let detectedAppsLoaded = false;

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

  // Load initial data - preferences first, then detected apps
  loadAppPreferences();
});

// IPC Listeners
ipcRenderer.on('detected-apps', (event, apps) => {
  console.log('⚙️ [Settings] Received detected apps:', apps.length, 'apps');
  detectedApps = new Set(apps);
  detectedAppsLoaded = true;

  // Only merge if preferences are already loaded
  if (preferencesLoaded) {
    console.log('⚙️ [Settings] Merging detected apps with preferences...');
    mergeWithPreferences();
  } else {
    console.log('⚠️ [Settings] Preferences not loaded yet, skipping merge');
  }

  renderAppList();
});

ipcRenderer.on('app-preferences-loaded', (event, preferences) => {
  console.log('⚙️ [Settings] Loaded app preferences from database:', preferences.length, 'apps');
  preferences.forEach(pref => {
    console.log(`  - ${pref.app_name}: vision=${pref.allow_vision}, screenshots=${pref.allow_screenshots}`);
  });

  appPreferences = preferences;
  preferencesLoaded = true;

  // Mark all apps from database as detected
  preferences.forEach(pref => {
    detectedApps.add(pref.app_name);
  });

  console.log('⚙️ [Settings] Preferences loaded, now requesting detected apps...');

  // Now request detected apps (ensures preferences are loaded first)
  requestDetectedApps();

  // Render with what we have
  renderAppList();
});

ipcRenderer.on('preference-updated', (event, { appName, updates }) => {
  console.log('⚙️ [Settings] Preference updated from backend:', appName, updates);
  updateLocalPreference(appName, updates);
  renderAppList();
  updateStats();
});

ipcRenderer.on('app-detected', (event, { appName, allApps }) => {
  console.log('⚙️ [Settings] New app detected:', appName);

  // Update detected apps set
  detectedApps = new Set(allApps);

  // Check if this app already has preferences
  const exists = appPreferences.find(p => p.app_name === appName);
  if (!exists && preferencesLoaded) {
    console.log(`⚙️ [Settings] Adding new app "${appName}" to preferences`);

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

    // Re-render
    renderAppList();
    updateLastUpdated();
  } else if (exists) {
    console.log(`⚙️ [Settings] App "${appName}" already in preferences, skipping`);
  } else {
    console.log(`⚠️ [Settings] Preferences not loaded yet, skipping app "${appName}"`);
  }
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
  let newAppsAdded = 0;

  detectedApps.forEach(appName => {
    const exists = appPreferences.find(p => p.app_name === appName);
    if (!exists) {
      console.log(`⚙️ [Settings] Creating default preferences for new app: ${appName}`);

      const newPref = {
        app_name: appName,
        allow_ocr: true,
        allow_vision: false,
        allow_screenshots: false,
        ocr_frequency: 'normal',
        vision_frequency: 'low'
      };

      appPreferences.push(newPref);
      newAppsAdded++;

      // Save to database immediately (but don't wait for response)
      updatePreference(appName, newPref);
    }
  });

  if (newAppsAdded > 0) {
    console.log(`⚙️ [Settings] Added ${newAppsAdded} new app(s) to preferences`);
  }

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
  console.log(`⚙️ [Settings] Updating preference for ${appName}:`, updates);
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
